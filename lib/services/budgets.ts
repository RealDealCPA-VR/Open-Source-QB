/**
 * Budgets service — create/read budgets and budget lines, plus budget-vs-actual comparison.
 *
 * Design notes:
 *  - Budgets are company-scoped and keyed by name + fiscalYear.
 *  - Budget lines are monthly amounts per account (month 1-12). setBudgetLine upserts.
 *  - budgetVsActual calls profitAndLoss for the budget's fiscal year and matches income/expense
 *    accounts by accountId, returning [{accountId, code, name, budget, actual, variance}].
 */
import { and, eq } from 'drizzle-orm';
import { accounts, budgetLines, budgets } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import { profitAndLoss } from '@/lib/services/reports';
import type { ServiceContext } from './_base';
import { notFound, validation, writeAudit } from './_base';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Budget {
  id: string;
  name: string;
  fiscalYear: number;
  createdAt: Date;
}

export interface BudgetLine {
  id: string;
  budgetId: string;
  accountId: string;
  month: number;
  amount: string;
}

export interface BudgetWithLines extends Budget {
  lines: BudgetLine[];
}

export interface BudgetVsActualRow {
  accountId: string;
  code: string;
  name: string;
  /** 'revenue' or 'expense' — balance-sheet accounts are not budgetable. */
  accountType: 'revenue' | 'expense';
  /** Sum of all 12 monthly budget amounts for this account. */
  budget: string;
  /** Actual activity from the GL for the full fiscal year. */
  actual: string;
  /** Raw signed variance: actual - budget. */
  variance: string;
  /**
   * Favorability orientation: revenue is favorable when actual >= budget;
   * expense is favorable when actual <= budget.
   */
  favorable: boolean;
}

export interface BudgetSectionTotals {
  budget: string;
  actual: string;
  /** actual - budget. */
  variance: string;
}

export interface BudgetVsActualReport {
  budgetId: string;
  budgetName: string;
  fiscalYear: number;
  rows: BudgetVsActualRow[];
  /** Income (revenue) section totals. */
  income: BudgetSectionTotals;
  /** Expense section totals. */
  expense: BudgetSectionTotals;
  /**
   * Net bottom line (income - expense). The legacy totalBudget/totalActual/
   * totalVariance fields carry these net figures — income and expenses are never
   * summed together as one mixed total.
   */
  netBudget: string;
  netActual: string;
  netVariance: string;
  totalBudget: string;
  totalActual: string;
  totalVariance: string;
}

// ---------------------------------------------------------------------------
// listBudgets
// ---------------------------------------------------------------------------

export async function listBudgets(ctx: ServiceContext): Promise<Budget[]> {
  const rows = await ctx.db
    .select()
    .from(budgets)
    .where(eq(budgets.companyId, ctx.companyId))
    .orderBy(budgets.fiscalYear, budgets.name);
  return rows;
}

// ---------------------------------------------------------------------------
// createBudget
// ---------------------------------------------------------------------------

export async function createBudget(
  ctx: ServiceContext,
  input: { name: string; fiscalYear: number },
): Promise<Budget> {
  const { name, fiscalYear } = input;
  if (!name?.trim()) throw validation('Budget name is required');
  if (!fiscalYear || fiscalYear < 2000 || fiscalYear > 2100) {
    throw validation('fiscalYear must be a 4-digit year between 2000 and 2100');
  }

  const [row] = await ctx.db
    .insert(budgets)
    .values({ companyId: ctx.companyId, name: name.trim(), fiscalYear })
    .returning();

  await writeAudit(ctx, {
    action: 'create',
    entityType: 'budget',
    entityId: row.id,
    newValues: { name: row.name, fiscalYear: row.fiscalYear },
  });

  return row;
}

// ---------------------------------------------------------------------------
// getBudget (with lines)
// ---------------------------------------------------------------------------

