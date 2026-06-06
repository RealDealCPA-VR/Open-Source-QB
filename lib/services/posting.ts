/**
 * Posting engine — the single, validated path that turns business events into balanced
 * double-entry journal entries. Invoices, bills, payments, deposits, payroll, etc. all post
 * through `postJournalEntry`. This is the one place that enforces debits == credits and keeps
 * cached account balances correct.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Money, toAmountString } from '@/lib/money';
import { accounts, journalEntries, journalEntryLines } from '@/lib/db/schema';
import {
  type ServiceContext,
  ServiceError,
  inTransaction,
  notFound,
  validation,
  writeAudit,
} from './_base';
import { assertPeriodOpen } from './fiscalPeriods';

export interface PostingLine {
  accountId: string;
  /** Provide exactly one of debit/credit (the other 0/empty). */
  debit?: string | number | null;
  credit?: string | number | null;
  memo?: string | null;
  /** Optional class/department dimension for class-based reporting. */
  classId?: string | null;
}

export interface PostJournalEntryInput {
  date: Date;
  description: string;
  reference?: string | null;
  /** 'posted' affects balances; 'draft' does not. Defaults to 'posted'. */
  status?: 'draft' | 'posted';
  lines: PostingLine[];
  /** Optional: link source document for traceability (e.g. "invoice:<id>"). */
  sourceRef?: string;
}

const DEBIT_NORMAL = new Set(['asset', 'expense']);

/** Signed change to an account's natural balance for a single line. */
export function balanceDelta(
  accountType: string,
  debit: string | number | null | undefined,
  credit: string | number | null | undefined,
) {
  const d = Money.of(debit);
  const c = Money.of(credit);
  return DEBIT_NORMAL.has(accountType) ? d.minus(c) : c.minus(d);
}

/** Validate that lines are well-formed and balanced. Throws ServiceError on failure. */
export function assertBalanced(lines: PostingLine[]): { totalDebit: string; totalCredit: string } {
  if (!lines || lines.length < 2) {
    throw validation('A journal entry needs at least two lines.');
  }
  let totalDebit = Money.zero();
  let totalCredit = Money.zero();
  for (const [i, line] of lines.entries()) {
    const d = Money.of(line.debit);
    const c = Money.of(line.credit);
    if (d.isNegative() || c.isNegative()) {
      throw validation(`Line ${i + 1}: debit/credit cannot be negative.`);
    }
    if (d.greaterThan(0) && c.greaterThan(0)) {
      throw validation(`Line ${i + 1}: a line cannot have both a debit and a credit.`);
    }
    if (d.isZero() && c.isZero()) {
      throw validation(`Line ${i + 1}: a line must have a debit or a credit.`);
    }
    totalDebit = totalDebit.plus(d);
    totalCredit = totalCredit.plus(c);
  }
  if (!Money.equalWithinCent(totalDebit, totalCredit)) {
    throw new ServiceError(
      'UNBALANCED',
      `Entry is out of balance: debits ${toAmountString(totalDebit)} ≠ credits ${toAmountString(
        totalCredit,
      )}.`,
      { totalDebit: toAmountString(totalDebit), totalCredit: toAmountString(totalCredit) },
    );
  }
  return { totalDebit: toAmountString(totalDebit), totalCredit: toAmountString(totalCredit) };
}

async function nextEntryNumber(ctx: ServiceContext): Promise<number> {
  const [row] = await ctx.db
    .select({ max: sql<number>`COALESCE(MAX(${journalEntries.entryNumber}), 0)` })
    .from(journalEntries)
    .where(eq(journalEntries.companyId, ctx.companyId));
  return (row?.max ?? 0) + 1;
}

