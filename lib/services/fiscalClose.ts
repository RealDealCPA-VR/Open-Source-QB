/**
 * Year-end fiscal close service.
 *
 * yearEndClose computes net income for a fiscal year (sum of all posted revenue
 * minus sum of all posted expenses) and posts a single balanced closing journal
 * entry that zeroes out P&L accounts into Retained Earnings (COA code 3900).
 *
 * Closing entry mechanics:
 *   Revenue accounts are credit-normal. To zero them out: DEBIT each revenue account.
 *   Expense accounts are debit-normal.  To zero them out: CREDIT each expense account.
 *   The net difference (net income) flows to Retained Earnings 3900:
 *     - If net income > 0  (profitable year): CREDIT 3900 (increases equity)
 *     - If net income < 0  (net loss):        DEBIT  3900 (decreases equity)
 *   The entry is always balanced by construction:
 *     totalDebits(revenue zeroing) = totalCredits(expense zeroing) + 3900 credit  [profit]
 *     totalDebits(revenue zeroing) + 3900 debit = totalCredits(expense zeroing)  [loss]
 */
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { accounts, journalEntries, journalEntryLines } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import { type ServiceContext, ServiceError } from './_base';
import { type PostingLine, postJournalEntry } from './posting';

export interface YearEndCloseInput {
  /** Four-digit fiscal year, e.g. 2024. Entries from Jan 1 through Dec 31 are included. */
  fiscalYear: number;
}

export interface YearEndCloseResult {
  /** The posted closing journal entry. */
  entry: Awaited<ReturnType<typeof postJournalEntry>>;
  netIncome: string;
  totalRevenue: string;
  totalExpenses: string;
}

/**
 * Run the year-end closing process for the given fiscal year.
 *
 * Steps:
 *  1. Aggregate all posted revenue and expense lines for the year.
 *  2. Look up the Retained Earnings account (COA code 3900) for the company.
 *  3. Build a balanced closing entry:
 *       - Dr each revenue account for its net credit balance (zeroing it out).
 *       - Cr each expense account for its net debit balance (zeroing it out).
 *       - Cr Retained Earnings for net income (or Dr if net loss).
 *  4. Post through postJournalEntry (balance enforcement + period-open check).
 *  5. Return the entry and summary figures.
 */