export async function getBudget(ctx: ServiceContext, id: string): Promise<BudgetWithLines> {
  const [budget] = await ctx.db
    .select()
    .from(budgets)
    .where(and(eq(budgets.id, id), eq(budgets.companyId, ctx.companyId)));

  if (!budget) throw notFound('Budget');

  const lines = await ctx.db
    .select()
    .from(budgetLines)
    .where(eq(budgetLines.budgetId, id))
    .orderBy(budgetLines.accountId, budgetLines.month);

  return { ...budget, lines };
}

// ---------------------------------------------------------------------------
// setBudgetLine (upsert)
// ---------------------------------------------------------------------------

export async function setBudgetLine(
  ctx: ServiceContext,
  input: { budgetId: string; accountId: string; month: number; amount: string },
): Promise<BudgetLine> {
  const { budgetId, accountId, month, amount } = input;

  // Verify budget belongs to this company.
  const [budget] = await ctx.db
    .select()
    .from(budgets)
    .where(and(eq(budgets.id, budgetId), eq(budgets.companyId, ctx.companyId)));
  if (!budget) throw notFound('Budget');

  if (month < 1 || month > 12) throw validation('month must be between 1 and 12');
  if (!amount || isNaN(Number(amount))) throw validation('amount must be a valid number');

  // Verify account belongs to this company.
  const [account] = await ctx.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.companyId, ctx.companyId)));
  if (!account) throw notFound('Account');

  // Budgets compare against P&L actuals — balance-sheet accounts have no P&L
  // activity to compare to and would always report actual = 0.
  if (account.type !== 'revenue' && account.type !== 'expense') {
    throw validation('Budget lines can only be set for revenue or expense accounts.');
  }

  // Upsert: PGlite supports ON CONFLICT via Drizzle's onConflictDoUpdate.
  // The unique constraint is (budgetId, accountId, month) — enforced at app level since
  // there is no DB unique index defined in schema; we query-then-upsert.
  const existing = await ctx.db
    .select()
    .from(budgetLines)
    .where(
      and(
        eq(budgetLines.budgetId, budgetId),
        eq(budgetLines.accountId, accountId),
        eq(budgetLines.month, month),
      ),
    );

  let line: BudgetLine;
  const normalizedAmount = toAmountString(amount);

  if (existing.length > 0) {
    const [updated] = await ctx.db
      .update(budgetLines)
      .set({ amount: normalizedAmount })
      .where(eq(budgetLines.id, existing[0].id))
      .returning();
    line = updated;
    await writeAudit(ctx, {
      action: 'update',
      entityType: 'budgetLine',
      entityId: line.id,
      oldValues: { amount: existing[0].amount },
      newValues: { amount: normalizedAmount },
    });
  } else {
    const [inserted] = await ctx.db
      .insert(budgetLines)
      .values({ budgetId, accountId, month, amount: normalizedAmount })
      .returning();
    line = inserted;
    await writeAudit(ctx, {
      action: 'create',
      entityType: 'budgetLine',
      entityId: line.id,
      newValues: { budgetId, accountId, month, amount: normalizedAmount },
    });
  }

  return line;
}

// ---------------------------------------------------------------------------
// budgetVsActual
// ---------------------------------------------------------------------------

/**
 * For each account that has at least one budget line, sum the budgeted amounts
 * (all months), then fetch actual P&L for the full fiscal year and match by accountId.
 * Returns rows sorted by account code.
 */
