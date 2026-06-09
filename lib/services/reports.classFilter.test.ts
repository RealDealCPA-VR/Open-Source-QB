/**
 * Integration tests for the additive classId filter on profitAndLoss.
 *
 * Posts revenue/expense entries tagged with different classes and verifies
 * the filtered report only counts lines tagged with the requested class,
 * while the unfiltered report still sees everything (back-compat).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { companies, users } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { createClass } from './dimensions';
import { postJournalEntry } from './posting';
import { profitAndLoss } from './reports';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-pl-classfilter-8e2f4a');
let ctx: ServiceContext;
let db: DB;
const acct: Record<string, string> = {};
let classAId: string;
let classBId: string;

describe('profitAndLoss classId filter', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'classfilter@test.local', name: 'Class Filter', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Class Filter Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Cash', 'asset', 'checking'],
      ['4000', 'Revenue', 'revenue', 'sales'],
      ['6000', 'Marketing', 'expense', 'operating_expenses'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }

    classAId = (await createClass(ctx, { name: 'East' })).id;
    classBId = (await createClass(ctx, { name: 'West' })).id;

    // Revenue $800 tagged East, $200 tagged West, $100 untagged.
    await postJournalEntry(ctx, {
      date: new Date(2026, 1, 10),
      description: 'Tagged revenue',
      lines: [
        { accountId: acct['1000'], debit: '1100.00' },
        { accountId: acct['4000'], credit: '800.00', classId: classAId },
        { accountId: acct['4000'], credit: '200.00', classId: classBId },
        { accountId: acct['4000'], credit: '100.00' },
      ],
    });
    // Expense $50 tagged East (cash credit untagged).
    await postJournalEntry(ctx, {
      date: new Date(2026, 1, 12),
      description: 'East marketing',
      lines: [
        { accountId: acct['6000'], debit: '50.00', classId: classAId },
        { accountId: acct['1000'], credit: '50.00' },
      ],
    });
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('unfiltered P&L still includes all activity (back-compat)', async () => {
    const pl = await profitAndLoss(ctx);
    expect(pl.totalIncome).toBe('1100.00');
    expect(pl.totalExpenses).toBe('50.00');
    expect(pl.netIncome).toBe('1050.00');
    expect(pl.classId).toBeUndefined();
  });

  it('classId filter restricts income and expenses to that class', async () => {
    const pl = await profitAndLoss(ctx, undefined, { classId: classAId });
    expect(pl.totalIncome).toBe('800.00');
    expect(pl.totalExpenses).toBe('50.00');
    expect(pl.netIncome).toBe('750.00');
    expect(pl.classId).toBe(classAId);
  });

  it('other class sees only its own lines; untagged lines belong to no class', async () => {
    const pl = await profitAndLoss(ctx, undefined, { classId: classBId });
    expect(pl.totalIncome).toBe('200.00');
    expect(pl.totalExpenses).toBe('0.00');
    expect(pl.expenses).toHaveLength(0);
  });

  it('classId filter composes with the date range', async () => {
    const pl = await profitAndLoss(
      ctx,
      { from: new Date(2026, 1, 11), to: new Date(2026, 1, 28) },
      { classId: classAId },
    );
    // Only the Feb 12 expense entry falls in range.
    expect(pl.totalIncome).toBe('0.00');
    expect(pl.totalExpenses).toBe('50.00');
  });
});
