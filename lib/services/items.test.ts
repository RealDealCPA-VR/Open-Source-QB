/**
 * Integration tests for the Items (Products & Services) service.
 *
 * Each test runs against a throwaway PGlite directory so the DB is fully
 * isolated and is cleaned up in afterAll. Pattern matches
 * accounting.integration.test.ts exactly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';
import { createAccount } from './accounts';
import { trialBalance } from './reports';
import {
  listItems,
  getItem,
  createItem,
  updateItem,
  deactivateItem,
} from './items';

// ── Test fixture ──────────────────────────────────────────────────────────────

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-items');
let ctx: ServiceContext;
let db: DB;

/** Account IDs seeded for the test company. */
const acct: Record<string, string> = {};

describe('Items service (integration)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    // Seed a user + company.
    const [user] = await db
      .insert(users)
      .values({ email: 'owner@items.test', name: 'Items Test Owner', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Items Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // Seed a minimal Chart of Accounts with the account types the service validates.
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking',           'asset',   'checking'],
      ['1300', 'Inventory Asset',    'asset',   'inventory'],
      ['4000', 'Sales Income',       'revenue', 'sales'],
      ['4100', 'Service Income',     'revenue', 'service_revenue'],
      ['5000', 'Cost of Goods Sold', 'expense', 'cost_of_goods_sold'],
      ['6300', 'Office Supplies',    'expense', 'operating_expenses'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ── createItem ─────────────────────────────────────────────────────────────

  it('creates a service item with income and expense accounts', async () => {
    const item = await createItem(ctx, {
      name: 'Web Design',
      type: 'service',
      description: 'Custom website design',
      salesPrice: '1500.00',
      purchaseCost: null,
      incomeAccountId: acct['4100'],
      expenseAccountId: null,
      taxable: false,
    });

    expect(item.id).toBeTruthy();
    expect(item.name).toBe('Web Design');
    expect(item.type).toBe('service');
    expect(item.salesPrice).toBe('1500.00');
    expect(item.incomeAccountId).toBe(acct['4100']);
    expect(item.isActive).toBe(true);
    expect(item.companyId).toBe(ctx.companyId);
  });

  it('creates an inventory item with all three account links', async () => {
    const item = await createItem(ctx, {
      name: 'Widget A',
      type: 'inventory',
      sku: 'WGT-001',
      salesPrice: '49.99',
      purchaseCost: '22.50',
      incomeAccountId: acct['4000'],
      expenseAccountId: acct['5000'],
      assetAccountId: acct['1300'],
      taxable: true,
    });

    expect(item.type).toBe('inventory');
    expect(item.sku).toBe('WGT-001');
    expect(item.purchaseCost).toBe('22.50');
    expect(item.assetAccountId).toBe(acct['1300']);
  });

  it('creates a non-inventory item', async () => {
    const item = await createItem(ctx, {
      name: 'Printer Paper',
      type: 'non_inventory',
      incomeAccountId: acct['4000'],
      expenseAccountId: acct['6300'],
    });
    expect(item.type).toBe('non_inventory');
  });

  it('creates a bundle item (no account links required)', async () => {
    const item = await createItem(ctx, {
      name: 'Starter Pack',
      type: 'bundle',
    });
    expect(item.type).toBe('bundle');
    expect(item.incomeAccountId).toBeNull();
  });

  it('defaults type to "service" when omitted', async () => {
    const item = await createItem(ctx, { name: 'Quick Consult' });
    expect(item.type).toBe('service');
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  it('rejects a missing name', async () => {
    await expect(createItem(ctx, { name: '' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('rejects a blank-whitespace name', async () => {
    await expect(createItem(ctx, { name: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('rejects a duplicate name within the same company', async () => {
    await createItem(ctx, { name: 'Duplicate Me' });
    await expect(createItem(ctx, { name: 'Duplicate Me' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('rejects an incomeAccountId that does not exist', async () => {
    await expect(
      createItem(ctx, {
        name: 'Bad Income Link',
        incomeAccountId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it('rejects an incomeAccountId that is not a revenue account', async () => {
    // Pass an asset account where an income account is required.
    await expect(
      createItem(ctx, {
        name: 'Wrong Account Type',
        incomeAccountId: acct['1000'], // Checking — asset, not revenue
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects an expenseAccountId that is not an expense account', async () => {
    await expect(
      createItem(ctx, {
        name: 'Wrong Expense Type',
        expenseAccountId: acct['4000'], // Sales Income — revenue, not expense
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects an assetAccountId that is not an asset account', async () => {
    await expect(
      createItem(ctx, {
        name: 'Wrong Asset Type',
        assetAccountId: acct['5000'], // COGS — expense, not asset
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // ── getItem ────────────────────────────────────────────────────────────────

  it('retrieves an item by ID', async () => {
    const created = await createItem(ctx, { name: 'Fetch Me' });
    const fetched = await getItem(ctx, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe('Fetch Me');
  });

  it('throws NOT_FOUND for an unknown item ID', async () => {
    await expect(
      getItem(ctx, '00000000-0000-0000-0000-000000000001'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ── listItems ──────────────────────────────────────────────────────────────

  it('lists only active items by default', async () => {
    const before = await listItems(ctx);
    const active = before.filter((i) => i.isActive);
    expect(active.length).toBe(before.length);
  });

  it('filters by type', async () => {
    const inventoryItems = await listItems(ctx, { type: 'inventory' });
    expect(inventoryItems.every((i) => i.type === 'inventory')).toBe(true);
    expect(inventoryItems.length).toBeGreaterThanOrEqual(1); // Widget A
  });

  it('filters by name search (case-insensitive)', async () => {
    await createItem(ctx, { name: 'Monthly Retainer Pro' });
    const results = await listItems(ctx, { search: 'retainer' });
    expect(results.some((i) => i.name === 'Monthly Retainer Pro')).toBe(true);
  });

  it('includes inactive items when includeInactive=true', async () => {
    const toHide = await createItem(ctx, { name: 'Soon Inactive' });
    await deactivateItem(ctx, toHide.id);

    const withoutInactive = await listItems(ctx);
    const withInactive = await listItems(ctx, { includeInactive: true });

    expect(withoutInactive.some((i) => i.id === toHide.id)).toBe(false);
    expect(withInactive.some((i) => i.id === toHide.id)).toBe(true);
  });

  // ── updateItem ─────────────────────────────────────────────────────────────

  it('updates only the supplied fields', async () => {
    const item = await createItem(ctx, {
      name: 'Update Target',
      salesPrice: '100.00',
      taxable: true,
    });

    const updated = await updateItem(ctx, item.id, { salesPrice: '120.00', taxable: false });
    expect(updated.salesPrice).toBe('120.00');
    expect(updated.taxable).toBe(false);
    expect(updated.name).toBe('Update Target'); // unchanged
  });

  it('allows renaming to a new unique name', async () => {
    const item = await createItem(ctx, { name: 'Old Name XYZ' });
    const updated = await updateItem(ctx, item.id, { name: 'New Name XYZ' });
    expect(updated.name).toBe('New Name XYZ');
  });

  it('rejects renaming to a name already taken by another item', async () => {
    await createItem(ctx, { name: 'Taken Name ABC' });
    const item2 = await createItem(ctx, { name: 'Item To Rename' });
    await expect(
      updateItem(ctx, item2.id, { name: 'Taken Name ABC' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('validates updated account links', async () => {
    const item = await createItem(ctx, { name: 'Account Link Test' });
    // Try to link an asset account as the income account.
    await expect(
      updateItem(ctx, item.id, { incomeAccountId: acct['1300'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('allows clearing an account link (set to null)', async () => {
    const item = await createItem(ctx, {
      name: 'Clear Link Test',
      incomeAccountId: acct['4100'],
    });
    const updated = await updateItem(ctx, item.id, { incomeAccountId: null });
    expect(updated.incomeAccountId).toBeNull();
  });

  // ── deactivateItem ─────────────────────────────────────────────────────────

  it('deactivates an item (soft delete)', async () => {
    const item = await createItem(ctx, { name: 'To Deactivate' });
    const result = await deactivateItem(ctx, item.id);
    expect(result.isActive).toBe(false);

    // Confirm it is hidden from the default list.
    const list = await listItems(ctx);
    expect(list.some((i) => i.id === item.id)).toBe(false);
  });

  // ── GL health check ────────────────────────────────────────────────────────

  it('trial balance remains balanced after all item mutations (items post no GL)', async () => {
    // Items are master data; they carry no journal-entry impact, so the trial
    // balance should either be empty (no entries posted) or remain balanced.
    const tb = await trialBalance(ctx);
    // No journal entries were posted in this test suite, so the TB should show balanced.
    expect(tb.balanced).toBe(true);
  });
});
