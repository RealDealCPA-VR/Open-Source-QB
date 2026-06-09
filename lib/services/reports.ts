/**
 * Financial reports computed from the journal (the source of truth), not cached balances.
 * Start with Trial Balance, P&L, and Balance Sheet — the foundation set.
 */
import { and, eq, lte, sql } from 'drizzle-orm';
import { accounts, journalEntries, journalEntryLines } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import type { ServiceContext } from './_base';

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debit: string;
  credit: string;
}

const DEBIT_NORMAL = new Set(['asset', 'expense']);

/**
 * SQL condition excluding year-end closing entries (sourceRef 'fiscal-close:<year>').
 * Closing entries zero P&L accounts into Retained Earnings; they must be excluded
 * from income-statement reports (P&L and derivatives) so closed-year history is
 * preserved, but kept in balance-sheet/trial-balance/GL views so Retained Earnings
 * stays correct after the close.
 */
export function notFiscalCloseEntry() {
  return sql`(${journalEntries.sourceRef} IS NULL OR ${journalEntries.sourceRef} NOT LIKE 'fiscal-close:%')`;
}

/** Aggregate posted debits/credits per account up to an optional date. */
async function accountActivity(ctx: ServiceContext, asOf?: Date) {
  // Only include posted entries — explicitly exclude draft and void.
  const conds = [
    eq(journalEntries.companyId, ctx.companyId),
    eq(journalEntries.status, 'posted'),
  ];
  if (asOf) conds.push(lte(journalEntries.date, asOf));

  const rows = await ctx.db
    .select({
      accountId: journalEntryLines.accountId,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      debit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}), 0)`,
      credit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .innerJoin(accounts, eq(journalEntryLines.accountId, accounts.id))
    .where(and(...conds))
    .groupBy(journalEntryLines.accountId, accounts.code, accounts.name, accounts.type);

  return rows;
}

export async function trialBalance(
  ctx: ServiceContext,
  asOf?: Date,
): Promise<{ rows: TrialBalanceRow[]; totalDebit: string; totalCredit: string; balanced: boolean }> {
  const activity = await accountActivity(ctx, asOf);
  const rows: TrialBalanceRow[] = [];
  let totalDebit = Money.zero();
  let totalCredit = Money.zero();

  for (const a of activity) {
    const net = Money.sub(a.debit, a.credit); // positive => net debit
    const debit = net.greaterThan(0) ? net : Money.zero();
    const credit = net.lessThan(0) ? net.negated() : Money.zero();
    if (debit.isZero() && credit.isZero()) continue;
    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);
    rows.push({
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      type: a.type,
      debit: toAmountString(debit),
      credit: toAmountString(credit),
    });
  }
  rows.sort((x, y) => x.code.localeCompare(y.code));
  return {
    rows,
    totalDebit: toAmountString(totalDebit),
    totalCredit: toAmountString(totalCredit),
    balanced: Money.equalWithinCent(totalDebit, totalCredit),
  };
}

export interface ReportLine {
  accountId: string;
  code: string;
  name: string;
  amount: string;
}

export interface ProfitAndLoss {
  income: ReportLine[];
  expenses: ReportLine[];
  totalIncome: string;
  totalExpenses: string;
  netIncome: string;
  from?: string;
  to?: string;
  /** Echoed back when the report was filtered to a single class. */
  classId?: string;
}

/**
 * Profit & Loss for a date range (revenue - expenses).
 * Optionally filtered to a single class dimension (opts.classId) — only
 * journal lines tagged with that class are included.
 */
export async function profitAndLoss(
  ctx: ServiceContext,
  range?: { from?: Date; to?: Date },
  opts?: { classId?: string },
): Promise<ProfitAndLoss> {
  const conds = [
    eq(journalEntries.companyId, ctx.companyId),
    eq(journalEntries.status, 'posted'),
    // Year-end closing entries must not wipe out closed-year P&L history.
    notFiscalCloseEntry(),
  ];
  if (range?.from) conds.push(sql`${journalEntries.date} >= ${range.from}`);
  if (range?.to) conds.push(lte(journalEntries.date, range.to));
  if (opts?.classId) conds.push(eq(journalEntryLines.classId, opts.classId));

  const rows = await ctx.db
    .select({
      accountId: journalEntryLines.accountId,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      debit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}), 0)`,
      credit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .innerJoin(accounts, eq(journalEntryLines.accountId, accounts.id))
    .where(and(...conds))
    .groupBy(journalEntryLines.accountId, accounts.code, accounts.name, accounts.type);

  const income: ReportLine[] = [];
  const expenses: ReportLine[] = [];
  let totalIncome = Money.zero();
  let totalExpenses = Money.zero();

  for (const r of rows) {
    if (r.type === 'revenue') {
      const amt = Money.sub(r.credit, r.debit); // credit-normal
      income.push({ accountId: r.accountId, code: r.code, name: r.name, amount: toAmountString(amt) });
      totalIncome = totalIncome.plus(amt);
    } else if (r.type === 'expense') {
      const amt = Money.sub(r.debit, r.credit); // debit-normal
      expenses.push({ accountId: r.accountId, code: r.code, name: r.name, amount: toAmountString(amt) });
      totalExpenses = totalExpenses.plus(amt);
    }
  }
  income.sort((a, b) => a.code.localeCompare(b.code));
  expenses.sort((a, b) => a.code.localeCompare(b.code));

  return {
    income,
    expenses,
    totalIncome: toAmountString(totalIncome),
    totalExpenses: toAmountString(totalExpenses),
    netIncome: toAmountString(Money.sub(totalIncome, totalExpenses)),
    from: range?.from?.toISOString(),
    to: range?.to?.toISOString(),
    classId: opts?.classId,
  };
}

