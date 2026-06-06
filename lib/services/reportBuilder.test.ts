import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { postJournalEntry } from './posting';
import { trialBalance } from './reports';
import { runReport } from './reportBuilder';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-report-builder');
let ctx: ServiceContext;
let db: DB;
const acct: Record<string, string> = {};

describe('runReport — custom report builder', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'rb-owner@test.local', name: 'Builder Owner', passwordHash: 'x' })
      .returning();

    const [company] = await db
      .insert(companies)
      .values({ name: 'Report Builder Co', ownerId: user.id })
      .returning();

    ctx = { db, companyId: company.id, userId: user.id };

    // Create a minimal chart of accounts
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['3000', 'Owner Equity', 'equity', 'owners_equity'],
      ['4000', 'Service Revenue', 'revenue', 'sales'],
      ['5000', 'Rent Expense', 'expense', 'operating_expenses'],
      ['5100', 'Utilities Expense', 'expense', 'operating_expenses'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }

    // Post Entry 1 (Jan): Owner invests $5,000
    await postJournalEntry(ctx, {
      date: new Date('2025-01-15'),
      description: 'Owner investment',
      lines: [
        { accountId: acct['1000'], debit: '5000.00' },
        { accountId: acct['3000'], credit: '5000.00' },
      ],
    });

    // Post Entry 2 (Jan): Service revenue $2,000
    await postJournalEntry(ctx, {
      date: new Date('2025-01-20'),
      description: 'Service fee',
      lines: [
        { accountId: acct['1000'], debit: '2000.00' },
        { accountId: acct['4000'], credit: '2000.00' },
      ],
    });

    // Post Entry 3 (Feb): Rent expense $800, utilities $200
    await postJournalEntry(ctx, {
      date: new Date('2025-02-05'),
      description: 'Monthly expenses',
      lines: [
        { accountId: acct['5000'], debit: '800.00' },
        { accountId: acct['5100'], debit: '200.00' },
        { accountId: acct['1000'], credit: '1000.00' },
      ],
    });
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('trial balance is balanced after all postings', async () => {
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('groupBy=type returns correct aggregate nets', async () => {
    const result = await runReport(ctx, { groupBy: 'type' });

    // Should have rows for: asset, equity, revenue, expense
    const byType = Object.fromEntries(result.rows.map((r) => [r.key, r]));

    // Asset: 1000 account — debit 7000, credit 1000 => net +6000
    expect(byType['asset']).toBeDefined();
    expect(byType['asset'].debit).toBe('7000.00');
    expect(byType['asset'].credit).toBe('1000.00');
    expect(byType['asset'].net).toBe('6000.00');

    // Revenue: credit 2000, debit 0 => net -2000
    expect(byType['revenue']).toBeDefined();
    expect(byType['revenue'].credit).toBe('2000.00');
    expect(byType['revenue'].net).toBe('-2000.00');

    // Expense: debit 1000, credit 0 => net +1000
    expect(byType['expense']).toBeDefined();
    expect(byType['expense'].debit).toBe('1000.00');
    expect(byType['expense'].net).toBe('1000.00');
  });

  it('groupBy=account returns a row per account used', async () => {
    const result = await runReport(ctx, { groupBy: 'account' });
    // 5 distinct accounts posted to
    expect(result.rows.length).toBe(5);
    const checking = result.rows.find((r) => r.key === acct['1000']);
    expect(checking).toBeDefined();
    expect(checking!.debit).toBe('7000.00');
    expect(checking!.credit).toBe('1000.00');
  });

  it('groupBy=month splits correctly', async () => {
    const result = await runReport(ctx, { groupBy: 'month' });
    const byMonth = Object.fromEntries(result.rows.map((r) => [r.key, r]));

    // January: debits 5000+2000=7000, credits 5000+2000=7000
    expect(byMonth['2025-01']).toBeDefined();
    expect(byMonth['2025-01'].debit).toBe('7000.00');
    expect(byMonth['2025-01'].credit).toBe('7000.00');

    // February: debits 800+200=1000, credits 1000
    expect(byMonth['2025-02']).toBeDefined();
    expect(byMonth['2025-02'].debit).toBe('1000.00');
    expect(byMonth['2025-02'].credit).toBe('1000.00');
  });

  it('accountTypes filter restricts to selected types only', async () => {
    const result = await runReport(ctx, {
      groupBy: 'type',
      accountTypes: ['expense'],
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].key).toBe('expense');
    expect(result.rows[0].debit).toBe('1000.00');
  });

  it('date range filter restricts to within range', async () => {
    const result = await runReport(ctx, {
      groupBy: 'month',
      from: '2025-02-01',
      to: '2025-02-28',
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].key).toBe('2025-02');
  });

  it('totals sum all rows correctly', async () => {
    const result = await runReport(ctx, { groupBy: 'type' });
    // All entries are balanced so total debits == total credits
    expect(result.totals.debit).toBe(result.totals.credit);
    expect(result.totals.net).toBe('0.00');
  });

  it('returns empty rows when no entries match the filter', async () => {
    const result = await runReport(ctx, {
      groupBy: 'month',
      from: '2030-01-01',
      to: '2030-12-31',
    });
    expect(result.rows).toHaveLength(0);
    expect(result.totals.debit).toBe('0.00');
  });
});
