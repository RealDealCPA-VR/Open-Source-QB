/**
 * Integration tests for the multi-currency service.
 *
 * Uses a unique test data directory so it never interferes with other test suites.
 * Every monetary posting is verified against a trial balance to confirm the GL stays balanced.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { accounts, users, companies } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { trialBalance } from './reports';
import {
  listCurrencies,
  setBaseCurrency,
  upsertCurrency,
  convert,
  revaluation,
  recordFxAdjustment,
} from './currencies';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-currencies');

let ctx: ServiceContext;
let db: DB;
// GL account ids keyed by code
const acct: Record<string, string> = {};

describe('Multi-currency service', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    // Seed a minimal user + company
    const [user] = await db
      .insert(users)
      .values({ email: 'fx@test.local', name: 'FX Tester', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'FX Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // Seed the GL accounts used by recordFxAdjustment
    const defs: Array<{ code: string; name: string; type: string; subtype: string }> = [
      { code: '1000', name: 'Checking',           type: 'asset',   subtype: 'checking' },
      { code: '3000', name: "Owner's Equity",      type: 'equity',  subtype: 'owners_equity' },
      { code: '4900', name: 'Other Income',        type: 'revenue', subtype: 'other_income' },
      { code: '6100', name: 'Bank & Merchant Fees',type: 'expense', subtype: 'operating_expenses' },
    ];
    for (const d of defs) {
      const [row] = await db
        .insert(accounts)
        .values({
          companyId: company.id,
          code: d.code,
          name: d.name,
          type: d.type as never,
          subtype: d.subtype as never,
        })
        .returning();
      acct[d.code] = row.id;
    }
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ---- setBaseCurrency ----

  it('sets USD as the base currency with rateToBase=1', async () => {
    const usd = await setBaseCurrency(ctx, { code: 'USD', name: 'US Dollar' });
    expect(usd.code).toBe('USD');
    expect(usd.isBase).toBe(true);
    expect(usd.rateToBase).toBe('1.00000000');
  });

  it('listCurrencies returns USD first (base)', async () => {
    const list = await listCurrencies(ctx);
    expect(list.length).toBe(1);
    expect(list[0].code).toBe('USD');
    expect(list[0].isBase).toBe(true);
  });

  // ---- upsertCurrency ----

  it('adds EUR with rateToBase 1.1', async () => {
    const eur = await upsertCurrency(ctx, { code: 'EUR', name: 'Euro', rateToBase: '1.1' });
    expect(eur.code).toBe('EUR');
    expect(eur.isBase).toBe(false);
    expect(parseFloat(eur.rateToBase)).toBeCloseTo(1.1, 6);
  });

  it('updates EUR rate on second upsert', async () => {
    const eur = await upsertCurrency(ctx, { code: 'EUR', name: 'Euro', rateToBase: '1.15' });
    expect(parseFloat(eur.rateToBase)).toBeCloseTo(1.15, 6);
  });

  it('rejects upsertCurrency for the base currency', async () => {
    await expect(
      upsertCurrency(ctx, { code: 'USD', name: 'US Dollar', rateToBase: '1' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects a zero or negative rate', async () => {
    await expect(
      upsertCurrency(ctx, { code: 'GBP', name: 'Pound', rateToBase: '0' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // ---- convert helper ----

  it('converts EUR to base (USD) using rateToBase 1.1', () => {
    // 100 EUR * 1.1 = 110 USD
    expect(convert(100, 1.1)).toBe('110.00');
  });

  it('converts USD (base) to EUR', () => {
    // 110 USD / 1.1 = 100 EUR  (fromRate=1 for base, toRate=1.1)
    expect(convert(110, 1, 1.1)).toBe('100.00');
  });

  it('cross-rate: EUR → GBP', () => {
    // 100 EUR * 1.1 / 1.27 ≈ 86.61 GBP
    const result = convert(100, 1.1, 1.27);
    expect(parseFloat(result)).toBeCloseTo(86.61, 1);
  });

  // ---- revaluation ----

  it('revaluation returns only non-base currencies', async () => {
    const rows = await revaluation(ctx);
    expect(rows.every((r) => r.code !== 'USD')).toBe(true);
    const eur = rows.find((r) => r.code === 'EUR');
    expect(eur).toBeDefined();
  });

  // ---- recordFxAdjustment (gain) ----

  it('records an FX gain — trial balance stays balanced', async () => {
    const { entryId } = await recordFxAdjustment(ctx, {
      accountId: acct['1000'], // Checking account
      amount: '250.00',
      gain: true,
      date: new Date('2025-06-01'),
      memo: 'EUR receivable revaluation gain',
    });

    expect(entryId).toBeTruthy();

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  // ---- recordFxAdjustment (loss) ----

  it('records an FX loss — trial balance stays balanced', async () => {
    const { entryId } = await recordFxAdjustment(ctx, {
      accountId: acct['1000'], // Checking account
      amount: '75.50',
      gain: false,
      date: new Date('2025-06-15'),
      memo: 'EUR payable revaluation loss',
    });

    expect(entryId).toBeTruthy();

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  // ---- edge cases ----

  it('rejects a zero-amount FX adjustment', async () => {
    await expect(
      recordFxAdjustment(ctx, {
        accountId: acct['1000'],
        amount: '0',
        gain: true,
        date: new Date('2025-06-20'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects an FX adjustment referencing a non-existent account', async () => {
    await expect(
      recordFxAdjustment(ctx, {
        accountId: '00000000-0000-0000-0000-000000000000',
        amount: '100',
        gain: true,
        date: new Date('2025-06-20'),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('setBaseCurrency strips the old base flag', async () => {
    // Switch base to EUR — USD should lose isBase
    await setBaseCurrency(ctx, { code: 'EUR', name: 'Euro' });
    const list = await listCurrencies(ctx);
    const usd = list.find((c) => c.code === 'USD');
    const eur = list.find((c) => c.code === 'EUR');
    expect(eur?.isBase).toBe(true);
    expect(eur?.rateToBase).toBe('1.00000000');
    expect(usd?.isBase).toBe(false);

    // Switch back to USD for any downstream assertions
    await setBaseCurrency(ctx, { code: 'USD', name: 'US Dollar' });
  });
});
