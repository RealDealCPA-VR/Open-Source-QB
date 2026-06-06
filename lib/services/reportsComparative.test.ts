/**
 * Integration tests for reportsComparative.
 *
 * Boots a throw-away PGlite directory, seeds user + company + COA, posts journal
 * entries across two calendar periods, then asserts that:
 *   - comparative variance figures are arithmetically correct
 *   - monthly split produces the right per-month amounts
 *   - percent-of-income values are correct
 *   - trial balance stays balanced throughout
 *
 * Pattern mirrors reportsExtra.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { companies, users } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { postJournalEntry } from './posting';
import { trialBalance } from './reports';
import {
  profitAndLossComparative,
  profitAndLossByMonth,
  profitAndLossPercentOfIncome,
} from './reportsComparative';

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-reports-comparative');
let ctx: ServiceContext;
let db: DB;

/** account id by COA code */
const acct: Record<string, string> = {};

beforeAll(async () => {
  db = await getDb(TEST_DIR);

  const [user] = await db
    .insert(users)
    .values({ email: 'owner@comparative.test', name: 'Owner', passwordHash: 'x' })
    .returning();

  const [company] = await db
    .insert(companies)
    .values({ name: 'Comparative Reports Co', ownerId: user.id })
    .returning();

  ctx = { db, companyId: company.id, userId: user.id };

  // Minimal COA: one asset, one revenue, two expense accounts.
  const defs: Array<[string, string, string, string]> = [
    ['1000', 'Checking',            'asset',   'checking'],
    ['1200', 'Accounts Receivable', 'asset',   'accounts_receivable'],
    ['3000', "Owner's Equity",      'equity',  'owners_equity'],
    ['4000', 'Sales Income',        'revenue', 'sales'],
    ['4100', 'Service Revenue',     'revenue', 'sales'],
    ['6000', 'Advertising',         'expense', 'operating_expenses'],
    ['6100', 'Rent',                'expense', 'operating_expenses'],
  ];
  for (const [code, name, type, subtype] of defs) {
    const row = await createAccount(ctx, { code, name, type: type as never, subtype });
    acct[code] = row.id;
  }

  // -----------------------------------------------------------------------
  // Seed entries for PRIOR period: Jan-Jun 2024
  // -----------------------------------------------------------------------

  // Jan 2024 — income 1000
  await postJournalEntry(ctx, {
    date: new Date('2024-01-15'),
    description: 'Jan sales 2024',
    lines: [
      { accountId: acct['1000'], debit: '1000.00' },
      { accountId: acct['4000'], credit: '1000.00' },
    ],
  });

  // Feb 2024 — income 2000
  await postJournalEntry(ctx, {
    date: new Date('2024-02-15'),
    description: 'Feb sales 2024',
    lines: [
      { accountId: acct['1000'], debit: '2000.00' },
      { accountId: acct['4000'], credit: '2000.00' },
    ],
  });

  // Mar 2024 — expense 500
  await postJournalEntry(ctx, {
    date: new Date('2024-03-10'),
    description: 'Mar advertising 2024',
    lines: [
      { accountId: acct['6000'], debit: '500.00' },
      { accountId: acct['1000'], credit: '500.00' },
    ],
  });

  // -----------------------------------------------------------------------
  // Seed entries for CURRENT period: Jan-Jun 2025
  // -----------------------------------------------------------------------

  // Jan 2025 — income 1500 (sales) + 500 (service)
  await postJournalEntry(ctx, {
    date: new Date('2025-01-10'),
    description: 'Jan sales 2025',
    lines: [
      { accountId: acct['1000'], debit: '1500.00' },
      { accountId: acct['4000'], credit: '1500.00' },
    ],
  });

  await postJournalEntry(ctx, {
    date: new Date('2025-01-20'),
    description: 'Jan service revenue 2025',
    lines: [
      { accountId: acct['1000'], debit: '500.00' },
      { accountId: acct['4100'], credit: '500.00' },
    ],
  });

  // Feb 2025 — income 2500
  await postJournalEntry(ctx, {
    date: new Date('2025-02-14'),
    description: 'Feb sales 2025',
    lines: [
      { accountId: acct['1000'], debit: '2500.00' },
      { accountId: acct['4000'], credit: '2500.00' },
    ],
  });

  // Mar 2025 — expense 600 (advertising) + 300 (rent)
  await postJournalEntry(ctx, {
    date: new Date('2025-03-05'),
    description: 'Mar advertising 2025',
    lines: [
      { accountId: acct['6000'], debit: '600.00' },
      { accountId: acct['1000'], credit: '600.00' },
    ],
  });

  await postJournalEntry(ctx, {
    date: new Date('2025-03-15'),
    description: 'Mar rent 2025',
    lines: [
      { accountId: acct['6100'], debit: '300.00' },
      { accountId: acct['1000'], credit: '300.00' },
    ],
  });

  // Apr 2025 — income 800
  await postJournalEntry(ctx, {
    date: new Date('2025-04-10'),
    description: 'Apr sales 2025',
    lines: [
      { accountId: acct['1000'], debit: '800.00' },
      { accountId: acct['4000'], credit: '800.00' },
    ],
  });
});

