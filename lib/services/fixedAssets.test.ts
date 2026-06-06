/**
 * Integration tests for the Fixed Assets service.
 *
 * Verifies:
 *  1. createAsset inserts a row with correct defaults.
 *  2. depreciationSchedule computes the correct straight-line schedule.
 *  3. postDepreciation once → 1000 expense, accumulated 1000, trial balance balanced.
 *  4. postDepreciation guards against over-depreciation.
 *  5. listAssets and getAsset round-trip correctly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { trialBalance } from './reports';
import {
  createAsset,
  listAssets,
  getAsset,
  depreciationSchedule,
  postDepreciation,
} from './fixedAssets';
import { ServiceError } from './_base';

// Unique directory per test file to avoid cross-test DB collisions.
const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-fixed-assets-svc');
let ctx: ServiceContext;
let db: DB;

describe('Fixed Assets service', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'owner@fixedassets.local', name: 'Owner', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Fixed Asset Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // Seed the minimum chart of accounts needed for depreciation posting.
    // postDepreciation will get-or-create 6800 and 1590, but we still need a
    // fiscal period to be open (no fiscal periods = all open by default in PGlite).
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Cash', 'asset', 'checking'],
      ['1500', 'Fixed Assets', 'asset', 'fixed_assets'],
      ['3000', 'Owner Equity', 'equity', 'owners_equity'],
    ];
    for (const [code, name, type, subtype] of defs) {
      await createAccount(ctx, { code, name, type: type as never, subtype });
    }
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ---- depreciationSchedule (pure computation) ----

  it('computes a correct 12-month straight-line schedule for cost=12000 salvage=0', () => {
    const fakePlaced = new Date('2024-01-01');
    const schedule = depreciationSchedule({
      cost: '12000.00',
      salvageValue: '0.00',
      usefulLifeMonths: 12,
      placedInService: fakePlaced,
    });

    expect(schedule).toHaveLength(12);
    // Each period should be 1000.00
    for (const item of schedule) {
      expect(item.amount).toBe('1000.00');
    }
    // Final period: accumulated = 12000, net book value = 0
    const last = schedule[11];
    expect(last.accumulated).toBe('12000.00');
    expect(last.netBookValue).toBe('0.00');
  });

  it('distributes rounding remainder correctly in a non-divisible schedule', () => {
    // cost=1000, salvage=0, 3 months -> 333.33 + 333.33 + 333.34 = 1000
    const schedule = depreciationSchedule({
      cost: '1000.00',
      salvageValue: '0.00',
      usefulLifeMonths: 3,
      placedInService: new Date('2024-01-01'),
    });
    expect(schedule).toHaveLength(3);
    const totalDepreciated = schedule.reduce(
      (sum, s) => sum + parseFloat(s.amount),
      0,
    );
    // Total should round to exactly 1000
    expect(Math.round(totalDepreciated * 100)).toBe(100000);
    expect(schedule[2].netBookValue).toBe('0.00');
  });

  // ---- createAsset ----

  it('creates an asset with correct defaults', async () => {
    const asset = await createAsset(ctx, {
      name: 'Office Equipment',
      cost: '12000',
      salvageValue: '0',
      usefulLifeMonths: 12,
      placedInService: new Date('2024-01-01'),
    });

    expect(asset.name).toBe('Office Equipment');
    expect(asset.cost).toBe('12000.00');
    expect(asset.salvageValue).toBe('0.00');
    expect(asset.usefulLifeMonths).toBe(12);
    expect(asset.accumulatedDepreciation).toBe('0.00');
    expect(asset.method).toBe('straight_line');
    expect(asset.companyId).toBe(ctx.companyId);
  });

  it('rejects cost <= 0', async () => {
    await expect(
      createAsset(ctx, {
        name: 'Bad',
        cost: 0,
        usefulLifeMonths: 12,
        placedInService: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects salvage >= cost', async () => {
    await expect(
      createAsset(ctx, {
        name: 'Bad',
        cost: 1000,
        salvageValue: 1000,
        usefulLifeMonths: 12,
        placedInService: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // ---- postDepreciation + trial balance ----

  it('posts one period of depreciation and leaves the trial balance balanced', async () => {
    const asset = await createAsset(ctx, {
      name: 'Server',
      cost: '12000',
      salvageValue: '0',
      usefulLifeMonths: 12,
      placedInService: new Date('2024-01-01'),
    });

    const result = await postDepreciation(ctx, {
      assetId: asset.id,
      date: new Date('2024-02-01'),
    });

    // One month of depreciation = 12000 / 12 = 1000
    expect(result.periodAmount).toBe('1000.00');
    expect(result.newAccumulatedDepreciation).toBe('1000.00');

    // depreciationEntry should reference the journal entry
    expect(result.depreciationEntry.amount).toBe('1000.00');
    expect(result.depreciationEntry.postedEntryId).toBe(result.journalEntry.id);

    // Verify the asset row was updated
    const refreshed = await getAsset(ctx, asset.id);
    expect(refreshed.accumulatedDepreciation).toBe('1000.00');
    expect(refreshed.depreciationEntries).toHaveLength(1);

    // Trial balance must be balanced after every posting.
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  // ---- listAssets ----

  it('lists assets scoped to the company', async () => {
    const assets = await listAssets(ctx);
    // We've created 2 assets above ('Office Equipment' and 'Server')
    expect(assets.length).toBeGreaterThanOrEqual(2);
    for (const a of assets) {
      expect(a.companyId).toBe(ctx.companyId);
    }
  });

  // ---- over-depreciation guard ----

  it('prevents depreciating past the depreciable base', async () => {
    const asset = await createAsset(ctx, {
      name: 'Short-Life Asset',
      cost: '1000',
      salvageValue: '0',
      usefulLifeMonths: 1,
      placedInService: new Date('2024-01-01'),
    });

    // Post the single allowed period.
    await postDepreciation(ctx, { assetId: asset.id, date: new Date('2024-02-01') });

    // Second attempt should throw VALIDATION.
    await expect(
      postDepreciation(ctx, { assetId: asset.id, date: new Date('2024-03-01') }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // ---- getAsset ----

  it('throws NOT_FOUND for unknown asset id', async () => {
    await expect(
      getAsset(ctx, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
