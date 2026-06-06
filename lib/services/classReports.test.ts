/**
 * Integration tests for classReports service.
 *
 * Tests that profitAndLossByClass correctly splits revenue/expense lines
 * across two different classes. Uses a UNIQUE PGlite directory.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { createManualEntry } from './journal';
import { createClass } from './dimensions';
import { profitAndLossByClass, budgetVsActualByClass } from './classReports';
import { createBudget, setBudgetLine } from './budgets';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-class-reports');
let ctx: ServiceContext;
let db: DB;
const acct: Record<string, string> = {};
let classAId: string;
let classBId: string;

describe('classReports', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'cr-test@test.local', name: 'CR Test', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Class Reports Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // Minimal chart of accounts
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking',      'asset',   'checking'],
      ['4000', 'Sales Revenue', 'revenue', 'sales'],
      ['6000', 'Advertising',   'expense', 'operating_expenses'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }

    // Create two classes
    const clsA = await createClass(ctx, { name: 'Class A' });
    const clsB = await createClass(ctx, { name: 'Class B' });
    classAId = clsA.id;
    classBId = clsB.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Post entries with different classIds on lines
  // ---------------------------------------------------------------------------

  it('posts revenue entry with Class A on the revenue line', async () => {
    // Revenue: DR Checking 500 / CR Sales Revenue 500 (tagged Class A)
    const entry = await createManualEntry(ctx, {
      date: new Date('2025-06-01'),
      description: 'Revenue - Class A',
      lines: [
        { accountId: acct['1000'], debit: '500.00', classId: null },
        { accountId: acct['4000'], credit: '500.00', classId: classAId },
      ],
    });
    expect(entry.status).toBe('posted');
  });

  it('posts revenue entry with Class B on the revenue line', async () => {
    // Revenue: DR Checking 300 / CR Sales Revenue 300 (tagged Class B)
    const entry = await createManualEntry(ctx, {
      date: new Date('2025-06-02'),
      description: 'Revenue - Class B',
      lines: [
        { accountId: acct['1000'], debit: '300.00', classId: null },
        { accountId: acct['4000'], credit: '300.00', classId: classBId },
      ],
    });
    expect(entry.status).toBe('posted');
  });

  it('posts expense entry with Class A on the expense line', async () => {
    // Expense: DR Advertising 200 (Class A) / CR Checking 200
    const entry = await createManualEntry(ctx, {
      date: new Date('2025-06-03'),
      description: 'Advertising - Class A',
      lines: [
        { accountId: acct['6000'], debit: '200.00', classId: classAId },
        { accountId: acct['1000'], credit: '200.00', classId: null },
      ],
    });
    expect(entry.status).toBe('posted');
  });

  // ---------------------------------------------------------------------------
  // profitAndLossByClass
  // ---------------------------------------------------------------------------

  it('profitAndLossByClass returns Class A and Class B columns', async () => {
    const report = await profitAndLossByClass(ctx);

    // Should have exactly 2 class columns (no unclassified for revenue/expense lines)
    // Checking lines (asset) are excluded; Unclassified may appear for checking lines
    // but those are asset accounts, filtered out. Only Class A and Class B for revenue/expense.
    const classNames = report.classes.map((c) => c.className);
    expect(classNames).toContain('Class A');
    expect(classNames).toContain('Class B');
  });

  it('profitAndLossByClass splits Sales Revenue correctly between classes', async () => {
    const report = await profitAndLossByClass(ctx);

    const revenueRow = report.rows.find((r) => r.code === '4000');
    expect(revenueRow).toBeDefined();
    expect(revenueRow!.type).toBe('revenue');

    // Class A column: 500.00 revenue
    expect(revenueRow!.byClass[classAId]).toBe('500.00');
    // Class B column: 300.00 revenue
    expect(revenueRow!.byClass[classBId]).toBe('300.00');
  });

  it('profitAndLossByClass shows Advertising expense in Class A only', async () => {
    const report = await profitAndLossByClass(ctx);

    const expenseRow = report.rows.find((r) => r.code === '6000');
    expect(expenseRow).toBeDefined();
    expect(expenseRow!.type).toBe('expense');

    // Class A: 200.00 advertising expense
    expect(expenseRow!.byClass[classAId]).toBe('200.00');
    // Class B: no advertising → 0.00
    expect(expenseRow!.byClass[classBId]).toBe('0.00');
  });

  it('netByClass is correct: Class A = 300 revenue net, Class B = 300', async () => {
    const report = await profitAndLossByClass(ctx);
    // Class A: 500 revenue - 200 expense = 300
    expect(report.netByClass[classAId]).toBe('300.00');
    // Class B: 300 revenue - 0 expense = 300
    expect(report.netByClass[classBId]).toBe('300.00');
  });

  it('date range filter excludes entries outside range', async () => {
    // Only up to June 1 — only the first revenue entry (Class A 500)
    const report = await profitAndLossByClass(ctx, {
      from: new Date('2025-06-01'),
      to: new Date('2025-06-01T23:59:59Z'),
    });
    const revenueRow = report.rows.find((r) => r.code === '4000');
    expect(revenueRow).toBeDefined();
    expect(revenueRow!.byClass[classAId]).toBe('500.00');
    // Class B entry (June 2) is excluded
    const classBamt = revenueRow!.byClass[classBId] ?? '0.00';
    expect(classBamt).toBe('0.00');
  });

  // ---------------------------------------------------------------------------
  // budgetVsActualByClass
  // ---------------------------------------------------------------------------

  it('budgetVsActualByClass returns rows per (account, class)', async () => {
    // Create a budget for fiscal year 2025
    const budget = await createBudget(ctx, { name: 'Test Budget 2025', fiscalYear: 2025 });

    // Set budget lines with classIds
    await setBudgetLine(ctx, {
      budgetId: budget.id,
      accountId: acct['4000'],
      month: 6,
      amount: '600.00',
    });

    // Update the budget line insert to use classId via direct DB insert
    // because setBudgetLine doesn't expose classId — use the DB directly for the test
    const { budgetLines: budgetLinesTable } = await import('@/lib/db/schema');
    await db
      .insert(budgetLinesTable)
      .values({
        budgetId: budget.id,
        accountId: acct['4000'],
        classId: classAId,
        month: 7,
        amount: '400.00',
      });

    const report = await budgetVsActualByClass(ctx, budget.id);

    expect(report.budgetId).toBe(budget.id);
    expect(report.fiscalYear).toBe(2025);
    expect(report.rows.length).toBeGreaterThan(0);

    // Find the Class A revenue row
    const classARow = report.rows.find(
      (r) => r.accountId === acct['4000'] && r.classId === classAId,
    );
    expect(classARow).toBeDefined();
    expect(classARow!.budget).toBe('400.00');
    // Actual Class A revenue was 500.00 (posted in June)
    expect(classARow!.actual).toBe('500.00');
    expect(classARow!.variance).toBe('100.00'); // 500 - 400
  });
});
