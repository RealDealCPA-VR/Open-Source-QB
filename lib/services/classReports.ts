/**
 * Class-based reporting — QuickBooks-style class tracking.
 *
 * Two reports:
 *  - profitAndLossByClass: P&L matrix with accounts as rows, classes as columns.
 *  - budgetVsActualByClass: budget vs actual broken out by (account, class) pairs.
 *
 * Null classId on a journal entry line is reported as "Unclassified".
 */
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { accounts, budgetLines, budgets, classes, journalEntries, journalEntryLines } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import type { ServiceContext } from './_base';
import { notFound } from './_base';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const UNCLASSIFIED_ID = '__unclassified__';
const UNCLASSIFIED_NAME = 'Unclassified';
const INCOME_EXPENSE_TYPES = ['revenue', 'expense'] as const;

// ---------------------------------------------------------------------------
// P&L by Class
// ---------------------------------------------------------------------------

export interface PLClassColumn {
  classId: string; // UNCLASSIFIED_ID for untagged lines
  className: string;
}

export interface PLByClassRow {
  accountId: string;
  code: string;
  name: string;
  type: 'revenue' | 'expense';
  /** Amount keyed by classId (including UNCLASSIFIED_ID). Positive = natural balance. */
  byClass: Record<string, string>;
}

export interface ProfitAndLossByClassResult {
  /** Ordered list of class columns (includes Unclassified if any untagged lines exist). */
  classes: PLClassColumn[];
  rows: PLByClassRow[];
  /** Sum of natural-balance amounts per classId across all accounts. */
  totalsByClass: Record<string, string>;
  /** Net income (revenue - expense) per classId. */
  netByClass: Record<string, string>;
  from?: string;
  to?: string;
}