export interface BalanceSheet {
  assets: ReportLine[];
  liabilities: ReportLine[];
  equity: ReportLine[];
  totalAssets: string;
  totalLiabilities: string;
  totalEquity: string;
  /** Retained earnings (net income to date) folded into equity for the equation to hold. */
  retainedEarnings: string;
  balanced: boolean;
  asOf?: string;
}

/** Balance Sheet as of a date. Equity includes computed net income (retained earnings). */
export async function balanceSheet(ctx: ServiceContext, asOf?: Date): Promise<BalanceSheet> {
  const activity = await accountActivity(ctx, asOf);
  const assets: ReportLine[] = [];
  const liabilities: ReportLine[] = [];
  const equity: ReportLine[] = [];
  let totalAssets = Money.zero();
  let totalLiabilities = Money.zero();
  let totalEquity = Money.zero();
  let netIncome = Money.zero();

  for (const a of activity) {
    const debitNet = Money.sub(a.debit, a.credit);
    const naturalBalance = DEBIT_NORMAL.has(a.type) ? debitNet : debitNet.negated();
    const line: ReportLine = {
      accountId: a.accountId,
      code: a.code,
      name: a.name,
      amount: toAmountString(naturalBalance),
    };
    if (a.type === 'asset') {
      assets.push(line);
      totalAssets = totalAssets.plus(naturalBalance);
    } else if (a.type === 'liability') {
      liabilities.push(line);
      totalLiabilities = totalLiabilities.plus(naturalBalance);
    } else if (a.type === 'equity') {
      equity.push(line);
      totalEquity = totalEquity.plus(naturalBalance);
    } else if (a.type === 'revenue') {
      netIncome = netIncome.plus(naturalBalance);
    } else if (a.type === 'expense') {
      netIncome = netIncome.minus(naturalBalance);
    }
  }

  const totalEquityWithRE = totalEquity.plus(netIncome);
  [assets, liabilities, equity].forEach((g) => g.sort((a, b) => a.code.localeCompare(b.code)));

  return {
    assets,
    liabilities,
    equity,
    totalAssets: toAmountString(totalAssets),
    totalLiabilities: toAmountString(totalLiabilities),
    totalEquity: toAmountString(totalEquityWithRE),
    retainedEarnings: toAmountString(netIncome),
    balanced: Money.equalWithinCent(totalAssets, totalLiabilities.plus(totalEquityWithRE)),
    asOf: asOf?.toISOString(),
  };
}