export async function yearEndClose(
  ctx: ServiceContext,
  input: YearEndCloseInput,
): Promise<YearEndCloseResult> {
  const { fiscalYear } = input;
  const yearStart = new Date(`${fiscalYear}-01-01T00:00:00.000Z`);
  const yearEnd = new Date(`${fiscalYear + 1}-01-01T00:00:00.000Z`); // exclusive upper bound

  // 1. Aggregate posted P&L activity for the year, per account.
  const plRows = await ctx.db
    .select({
      accountId: journalEntryLines.accountId,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
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
        gte(journalEntries.date, yearStart),
        lt(journalEntries.date, yearEnd),
      ),
    )
    .groupBy(
      journalEntryLines.accountId,
      accounts.code,
      accounts.name,
      accounts.type,
    );

  // 2. Separate into revenue / expense buckets and compute net balances.
  //    Revenue: credit-normal → net credit = credit - debit.
  //    Expense: debit-normal  → net debit  = debit  - credit.
  interface PLAccount {
    accountId: string;
    code: string;
    name: string;
    netBalance: string; // always non-negative (natural balance)
  }
  const revenueAccounts: PLAccount[] = [];
  const expenseAccounts: PLAccount[] = [];
  let totalRevenue = Money.zero();
  let totalExpenses = Money.zero();

  for (const row of plRows) {
    if (row.type === 'revenue') {
      const net = Money.sub(row.totalCredit, row.totalDebit); // credit-normal
      if (!net.isZero()) {
        revenueAccounts.push({ accountId: row.accountId, code: row.code, name: row.name, netBalance: toAmountString(net) });
        totalRevenue = totalRevenue.plus(net);
      }
    } else if (row.type === 'expense') {
      const net = Money.sub(row.totalDebit, row.totalCredit); // debit-normal
      if (!net.isZero()) {
        expenseAccounts.push({ accountId: row.accountId, code: row.code, name: row.name, netBalance: toAmountString(net) });
        totalExpenses = totalExpenses.plus(net);
      }
    }
  }

  if (revenueAccounts.length === 0 && expenseAccounts.length === 0) {
    throw new ServiceError(
      'VALIDATION',
      `No posted revenue or expense activity found for fiscal year ${fiscalYear}. Nothing to close.`,
    );
  }

  // 3. Find the Retained Earnings account (code 3900) for this company.
  const [reAccount] = await ctx.db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(
      and(
        eq(accounts.companyId, ctx.companyId),
        eq(accounts.code, '3900'),
      ),
    )
    .limit(1);

  if (!reAccount) {
    throw new ServiceError(
      'NOT_FOUND',
      'Retained Earnings account (code 3900) not found. Please create it before running year-end close.',
    );
  }

  // 4. Build the balanced closing entry lines.
  //
  //   For each revenue account: Dr the account for its net credit balance.
  //   For each expense account: Cr the account for its net debit balance.
  //   Net income = revenue - expenses.
  //     If positive: Cr Retained Earnings (equity increases).
  //     If negative: Dr Retained Earnings (equity decreases).
  //
  //   Proof of balance:
  //     Debits  = sum(revenue debits) + [Dr RE if loss]
  //     Credits = sum(expense credits) + [Cr RE if profit]
  //     Net income = revenue - expenses
  //     If profit: debits(revenue) = credits(expenses) + credits(RE)  ✓
  //     If loss:   debits(revenue) + debits(RE) = credits(expenses)   ✓
  //     If zero:   debits(revenue) = credits(expenses)                ✓

  const netIncome = totalRevenue.minus(totalExpenses);
  const lines: PostingLine[] = [];

  for (const r of revenueAccounts) {
    lines.push({
      accountId: r.accountId,
      debit: r.netBalance,
      memo: `Close ${fiscalYear} revenue: ${r.code} ${r.name}`,
    });
  }

  for (const e of expenseAccounts) {
    lines.push({
      accountId: e.accountId,
      credit: e.netBalance,
      memo: `Close ${fiscalYear} expense: ${e.code} ${e.name}`,
    });
  }

  // Retained Earnings offset — only add if non-zero to avoid a zero-amount line.
  if (!netIncome.isZero()) {
    if (netIncome.greaterThan(0)) {
      // Profitable year: credit Retained Earnings.
      lines.push({
        accountId: reAccount.id,
        credit: toAmountString(netIncome),
        memo: `${fiscalYear} net income to retained earnings`,
      });
    } else {
      // Net loss: debit Retained Earnings.
      lines.push({
        accountId: reAccount.id,
        debit: toAmountString(netIncome.abs()),
        memo: `${fiscalYear} net loss to retained earnings`,
      });
    }
  }

  // Edge case: revenue == expenses (net income = 0) means debits(revenue) already equal
  // credits(expenses), so the entry is balanced without a RE line. postJournalEntry will
  // verify this via assertBalanced.

  // 5. Post through the engine (enforces balance, period-open check, audit log).
  const closingDate = new Date(`${fiscalYear}-12-31T23:59:59.000Z`);
  const entry = await postJournalEntry(ctx, {
    date: closingDate,
    description: `Year-End Closing Entry — Fiscal Year ${fiscalYear}`,
    reference: `CLOSE-${fiscalYear}`,
    status: 'posted',
    lines,
    sourceRef: `fiscal-close:${fiscalYear}`,
  });

  return {
    entry,
    netIncome: toAmountString(netIncome),
    totalRevenue: toAmountString(totalRevenue),
    totalExpenses: toAmountString(totalExpenses),
  };
}
