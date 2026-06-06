/**
 * Integration tests for the consolidation service.
 *
 * Creates two independent companies in a throwaway PGlite directory, posts a sale
 * in each, then asserts that:
 *   - consolidatedPL.consolidated.totalIncome equals the sum of both companies' income.
 *   - consolidatedBalanceSheet.consolidated.totalAssets equals the sum.
 *   - The trial balance is balanced for each company after posting.
 *
 * UNIQUE test directory: .bookkeeper-data/test-consolidation
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { postJournalEntry } from './posting';
import { trialBalance } from './reports';
import { consolidatedPL, consolidatedBalanceSheet } from './consolidation';
import { Money } from '@/lib/money';

// ---------------------------------------------------------------------------
// Unique test directory
// ---------------------------------------------------------------------------

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-consolidation');

let db: DB;

// Per-company contexts.
let ctxA: ServiceContext;
let ctxB: ServiceContext;

// Shared "super-user" context — we pass this to consolidation functions.
// consolidation ignores companyId on the ctx, using only db + userId.
let ctxSuper: ServiceContext;

// Account id maps keyed by COA code (one per company).
const acctA: Record<string, string> = {};
const acctB: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

describe('Consolidated Reporting', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    // ---- Shared owner user ----
    const [user] = await db
      .insert(users)
      .values({ email: 'owner@consolidation.test', name: 'Owner', passwordHash: 'x' })
      .returning();

    // ---- Company A ----
    const [companyA] = await db
      .insert(companies)
      .values({ name: 'Alpha LLC', ownerId: user.id })
      .returning();

    ctxA = { db, companyId: companyA.id, userId: user.id };

    const defsA: Array<[string, string, string, string]> = [
      ['1000', 'Checking',          'asset',   'checking'],
      ['1200', 'Accounts Receivable','asset',  'accounts_receivable'],
      ['3000', "Owner's Equity",    'equity',  'owners_equity'],
      ['4000', 'Sales Income',      'revenue', 'sales'],
      ['5000', 'COGS',              'expense', 'cost_of_goods_sold'],
    ];
    for (const [code, name, type, subtype] of defsA) {
      const row = await createAccount(ctxA, { code, name, type: type as never, subtype });
      acctA[code] = row.id;
    }

    // ---- Company B ----
    const [companyB] = await db
      .insert(companies)
      .values({ name: 'Beta Corp', ownerId: user.id })
      .returning();

    ctxB = { db, companyId: companyB.id, userId: user.id };

    const defsB: Array<[string, string, string, string]> = [
      ['1000', 'Checking',          'asset',   'checking'],
      ['1200', 'Accounts Receivable','asset',  'accounts_receivable'],
      ['3000', "Owner's Equity",    'equity',  'owners_equity'],
      ['4000', 'Sales Income',      'revenue', 'sales'],
      ['5000', 'COGS',              'expense', 'cost_of_goods_sold'],
    ];
    for (const [code, name, type, subtype] of defsB) {
      const row = await createAccount(ctxB, { code, name, type: type as never, subtype });
      acctB[code] = row.id;
    }

    // The super-context is used to call consolidation; companyId is arbitrary here.
    ctxSuper = { db, companyId: companyA.id, userId: user.id };

    // ---- Post a sale in Company A: $1,000 revenue ----
    // DR Checking 1000 / CR Sales Income 1000
    await postJournalEntry(ctxA, {
      date: new Date('2025-06-01'),
      description: 'Sale A-001',
      lines: [
        { accountId: acctA['1000'], debit: '1000.00' },
        { accountId: acctA['4000'], credit: '1000.00' },
      ],
    });

    // ---- Post a sale in Company B: $2,500 revenue ----
    // DR Checking 2500 / CR Sales Income 2500
    await postJournalEntry(ctxB, {
      date: new Date('2025-06-02'),
      description: 'Sale B-001',
      lines: [
        { accountId: acctB['1000'], debit: '2500.00' },
        { accountId: acctB['4000'], credit: '2500.00' },
      ],
    });
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Trial balance checks (each company must be balanced independently)
  // -------------------------------------------------------------------------

  it('trial balance for Company A is balanced after posting', async () => {
    const tb = await trialBalance(ctxA);
    expect(tb.balanced).toBe(true);
  });

  it('trial balance for Company B is balanced after posting', async () => {
    const tb = await trialBalance(ctxB);
    expect(tb.balanced).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Consolidated P&L
  // -------------------------------------------------------------------------

  it('consolidatedPL returns one entry per company', async () => {
    const result = await consolidatedPL(ctxSuper);
    // We created exactly 2 companies in this test DB.
    expect(result.companies).toHaveLength(2);
  });

  it('per-company income figures are correct in P&L', async () => {
    const result = await consolidatedPL(ctxSuper);

    const a = result.companies.find((c) => c.companyName === 'Alpha LLC');
    const b = result.companies.find((c) => c.companyName === 'Beta Corp');

    expect(a).toBeDefined();
    expect(b).toBeDefined();

    expect(a!.report.totalIncome).toBe('1000.00');
    expect(b!.report.totalIncome).toBe('2500.00');
  });

  it('consolidated P&L totalIncome equals the sum of per-company incomes', async () => {
    const result = await consolidatedPL(ctxSuper);

    const sumIncome = result.companies.reduce(
      (acc, c) => acc.plus(Money.of(c.report.totalIncome)),
      Money.zero(),
    );

    expect(result.consolidated.totalIncome).toBe(sumIncome.toFixed(2));
    // $1,000 + $2,500 = $3,500
    expect(result.consolidated.totalIncome).toBe('3500.00');
  });

  it('consolidated P&L netIncome equals consolidated totalIncome (no expenses posted)', async () => {
    const result = await consolidatedPL(ctxSuper);
    expect(result.consolidated.netIncome).toBe('3500.00');
    expect(result.consolidated.totalExpenses).toBe('0.00');
  });

  // -------------------------------------------------------------------------
  // Consolidated Balance Sheet
  // -------------------------------------------------------------------------

  it('consolidatedBalanceSheet returns one entry per company', async () => {
    const result = await consolidatedBalanceSheet(ctxSuper);
    expect(result.companies).toHaveLength(2);
  });

  it('consolidated BS totalAssets equals sum of per-company totalAssets', async () => {
    const result = await consolidatedBalanceSheet(ctxSuper);

    const sumAssets = result.companies.reduce(
      (acc, c) => acc.plus(Money.of(c.report.totalAssets)),
      Money.zero(),
    );

    expect(result.consolidated.totalAssets).toBe(sumAssets.toFixed(2));
    // Checking balance: $1,000 (A) + $2,500 (B) = $3,500
    expect(result.consolidated.totalAssets).toBe('3500.00');
  });

  it('consolidated BS is balanced (Assets = Liabilities + Equity)', async () => {
    const result = await consolidatedBalanceSheet(ctxSuper);
    expect(result.consolidated.balanced).toBe(true);
  });

  it('date range filter on consolidatedPL correctly scopes to a range', async () => {
    // Only include June 1 — should pick up Company A ($1,000) but not Company B (June 2).
    const result = await consolidatedPL(ctxSuper, {
      from: new Date('2025-06-01'),
      to: new Date('2025-06-01'),
    });

    const a = result.companies.find((c) => c.companyName === 'Alpha LLC');
    const b = result.companies.find((c) => c.companyName === 'Beta Corp');

    expect(a!.report.totalIncome).toBe('1000.00');
    expect(b!.report.totalIncome).toBe('0.00');
    expect(result.consolidated.totalIncome).toBe('1000.00');
  });
});