afterAll(async () => {
  await closeDb(TEST_DIR);
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// profitAndLossComparative
// ---------------------------------------------------------------------------

describe('profitAndLossComparative', () => {
  const currentFrom = new Date('2025-01-01');
  const currentTo   = new Date('2025-06-30');
  const priorFrom   = new Date('2024-01-01');
  const priorTo     = new Date('2024-06-30');

  it('returns income rows for both periods merged by accountId', async () => {
    const report = await profitAndLossComparative(ctx, {
      from: currentFrom, to: currentTo,
      priorFrom, priorTo,
    });

    // 4000 (Sales Income) should appear in both periods.
    const salesRow = report.income.find((r) => r.code === '4000');
    expect(salesRow).toBeDefined();
    expect(parseFloat(salesRow!.current)).toBeGreaterThan(0);
    expect(parseFloat(salesRow!.prior)).toBeGreaterThan(0);
  });

  it('variance = current - prior', async () => {
    const report = await profitAndLossComparative(ctx, {
      from: currentFrom, to: currentTo,
      priorFrom, priorTo,
    });

    for (const row of [...report.income, ...report.expenses]) {
      const expected = parseFloat(row.current) - parseFloat(row.prior);
      expect(parseFloat(row.variance)).toBeCloseTo(expected, 2);
    }
  });

  it('variancePct = variance / prior * 100', async () => {
    const report = await profitAndLossComparative(ctx, {
      from: currentFrom, to: currentTo,
      priorFrom, priorTo,
    });

    for (const row of [...report.income, ...report.expenses]) {
      if (row.variancePct !== null && parseFloat(row.prior) !== 0) {
        const expected = (parseFloat(row.variance) / parseFloat(row.prior)) * 100;
        expect(parseFloat(row.variancePct)).toBeCloseTo(expected, 1);
      }
    }
  });

  it('variancePct is null when prior is zero', async () => {
    // 4100 (Service Revenue) only exists in current period — prior should be zero.
    const report = await profitAndLossComparative(ctx, {
      from: currentFrom, to: currentTo,
      priorFrom, priorTo,
    });

    const serviceRow = report.income.find((r) => r.code === '4100');
    expect(serviceRow).toBeDefined();
    expect(parseFloat(serviceRow!.prior)).toBe(0);
    expect(serviceRow!.variancePct).toBeNull();
  });

  it('totals variance matches totalIncome(current) - totalIncome(prior)', async () => {
    const report = await profitAndLossComparative(ctx, {
      from: currentFrom, to: currentTo,
      priorFrom, priorTo,
    });

    const expectedIncomeVar =
      parseFloat(report.totals.currentTotalIncome) -
      parseFloat(report.totals.priorTotalIncome);
    expect(parseFloat(report.totals.varianceTotalIncome)).toBeCloseTo(expectedIncomeVar, 2);

    const expectedNetVar =
      parseFloat(report.totals.currentNetIncome) -
      parseFloat(report.totals.priorNetIncome);
    expect(parseFloat(report.totals.varianceNetIncome)).toBeCloseTo(expectedNetVar, 2);
  });

  it('includes date range metadata', async () => {
    const report = await profitAndLossComparative(ctx, {
      from: currentFrom, to: currentTo,
      priorFrom, priorTo,
    });
    expect(report.from).toContain('2025');
    expect(report.priorFrom).toContain('2024');
  });
});

// ---------------------------------------------------------------------------
// profitAndLossByMonth
// ---------------------------------------------------------------------------

describe('profitAndLossByMonth', () => {
  it('returns exactly 12 monthly columns per row', async () => {
    const report = await profitAndLossByMonth(ctx, 2025);
    for (const row of [...report.income, ...report.expenses]) {
      expect(row.months).toHaveLength(12);
    }
    expect(report.monthlyTotalIncome).toHaveLength(12);
    expect(report.monthlyTotalExpenses).toHaveLength(12);
    expect(report.monthlyNetIncome).toHaveLength(12);
  });

  it('Jan-2025 income = 2000 (1500 sales + 500 service)', async () => {
    const report = await profitAndLossByMonth(ctx, 2025);
    const janIncome = parseFloat(report.monthlyTotalIncome[0]); // index 0 = Jan
    expect(janIncome).toBeCloseTo(2000, 2);
  });

  it('Feb-2025 income = 2500', async () => {
    const report = await profitAndLossByMonth(ctx, 2025);
    const febIncome = parseFloat(report.monthlyTotalIncome[1]); // index 1 = Feb
    expect(febIncome).toBeCloseTo(2500, 2);
  });

  it('Mar-2025 total expenses = 900 (600 + 300)', async () => {
    const report = await profitAndLossByMonth(ctx, 2025);
    const marExpenses = parseFloat(report.monthlyTotalExpenses[2]); // index 2 = Mar
    expect(marExpenses).toBeCloseTo(900, 2);
  });

  it('monthly net = income - expenses for each month', async () => {
    const report = await profitAndLossByMonth(ctx, 2025);
    for (let i = 0; i < 12; i++) {
      const expected =
        parseFloat(report.monthlyTotalIncome[i]) - parseFloat(report.monthlyTotalExpenses[i]);
      expect(parseFloat(report.monthlyNetIncome[i])).toBeCloseTo(expected, 2);
    }
  });

  it('row totals = sum of 12 months', async () => {
    const report = await profitAndLossByMonth(ctx, 2025);
    for (const row of [...report.income, ...report.expenses]) {
      const monthSum = row.months.reduce((s, m) => s + parseFloat(m), 0);
      expect(parseFloat(row.total)).toBeCloseTo(monthSum, 2);
    }
  });

  it('annual totals = sum of 12 monthly totals', async () => {
    const report = await profitAndLossByMonth(ctx, 2025);
    const incomeSum = report.monthlyTotalIncome.reduce((s, v) => s + parseFloat(v), 0);
    const expenseSum = report.monthlyTotalExpenses.reduce((s, v) => s + parseFloat(v), 0);

    expect(parseFloat(report.totalIncome)).toBeCloseTo(incomeSum, 2);
    expect(parseFloat(report.totalExpenses)).toBeCloseTo(expenseSum, 2);
    expect(parseFloat(report.netIncome)).toBeCloseTo(incomeSum - expenseSum, 2);
  });

  it('empty months return zero (Jun 2025 has no entries)', async () => {
    const report = await profitAndLossByMonth(ctx, 2025);
    const junIncome = parseFloat(report.monthlyTotalIncome[5]); // index 5 = Jun
    expect(junIncome).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// profitAndLossPercentOfIncome
// ---------------------------------------------------------------------------

describe('profitAndLossPercentOfIncome', () => {
  const range = { from: new Date('2025-01-01'), to: new Date('2025-06-30') };

  it('totalIncomePct is "100.00" when there is income', async () => {
    const report = await profitAndLossPercentOfIncome(ctx, range);
    expect(report.totalIncomePct).toBe('100.00');
  });

  it('each income line pctOfIncome sums to ~100', async () => {
    const report = await profitAndLossPercentOfIncome(ctx, range);
    const sum = report.income.reduce((s, r) => s + parseFloat(r.pctOfIncome ?? '0'), 0);
    expect(sum).toBeCloseTo(100, 1);
  });

  it('expense pctOfIncome = amount / totalIncome * 100', async () => {
    const report = await profitAndLossPercentOfIncome(ctx, range);
    const totalIncome = parseFloat(report.totalIncome);
    for (const row of report.expenses) {
      if (row.pctOfIncome !== null) {
        const expected = (parseFloat(row.amount) / totalIncome) * 100;
        expect(parseFloat(row.pctOfIncome)).toBeCloseTo(expected, 1);
      }
    }
  });

  it('netIncomePct = netIncome / totalIncome * 100', async () => {
    const report = await profitAndLossPercentOfIncome(ctx, range);
    const expected =
      (parseFloat(report.netIncome) / parseFloat(report.totalIncome)) * 100;
    expect(parseFloat(report.netIncomePct!)).toBeCloseTo(expected, 1);
  });

  it('pctOfIncome is null when totalIncome is zero (empty period)', async () => {
    const report = await profitAndLossPercentOfIncome(ctx, {
      from: new Date('2030-01-01'),
      to: new Date('2030-12-31'),
    });
    expect(report.totalIncomePct).toBeNull();
    for (const row of [...report.income, ...report.expenses]) {
      expect(row.pctOfIncome).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// GL invariant — balanced throughout
// ---------------------------------------------------------------------------

describe('GL invariant', () => {
  it('trial balance is balanced after all test entries', async () => {
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });
});