/** Create a balanced journal entry and (if posted) update cached account balances. */
export async function postJournalEntry(ctx: ServiceContext, input: PostJournalEntryInput) {
  assertBalanced(input.lines);
  await assertPeriodOpen(ctx, input.date); // refuse to post into a closed period
  const status = input.status ?? 'posted';

  // Verify every referenced account belongs to this company and load its type.
  const accountIds = [...new Set(input.lines.map((l) => l.accountId))];
  const accountRows = await ctx.db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), inArray(accounts.id, accountIds)));
  const typeById = new Map(accountRows.map((a) => [a.id, a.type]));
  for (const id of accountIds) {
    if (!typeById.has(id)) throw notFound(`Account ${id}`);
  }

  return inTransaction(ctx, async (tx) => {
    const entryNumber = await nextEntryNumber(tx);
    const [entry] = await tx.db
      .insert(journalEntries)
      .values({
        companyId: tx.companyId,
        entryNumber,
        date: input.date,
        description: input.description,
        reference: input.reference ?? null,
        status,
        createdBy: tx.userId ?? '00000000-0000-0000-0000-000000000000',
      })
      .returning();

    await tx.db.insert(journalEntryLines).values(
      input.lines.map((l) => ({
        journalEntryId: entry.id,
        accountId: l.accountId,
        debit: l.debit != null && Money.gt(l.debit, 0) ? toAmountString(l.debit) : null,
        credit: l.credit != null && Money.gt(l.credit, 0) ? toAmountString(l.credit) : null,
        memo: l.memo ?? null,
        classId: l.classId ?? null,
      })),
    );

    if (status === 'posted') {
      await applyBalanceDeltas(tx, input.lines, typeById, 1);
    }

    await writeAudit(tx, {
      action: 'create',
      entityType: 'journal_entry',
      entityId: entry.id,
      newValues: { entryNumber, description: input.description, lines: input.lines },
    });

    return entry;
  });
}

/** Void a posted entry: mark void and reverse its balance impact. */
export async function voidJournalEntry(ctx: ServiceContext, entryId: string) {
  return inTransaction(ctx, async (tx) => {
    const [entry] = await tx.db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.id, entryId), eq(journalEntries.companyId, tx.companyId)));
    if (!entry) throw notFound('Journal entry');
    if (entry.status === 'void') return entry;
    await assertPeriodOpen(tx, entry.date); // cannot void an entry in a closed period

    const lines = await tx.db
      .select()
      .from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, entryId));

    const accountIds = [...new Set(lines.map((l) => l.accountId))];
    const accountRows = await tx.db
      .select({ id: accounts.id, type: accounts.type })
      .from(accounts)
      .where(inArray(accounts.id, accountIds));
    const typeById = new Map(accountRows.map((a) => [a.id, a.type]));

    if (entry.status === 'posted') {
      await applyBalanceDeltas(tx, lines, typeById, -1);
    }

    const [updated] = await tx.db
      .update(journalEntries)
      .set({ status: 'void', voidedAt: new Date(), updatedAt: new Date() })
      .where(eq(journalEntries.id, entryId))
      .returning();

    await writeAudit(tx, {
      action: 'void',
      entityType: 'journal_entry',
      entityId: entryId,
      oldValues: { status: entry.status },
      newValues: { status: 'void' },
    });
    return updated;
  });
}

async function applyBalanceDeltas(
  ctx: ServiceContext,
  lines: Array<{ accountId: string; debit?: string | number | null; credit?: string | number | null }>,
  typeById: Map<string, string>,
  sign: 1 | -1,
) {
  // Aggregate per account so we issue one UPDATE per account.
  const deltas = new Map<string, ReturnType<typeof balanceDelta>>();
  for (const line of lines) {
    const type = typeById.get(line.accountId);
    if (!type) continue;
    const delta = balanceDelta(type, line.debit, line.credit).times(sign);
    const prev = deltas.get(line.accountId);
    deltas.set(line.accountId, prev ? prev.plus(delta) : delta);
  }
  for (const [accountId, delta] of deltas) {
    if (delta.isZero()) continue;
    await ctx.db
      .update(accounts)
      .set({
        balance: sql`${accounts.balance} + ${toAmountString(delta)}`,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, accountId));
  }
}