export async function profitAndLossByClass(
  ctx: ServiceContext,
  range?: { from?: Date; to?: Date },
): Promise<ProfitAndLossByClassResult> {
  // ---- Query posted revenue/expense lines, grouped by (account, classId) ----
  const entryConds = [
    eq(journalEntries.companyId, ctx.companyId),
    eq(journalEntries.status, 'posted'),
  ];
  if (range?.from) entryConds.push(sql`${journalEntries.date} >= ${range.from}`);
  if (range?.to) entryConds.push(lte(journalEntries.date, range.to));

  const rows = await ctx.db
    .select({
      accountId: journalEntryLines.accountId,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      classId: journalEntryLines.classId,
      debit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}), 0)`,
      credit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .innerJoin(accounts, eq(journalEntryLines.accountId, accounts.id))
    .where(and(...entryConds))
    .groupBy(
      journalEntryLines.accountId,
      accounts.code,
      accounts.name,
      accounts.type,
      journalEntryLines.classId,
    );

  // Filter to revenue/expense only.
  const incomeExpense = rows.filter((r) => r.type === 'revenue' || r.type === 'expense');

  // ---- Collect all referenced classIds (non-null) ----
  const classIdSet = new Set<string>();
  let hasUnclassified = false;
  for (const r of incomeExpense) {
    if (r.classId) {
      classIdSet.add(r.classId);
    } else {
      hasUnclassified = true;
    }
  }

  // ---- Load class names from the DB ----
  const classIdList = [...classIdSet];
  const classNameMap = new Map<string, string>();
  if (classIdList.length > 0) {
    const classRows = await ctx.db
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .where(and(eq(classes.companyId, ctx.companyId), inArray(classes.id, classIdList)));
    for (const c of classRows) {
      classNameMap.set(c.id, c.name);
    }
  }

  // ---- Build ordered column list ----
  const classColumns: PLClassColumn[] = classIdList
    .map((id) => ({ classId: id, className: classNameMap.get(id) ?? id }))
    .sort((a, b) => a.className.localeCompare(b.className));
  if (hasUnclassified) {
    classColumns.push({ classId: UNCLASSIFIED_ID, className: UNCLASSIFIED_NAME });
  }

  const allClassIds = classColumns.map((c) => c.classId);

  // ---- Aggregate per (accountId, classId) ----
  type AcctKey = string;
  const acctMeta = new Map<AcctKey, { code: string; name: string; type: 'revenue' | 'expense' }>();
  // byClass[accountId][classId] = natural-balance amount
  const byClassMap = new Map<AcctKey, Map<string, ReturnType<typeof Money.zero>>>();

  for (const r of incomeExpense) {
    const type = r.type as 'revenue' | 'expense';
    const cid = r.classId ?? UNCLASSIFIED_ID;

    if (!acctMeta.has(r.accountId)) {
      acctMeta.set(r.accountId, { code: r.code, name: r.name, type });
    }
    if (!byClassMap.has(r.accountId)) {
      byClassMap.set(r.accountId, new Map());
    }
    const colMap = byClassMap.get(r.accountId)!;

    // Natural balance: revenue → credit - debit; expense → debit - credit
    const naturalAmt =
      type === 'revenue' ? Money.sub(r.credit, r.debit) : Money.sub(r.debit, r.credit);

    const prev = colMap.get(cid) ?? Money.zero();
    colMap.set(cid, prev.plus(naturalAmt));
  }

  // ---- Build result rows ----
  const resultRows: PLByClassRow[] = [];
  // totalsByClass accumulates per class; revenueByClass for net calc
  const totalsByClass = new Map<string, ReturnType<typeof Money.zero>>(
    allClassIds.map((id) => [id, Money.zero()]),
  );
  const revenueByClass = new Map<string, ReturnType<typeof Money.zero>>(
    allClassIds.map((id) => [id, Money.zero()]),
  );
  const expenseByClass = new Map<string, ReturnType<typeof Money.zero>>(
    allClassIds.map((id) => [id, Money.zero()]),
  );

  // Sort accounts by code
  const sortedAccountIds = [...acctMeta.keys()].sort((a, b) => {
    const codeA = acctMeta.get(a)!.code;
    const codeB = acctMeta.get(b)!.code;
    return codeA.localeCompare(codeB);
  });

  for (const accountId of sortedAccountIds) {
    const meta = acctMeta.get(accountId)!;
    const colMap = byClassMap.get(accountId) ?? new Map();
    const byClass: Record<string, string> = {};

    for (const cid of allClassIds) {
      const amt = colMap.get(cid) ?? Money.zero();
      byClass[cid] = toAmountString(amt);

      const prev = totalsByClass.get(cid) ?? Money.zero();
      totalsByClass.set(cid, prev.plus(amt));

      if (meta.type === 'revenue') {
        const r = revenueByClass.get(cid) ?? Money.zero();
        revenueByClass.set(cid, r.plus(amt));
      } else {
        const e = expenseByClass.get(cid) ?? Money.zero();
        expenseByClass.set(cid, e.plus(amt));
      }
    }

    resultRows.push({ accountId, code: meta.code, name: meta.name, type: meta.type, byClass });
  }

  // ---- Build totals / net by class ----
  const totalsByClassResult: Record<string, string> = {};
  const netByClassResult: Record<string, string> = {};
  for (const cid of allClassIds) {
    totalsByClassResult[cid] = toAmountString(totalsByClass.get(cid) ?? Money.zero());
    const rev = revenueByClass.get(cid) ?? Money.zero();
    const exp = expenseByClass.get(cid) ?? Money.zero();
    netByClassResult[cid] = toAmountString(rev.minus(exp));
  }

  return {
    classes: classColumns,
    rows: resultRows,
    totalsByClass: totalsByClassResult,
    netByClass: netByClassResult,
    from: range?.from?.toISOString(),
    to: range?.to?.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Budget vs Actual by Class
// ---------------------------------------------------------------------------

export interface BudgetVsActualByClassRow {
  accountId: string;
  code: string;
  name: string;
  classId: string; // UNCLASSIFIED_ID for null
  className: string;
  budget: string;
  actual: string;
  variance: string; // actual - budget
}

export interface BudgetVsActualByClassResult {
  budgetId: string;
  budgetName: string;
  fiscalYear: number;
  rows: BudgetVsActualByClassRow[];
  totalBudget: string;
  totalActual: string;
  totalVariance: string;
}

export async function budgetVsActualByClass(
  ctx: ServiceContext,
  budgetId: string,
): Promise<BudgetVsActualByClassResult> {
  // ---- Load budget header ----
  const [budget] = await ctx.db
    .select()
    .from(budgets)
    .where(and(eq(budgets.id, budgetId), eq(budgets.companyId, ctx.companyId)));
  if (!budget) throw notFound('Budget');

  // ---- Load budget lines (may have classId) ----
  const lines = await ctx.db
    .select()
    .from(budgetLines)
    .where(eq(budgetLines.budgetId, budgetId));

  if (lines.length === 0) {
    return {
      budgetId,
      budgetName: budget.name,
      fiscalYear: budget.fiscalYear,
      rows: [],
      totalBudget: '0.00',
      totalActual: '0.00',
      totalVariance: '0.00',
    };
  }

  // Aggregate budget by (accountId, classId).
  // Map key = "accountId|classId" (classId may be null -> UNCLASSIFIED_ID).
  const budgetMap = new Map<string, ReturnType<typeof Money.zero>>();
  const keyOf = (accountId: string, classId: string | null) =>
    `${accountId}|${classId ?? UNCLASSIFIED_ID}`;

  for (const line of lines) {
    const k = keyOf(line.accountId, line.classId);
    const prev = budgetMap.get(k) ?? Money.zero();
    budgetMap.set(k, prev.plus(Money.of(line.amount)));
  }

  // ---- Collect account ids and class ids referenced in budget lines ----
  const budgetAccountIds = [...new Set(lines.map((l) => l.accountId))];
  const budgetClassIds = [
    ...new Set(lines.map((l) => l.classId).filter((id): id is string => id !== null)),
  ];

  // ---- Load account metadata (type, code, name) ----
  const accountRows = await ctx.db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), inArray(accounts.id, budgetAccountIds)));
  const accountMeta = new Map(accountRows.map((a) => [a.id, a]));

  // ---- Load class names ----
  const classNameMap = new Map<string, string>();
  if (budgetClassIds.length > 0) {
    const classRows = await ctx.db
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .where(and(eq(classes.companyId, ctx.companyId), inArray(classes.id, budgetClassIds)));
    for (const c of classRows) classNameMap.set(c.id, c.name);
  }

  // ---- Query actual posted lines for the budget's fiscal year ----
  const from = new Date(`${budget.fiscalYear}-01-01T00:00:00.000Z`);
  const to = new Date(`${budget.fiscalYear}-12-31T23:59:59.999Z`);

  const actualRows = await ctx.db
    .select({
      accountId: journalEntryLines.accountId,
      classId: journalEntryLines.classId,
      debit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}), 0)`,
      credit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.companyId, ctx.companyId),
        eq(journalEntries.status, 'posted'),
        sql`${journalEntries.date} >= ${from}`,
        lte(journalEntries.date, to),
        inArray(journalEntryLines.accountId, budgetAccountIds),
      ),
    )
    .groupBy(journalEntryLines.accountId, journalEntryLines.classId);

  // Build actual map keyed by (accountId, classId).
  const actualMap = new Map<string, ReturnType<typeof Money.zero>>();
  for (const ar of actualRows) {
    const meta = accountMeta.get(ar.accountId);
    if (!meta) continue;
    const type = meta.type as string;
    // Natural balance per account type
    const naturalAmt =
      type === 'revenue' ? Money.sub(ar.credit, ar.debit) : Money.sub(ar.debit, ar.credit);
    const k = keyOf(ar.accountId, ar.classId);
    const prev = actualMap.get(k) ?? Money.zero();
    actualMap.set(k, prev.plus(naturalAmt));
  }

  // ---- Build result rows ----
  const resultRows: BudgetVsActualByClassRow[] = [];
  let totalBudget = Money.zero();
  let totalActual = Money.zero();

  for (const [key, budgetAmt] of budgetMap) {
    const [accountId, cid] = key.split('|');
    const meta = accountMeta.get(accountId);
    if (!meta) continue; // account deleted — skip

    const actualAmt = actualMap.get(key) ?? Money.zero();
    const variance = actualAmt.minus(budgetAmt);

    totalBudget = totalBudget.plus(budgetAmt);
    totalActual = totalActual.plus(actualAmt);

    resultRows.push({
      accountId,
      code: meta.code,
      name: meta.name,
      classId: cid,
      className: cid === UNCLASSIFIED_ID ? UNCLASSIFIED_NAME : (classNameMap.get(cid) ?? cid),
      budget: toAmountString(budgetAmt),
      actual: toAmountString(actualAmt),
      variance: toAmountString(variance),
    });
  }

  resultRows.sort((a, b) => {
    const codeComp = a.code.localeCompare(b.code);
    if (codeComp !== 0) return codeComp;
    return a.className.localeCompare(b.className);
  });

  const totalVariance = totalActual.minus(totalBudget);

  return {
    budgetId,
    budgetName: budget.name,
    fiscalYear: budget.fiscalYear,
    rows: resultRows,
    totalBudget: toAmountString(totalBudget),
    totalActual: toAmountString(totalActual),
    totalVariance: toAmountString(totalVariance),
  };
}