export async function budgetVsActual(
  ctx: ServiceContext,
  budgetId: string,
): Promise<BudgetVsActualReport> {
  const [budget] = await ctx.db
    .select()
    .from(budgets)
    .where(and(eq(budgets.id, budgetId), eq(budgets.companyId, ctx.companyId)));
  if (!budget) throw notFound('Budget');

  // Sum budget lines per account.
  const lines = await ctx.db
    .select()
    .from(budgetLines)
    .where(eq(budgetLines.budgetId, budgetId));

  // Aggregate budget by accountId.
  const budgetByAccount = new Map<string, ReturnType<typeof Money.zero>>();
  for (const line of lines) {
    const prev = budgetByAccount.get(line.accountId) ?? Money.zero();
    budgetByAccount.set(line.accountId, prev.plus(Money.of(line.amount)));
  }

  // Fetch full-year P&L actuals (closing entries are already excluded there).
  const from = new Date(`${budget.fiscalYear}-01-01T00:00:00.000Z`);
  const to = new Date(`${budget.fiscalYear}-12-31T23:59:59.999Z`);
  const pl = await profitAndLoss(ctx, { from, to });

  // Build a map of accountId -> actual amount from P&L.
  const actualByAccount = new Map<string, string>();
  for (const line of [...pl.income, ...pl.expenses]) {
    actualByAccount.set(line.accountId, line.amount);
  }

  // Fetch account metadata for all budgeted accounts.
  const accountIds = [...budgetByAccount.keys()];
  const accountRows = await ctx.db
    .select({ id: accounts.id, code: accounts.code, name: accounts.name, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId)));

  const accountMeta = new Map(
    accountRows.map((a) => [a.id, { code: a.code, name: a.name, type: a.type }]),
  );

  // Build result rows, sectioned into income vs expense — the two must never be
  // summed into one mixed total (their natural balances point opposite ways).
  const rows: BudgetVsActualRow[] = [];
  let incomeBudget = Money.zero();
  let incomeActual = Money.zero();
  let expenseBudget = Money.zero();
  let expenseActual = Money.zero();

  for (const accountId of accountIds) {
    const meta = accountMeta.get(accountId);
    if (!meta) continue; // account deleted — skip
    // Legacy budget lines saved against balance-sheet accounts have no P&L actuals
    // to compare to — skip them (setBudgetLine now rejects new ones).
    if (meta.type !== 'revenue' && meta.type !== 'expense') continue;

    const isRevenue = meta.type === 'revenue';
    const budgetAmt = budgetByAccount.get(accountId) ?? Money.zero();
    const actualAmt = Money.of(actualByAccount.get(accountId) ?? '0');
    const variance = actualAmt.minus(budgetAmt);

    if (isRevenue) {
      incomeBudget = incomeBudget.plus(budgetAmt);
      incomeActual = incomeActual.plus(actualAmt);
    } else {
      expenseBudget = expenseBudget.plus(budgetAmt);
      expenseActual = expenseActual.plus(actualAmt);
    }

    rows.push({
      accountId,
      code: meta.code,
      name: meta.name,
      accountType: meta.type,
      budget: toAmountString(budgetAmt),
      actual: toAmountString(actualAmt),
      variance: toAmountString(variance),
      // Over-target income is favorable; over-budget expense is unfavorable.
      favorable: isRevenue
        ? actualAmt.greaterThanOrEqualTo(budgetAmt)
        : actualAmt.lessThanOrEqualTo(budgetAmt),
    });
  }

  rows.sort((a, b) => a.code.localeCompare(b.code));

  const netBudget = incomeBudget.minus(expenseBudget);
  const netActual = incomeActual.minus(expenseActual);
  const netVariance = netActual.minus(netBudget);

  return {
    budgetId,
    budgetName: budget.name,
    fiscalYear: budget.fiscalYear,
    rows,
    income: {
      budget: toAmountString(incomeBudget),
      actual: toAmountString(incomeActual),
      variance: toAmountString(incomeActual.minus(incomeBudget)),
    },
    expense: {
      budget: toAmountString(expenseBudget),
      actual: toAmountString(expenseActual),
      variance: toAmountString(expenseActual.minus(expenseBudget)),
    },
    netBudget: toAmountString(netBudget),
    netActual: toAmountString(netActual),
    netVariance: toAmountString(netVariance),
    // Legacy fields now carry the net bottom line (income - expense).
    totalBudget: toAmountString(netBudget),
    totalActual: toAmountString(netActual),
    totalVariance: toAmountString(netVariance),
  };
}
