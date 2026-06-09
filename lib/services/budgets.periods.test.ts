/**
 * Integration tests for budgetVsActual period columns (monthly | quarterly).
 *
 * Seeds a budget with month-specific lines, posts actuals into specific
 * months, then verifies the per-period budget/actual/variance buckets and the
 * net per-period totals — for both column modes and for the no-mode (annual)
 * legacy shape, which must stay unchanged.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { companies, users } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { postJournalEntry } from './posting';
import { createBudget, setBudgetLine, budgetVsActual } from './budgets';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-budget-periods-3c9d1b');
let ctx: ServiceContext;
let db: DB;
const acct: Record<string, string> = {};
let budgetId: string;

describe('budgetVsActual period columns', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'periods@test.local', name: 'Periods Tester', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Periods Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Cash', 'asset', 'checking'],
      ['4000', 'Revenue', 'revenue', 'sales'],
      ['5000', 'Rent', 'expense', 'operating_expenses'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }

    const budget = await createBudget(ctx, { name: 'FY2025 Periods', fiscalYear: 2025 });
    budgetId = budget.id;

    // Budget: revenue $1,000 in Jan, $2,000 in Apr; rent $300 in Feb.
    await setBudgetLine(ctx, { budgetId, accountId: acct['4000'], month: 1, amount: '1000.00' });
    await setBudgetLine(ctx, { budgetId, accountId: acct['4000'], month: 4, amount: '2000.00' });
    await setBudgetLine(ctx, { budgetId, accountId: acct['5000'], month: 2, amount: '300.00' });

    // Actuals: revenue $1,500 on Jan 15, $500 on May 10; rent $250 on Feb 5.
    await postJournalEntry(ctx, {
      date: new Date(2025, 0, 15),
      description: 'Jan revenue',
      lines: [
        { accountId: acct['1000'], debit: '1500.00' },
        { accountId: acct['4000'], credit: '1500.00' },
      ],
    });
    await postJournalEntry(ctx, {
      date: new Date(2025, 4, 10),
      description: 'May revenue',
      lines: [
        { accountId: acct['1000'], debit: '500.00' },
        { accountId: acct['4000'], credit: '500.00' },
      ],
    });
    await postJournalEntry(ctx, {
      date: new Date(2025, 1, 5),
      description: 'Feb rent',
      lines: [
        { accountId: acct['5000'], debit: '250.00' },
        { accountId: acct['1000'], credit: '250.00' },
      ],
    });
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns the legacy annual shape when no period mode is requested', async () => {
    const report = await budgetVsActual(ctx, budgetId);
    expect(report.periodLabels).toBeUndefined();
    expect(report.periodNetTotals).toBeUndefined();
    for (const row of report.rows) expect(row.periods).toBeUndefined();

    const rev = report.rows.find((r) => r.accountId === acct['4000'])!;
    expect(rev.budget).toBe('3000.00');
    expect(rev.actual).toBe('2000.00');
  });

  it('monthly mode returns 12 labeled period cells per row', async () => {
    const report = await budgetVsActual(ctx, budgetId, { periods: 'monthly' });
    expect(report.periodLabels).toEqual([
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ]);

    const rev = report.rows.find((r) => r.accountId === acct['4000'])!;
    expect(rev.periods).toHaveLength(12);
    // Jan: budget 1000, actual 1500 -> variance +500.
    expect(rev.periods![0]).toEqual({ budget: '1000.00', actual: '1500.00', variance: '500.00' });
    // Apr: budget 2000, actual 0 -> variance -2000.
    expect(rev.periods![3]).toEqual({ budget: '2000.00', actual: '0.00', variance: '-2000.00' });
    // May: no budget, actual 500.
    expect(rev.periods![4]).toEqual({ budget: '0.00', actual: '500.00', variance: '500.00' });
    // Annual totals on the row are unchanged.
    expect(rev.budget).toBe('3000.00');
    expect(rev.actual).toBe('2000.00');

    const rent = report.rows.find((r) => r.accountId === acct['5000'])!;
    expect(rent.periods![1]).toEqual({ budget: '300.00', actual: '250.00', variance: '-50.00' });
    expect(rent.periods![0]).toEqual({ budget: '0.00', actual: '0.00', variance: '0.00' });
  });

  it('monthly net totals are income minus expense per month', async () => {
    const report = await budgetVsActual(ctx, budgetId, { periods: 'monthly' });
    expect(report.periodNetTotals).toHaveLength(12);
    // Jan net: budget 1000 - 0, actual 1500 - 0.
    expect(report.periodNetTotals![0]).toEqual({
      budget: '1000.00',
      actual: '1500.00',
      variance: '500.00',
    });
    // Feb net: budget -300 (rent only), actual -250.
    expect(report.periodNetTotals![1]).toEqual({
      budget: '-300.00',
      actual: '-250.00',
      variance: '50.00',
    });
  });

  it('quarterly mode buckets months into 4 quarters', async () => {
    const report = await budgetVsActual(ctx, budgetId, { periods: 'quarterly' });
    expect(report.periodLabels).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);

    const rev = report.rows.find((r) => r.accountId === acct['4000'])!;
    expect(rev.periods).toHaveLength(4);
    // Q1: budget 1000 (Jan), actual 1500 (Jan).
    expect(rev.periods![0]).toEqual({ budget: '1000.00', actual: '1500.00', variance: '500.00' });
    // Q2: budget 2000 (Apr), actual 500 (May).
    expect(rev.periods![1]).toEqual({ budget: '2000.00', actual: '500.00', variance: '-1500.00' });
    // Q3/Q4 empty.
    expect(rev.periods![2].actual).toBe('0.00');
    expect(rev.periods![3].budget).toBe('0.00');

    // Net Q1: budget 1000 - 300 = 700; actual 1500 - 250 = 1250.
    expect(report.periodNetTotals![0]).toEqual({
      budget: '700.00',
      actual: '1250.00',
      variance: '550.00',
    });
  });
});
