/**
 * Bank-categorize service — the "Add to register" / "Match" step in the bank feed workflow.
 *
 * Flow:
 *  1. Transactions are staged in bank_transactions (matched = false) by the import module.
 *  2. `categorize` posts a GL journal entry and marks the transaction matched.
 *  3. `bulkApplyRules` runs active categorization rules against all unmatched transactions,
 *     writing suggestedAccountId where a rule fires (no GL posting yet).
 *  4. `categorizeSuggested` calls `categorize` for every unmatched txn that already has a
 *     suggestion — the "Auto-add" one-click batch.
 *  5. `unmatch` voids the GL entry and clears the matched flag (undo).
 *
 * IMPORTANT: GL writes happen ONLY through `postJournalEntry` (posting.ts).
 * All money arithmetic uses '@/lib/money'.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { Money, toAmountString } from '@/lib/money';
import { bankAccounts, bankTransactions } from '@/lib/db/schema';
import {
  type ServiceContext,
  ServiceError,
  notFound,
  validation,
  writeAudit,
} from './_base';
import { postJournalEntry, voidJournalEntry } from './posting';
import { applyRulesToAccount } from './rules';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CategorizeInput {
  bankTransactionId: string;
  /** The offsetting GL account (income, expense, liability, etc.). */
  accountId: string;
  payee?: string | null;
  memo?: string | null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List staged bank-feed transactions for a bank account, newest first.
 * Pass `unmatchedOnly: true` (default false) to hide already-categorized rows.
 */
export async function listStaged(
  ctx: ServiceContext,
  bankAccountId: string,
  opts: { unmatchedOnly?: boolean } = {},
) {
  const conditions = [
    eq(bankTransactions.companyId, ctx.companyId),
    eq(bankTransactions.bankAccountId, bankAccountId),
  ];
  if (opts.unmatchedOnly) {
    conditions.push(eq(bankTransactions.matched, false));
  }
  return ctx.db
    .select()
    .from(bankTransactions)
    .where(and(...conditions))
    .orderBy(desc(bankTransactions.date));
}

// ---------------------------------------------------------------------------
// Categorize (Add to register)
// ---------------------------------------------------------------------------

/**
 * Categorize a single staged bank transaction:
 *  - Loads the txn and its bank account's GL account.
 *  - amount > 0 (money IN):  Dr bankGL / Cr accountId
 *  - amount < 0 (money OUT): Dr accountId / Cr bankGL  (uses abs amount)
 *  - Posts via postJournalEntry, sets matched = true + matchedEntryId.
 */
export async function categorize(ctx: ServiceContext, input: CategorizeInput) {
  // Load the bank transaction (company-scoped).
  const [txn] = await ctx.db
    .select()
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.id, input.bankTransactionId),
        eq(bankTransactions.companyId, ctx.companyId),
      ),
    );
  if (!txn) throw notFound('Bank transaction');
  if (txn.matched) {
    throw new ServiceError('CONFLICT', 'Bank transaction is already matched/categorized.');
  }

  // Load the bank account to find its linked GL account.
  const [ba] = await ctx.db
    .select()
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.id, txn.bankAccountId),
        eq(bankAccounts.companyId, ctx.companyId),
      ),
    );
  if (!ba) throw notFound('Bank account');

  const bankGlAccountId = ba.accountId;
  const amt = Money.of(txn.amount);
  const absAmt = toAmountString(Money.abs(txn.amount));

  if (amt.isZero()) {
    throw validation('Cannot categorize a zero-amount transaction.');
  }

  // Build posting lines:
  //   amount > 0 (deposit / credit): money came IN — debit the bank GL, credit the offset.
  //   amount < 0 (withdrawal / debit): money went OUT — debit the offset, credit the bank GL.
  const lines =
    amt.greaterThan(0)
      ? [
          { accountId: bankGlAccountId, debit: absAmt, memo: input.memo ?? null },
          { accountId: input.accountId, credit: absAmt, memo: input.memo ?? null },
        ]
      : [
          { accountId: input.accountId, debit: absAmt, memo: input.memo ?? null },
          { accountId: bankGlAccountId, credit: absAmt, memo: input.memo ?? null },
        ];

  const description =
    input.payee
      ? `${input.payee}${txn.description ? ` — ${txn.description}` : ''}`
      : txn.description ?? 'Bank transaction';

  const entry = await postJournalEntry(ctx, {
    date: new Date(txn.date),
    description,
    reference: input.memo ?? undefined,
    sourceRef: `bank_transaction:${txn.id}`,
    lines,
  });

  // Mark the staging row as matched.
  const [updated] = await ctx.db
    .update(bankTransactions)
    .set({
      matched: true,
      matchedEntryId: entry.id,
      ...(input.payee ? { payee: input.payee } : {}),
    })
    .where(eq(bankTransactions.id, txn.id))
    .returning();

  await writeAudit(ctx, {
    action: 'update',
    entityType: 'bank_transaction',
    entityId: txn.id,
    oldValues: { matched: false },
    newValues: { matched: true, matchedEntryId: entry.id },
  });

  return { transaction: updated, entry };
}

