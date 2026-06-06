/**
 * Data-integrity verification service.
 *
 * Runs a battery of sanity checks against the live database and returns a
 * structured report. Each check is independent so partial failures are
 * visible alongside passing checks.
 *
 * Checks:
 *  1. Every posted journal entry is balanced (sum debit == sum credit).
 *  2. Each account's cached `balance` column matches the GL-derived balance.
 *  3. A/R control account (code 1200) balance equals sum of open invoices' balanceDue.
 *  4. No journal_entry_lines reference an account belonging to another company.
 */
import { and, eq, ne, sql } from 'drizzle-orm';
import { accounts, invoices, journalEntries, journalEntryLines } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import type { ServiceContext } from './_base';

export interface IntegrityCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface IntegrityResult {
  checks: IntegrityCheck[];
  allOk: boolean;
}

const DEBIT_NORMAL = new Set(['asset', 'expense']);

// ---------------------------------------------------------------------------
// Check 1: Every posted journal entry has balanced lines (debits == credits).
// ---------------------------------------------------------------------------
async function checkEntriesBalanced(ctx: ServiceContext): Promise<IntegrityCheck> {
  const name = 'Journal entries balanced';

  // Aggregate per entry: sum(debit) and sum(credit). We only care about posted entries.
  const rows = await ctx.db
    .select({
      entryId: journalEntryLines.journalEntryId,
      totalDebit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}), 0)`,
      totalCredit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.companyId, ctx.companyId),
        eq(journalEntries.status, 'posted'),
      ),
    )
    .groupBy(journalEntryLines.journalEntryId);

  const unbalanced: string[] = [];
  for (const row of rows) {
    if (!Money.equalWithinCent(row.totalDebit, row.totalCredit)) {
      unbalanced.push(row.entryId);
    }
  }

  if (unbalanced.length === 0) {
    return { name, ok: true, detail: `All ${rows.length} posted entries are balanced.` };
  }
  return {
    name,
    ok: false,
    detail: `${unbalanced.length} unbalanced entr${unbalanced.length === 1 ? 'y' : 'ies'} found: ${unbalanced.slice(0, 5).join(', ')}${unbalanced.length > 5 ? ` …+${unbalanced.length - 5} more` : ''}.`,
  };
}

// ---------------------------------------------------------------------------
// Check 2: Cached account.balance matches GL-derived balance.
// ---------------------------------------------------------------------------
async function checkCachedBalances(ctx: ServiceContext): Promise<IntegrityCheck> {
  const name = 'Cached account balances match GL';

  // Compute GL-derived natural balance per account from posted entries.
  const glRows = await ctx.db
    .select({
      accountId: journalEntryLines.accountId,
      totalDebit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}), 0)`,
      totalCredit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .innerJoin(accounts, eq(journalEntryLines.accountId, accounts.id))
    .where(
      and(
        eq(journalEntries.companyId, ctx.companyId),
        eq(journalEntries.status, 'posted'),
        eq(accounts.companyId, ctx.companyId),
      ),
    )
    .groupBy(journalEntryLines.accountId);

  // Load all account rows for this company (to get cached balance + type).
  const accountRows = await ctx.db
    .select({ id: accounts.id, code: accounts.code, type: accounts.type, balance: accounts.balance })
    .from(accounts)
    .where(eq(accounts.companyId, ctx.companyId));

  const glByAccountId = new Map(glRows.map((r) => [r.accountId, r]));

  const mismatches: string[] = [];
  for (const acct of accountRows) {
    const gl = glByAccountId.get(acct.id);
    const derivedDebit = Money.of(gl?.totalDebit ?? 0);
    const derivedCredit = Money.of(gl?.totalCredit ?? 0);
    const debitNet = derivedDebit.minus(derivedCredit);
    // Natural balance: debit-normal types use debitNet, credit-normal use negated.
    const glBalance = DEBIT_NORMAL.has(acct.type) ? debitNet : debitNet.negated();
    if (!Money.equalWithinCent(glBalance, acct.balance)) {
      mismatches.push(`${acct.code} (cached ${toAmountString(acct.balance)}, GL ${toAmountString(glBalance)})`);
    }
  }

  if (mismatches.length === 0) {
    return { name, ok: true, detail: `All ${accountRows.length} account balances are consistent with the GL.` };
  }
  return {
    name,
    ok: false,
    detail: `${mismatches.length} mismatch${mismatches.length === 1 ? '' : 'es'}: ${mismatches.slice(0, 3).join('; ')}${mismatches.length > 3 ? ` …+${mismatches.length - 3} more` : ''}.`,
  };
}

// ---------------------------------------------------------------------------
// Check 3: A/R control account (code 1200) balance == sum of open invoice balanceDue.
// ---------------------------------------------------------------------------
async function checkARControl(ctx: ServiceContext): Promise<IntegrityCheck> {
  const name = 'A/R control account (1200) matches open invoices';

  // Look up the 1200 account.
  const [arAccount] = await ctx.db
    .select({ id: accounts.id, balance: accounts.balance })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, '1200')));

  if (!arAccount) {
    return { name, ok: true, detail: 'Account 1200 (A/R) not found — check skipped.' };
  }

  // Sum balanceDue across open/partial/overdue invoices for this company.
  const [invRow] = await ctx.db
    .select({
      totalDue: sql<string>`COALESCE(SUM(${invoices.balanceDue}), 0)`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, ctx.companyId),
        // Only statuses that still have an outstanding balance.
        sql`${invoices.status} IN ('open', 'partial', 'overdue')`,
      ),
    );

  const arBalance = Money.of(arAccount.balance);
  const invoicesDue = Money.of(invRow?.totalDue ?? 0);

  if (Money.equalWithinCent(arBalance, invoicesDue)) {
    return {
      name,
      ok: true,
      detail: `A/R balance ${toAmountString(arBalance)} matches open invoice balanceDue ${toAmountString(invoicesDue)}.`,
    };
  }
  return {
    name,
    ok: false,
    detail: `A/R cached balance ${toAmountString(arBalance)} != open invoice balanceDue ${toAmountString(invoicesDue)} (diff ${toAmountString(arBalance.minus(invoicesDue))}).`,
  };
}

// ---------------------------------------------------------------------------
// Check 4: No journal_entry_lines reference an account from another company.
// ---------------------------------------------------------------------------
async function checkCrossCompanyLines(ctx: ServiceContext): Promise<IntegrityCheck> {
  const name = 'No cross-company journal entry lines';

  // Find lines where the entry belongs to this company but the account does not.
  const leaks = await ctx.db
    .select({ lineId: journalEntryLines.id })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .innerJoin(accounts, eq(journalEntryLines.accountId, accounts.id))
    .where(
      and(
        eq(journalEntries.companyId, ctx.companyId),
        ne(accounts.companyId, ctx.companyId),
      ),
    );

  if (leaks.length === 0) {
    return { name, ok: true, detail: 'No cross-company account references found.' };
  }
  return {
    name,
    ok: false,
    detail: `${leaks.length} journal entry line${leaks.length === 1 ? '' : 's'} reference accounts from another company.`,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function verifyIntegrity(ctx: ServiceContext): Promise<IntegrityResult> {
  const checks = await Promise.all([
    checkEntriesBalanced(ctx),
    checkCachedBalances(ctx),
    checkARControl(ctx),
    checkCrossCompanyLines(ctx),
  ]);

  return { checks, allOk: checks.every((c) => c.ok) };
}