// ---------------------------------------------------------------------------
// Bulk: apply rules
// ---------------------------------------------------------------------------

/**
 * Run all active categorization rules against every unmatched bank transaction
 * for the given bank account, setting suggestedAccountId where a rule fires.
 * Returns the number of transactions updated.
 */
export async function bulkApplyRules(
  ctx: ServiceContext,
  bankAccountId: string,
): Promise<number> {
  // Validate the bank account belongs to this company.
  const [ba] = await ctx.db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(
      and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.companyId, ctx.companyId)),
    );
  if (!ba) throw notFound('Bank account');

  return applyRulesToAccount(ctx, bankAccountId);
}

// ---------------------------------------------------------------------------
// Bulk: categorize all suggested
// ---------------------------------------------------------------------------

/**
 * For every unmatched transaction that already has a suggestedAccountId, call
 * `categorize` so it gets posted to the GL. Returns the count of categorized rows.
 */
export async function categorizeSuggested(
  ctx: ServiceContext,
  bankAccountId: string,
): Promise<number> {
  // Validate ownership.
  const [ba] = await ctx.db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(
      and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.companyId, ctx.companyId)),
    );
  if (!ba) throw notFound('Bank account');

  const candidates = await ctx.db
    .select()
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.companyId, ctx.companyId),
        eq(bankTransactions.bankAccountId, bankAccountId),
        eq(bankTransactions.matched, false),
        isNotNull(bankTransactions.suggestedAccountId),
      ),
    );

  let count = 0;
  for (const txn of candidates) {
    if (!txn.suggestedAccountId) continue;
    try {
      await categorize(ctx, {
        bankTransactionId: txn.id,
        accountId: txn.suggestedAccountId,
      });
      count += 1;
    } catch {
      // Skip individual failures (already matched, zero amount, etc.) — don't abort batch.
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Unmatch (undo)
// ---------------------------------------------------------------------------

/**
 * Reverse a categorization:
 *  - Voids the matched journal entry (reverses GL balance impact).
 *  - Clears matched + matchedEntryId on the bank transaction row.
 */
export async function unmatch(ctx: ServiceContext, bankTransactionId: string) {
  const [txn] = await ctx.db
    .select()
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.id, bankTransactionId),
        eq(bankTransactions.companyId, ctx.companyId),
      ),
    );
  if (!txn) throw notFound('Bank transaction');
  if (!txn.matched || !txn.matchedEntryId) {
    throw new ServiceError('CONFLICT', 'Bank transaction is not currently matched.');
  }

  // Void the GL entry (reverses balance deltas).
  await voidJournalEntry(ctx, txn.matchedEntryId);

  // Clear the match flags.
  const [updated] = await ctx.db
    .update(bankTransactions)
    .set({ matched: false, matchedEntryId: null })
    .where(eq(bankTransactions.id, txn.id))
    .returning();

  await writeAudit(ctx, {
    action: 'update',
    entityType: 'bank_transaction',
    entityId: txn.id,
    oldValues: { matched: true, matchedEntryId: txn.matchedEntryId },
    newValues: { matched: false, matchedEntryId: null },
  });

  return updated;
}
