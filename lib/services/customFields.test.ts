/**
 * Tests for the custom-fields service (QB "Define Fields" parity).
 *
 * Definitions live in companies.settings.customFields; values live in each
 * entity row's custom_fields jsonb. Verifies:
 *  - Default definitions are empty for all four entities.
 *  - setCustomFieldDefinitions replaces per-entity lists, trims names, and
 *    leaves omitted entities untouched.
 *  - Validation: max 7 fields, no duplicates (case-insensitive), no empty
 *    names, 31-char name limit.
 *  - setEntityCustomFields patch-merges values, clears keys via empty string,
 *    rejects undefined field names, and scopes lookups to the company.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, customers, vendors, items } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import {
  getCustomFieldDefinitions,
  setCustomFieldDefinitions,
  setEntityCustomFields,
  MAX_CUSTOM_FIELDS,
} from './customFields';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-custom-fields');
let ctx: ServiceContext;
let db: DB;
let customerId: string;
let vendorId: string;
let itemId: string;

describe('Custom fields service', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'cf@test.local', name: 'CF Owner', passwordHash: 'x' })
      .returning();

    const [company] = await db
      .insert(companies)
      .values({ name: 'CF Test Co', ownerId: user.id })
      .returning();

    // ctx.userId is the company owner, so requireRole('admin') passes.
    ctx = { db, companyId: company.id, userId: user.id };

    const [cust] = await db
      .insert(customers)
      .values({ companyId: company.id, displayName: 'CF Customer' })
      .returning();
    customerId = cust.id;

    const [vend] = await db
      .insert(vendors)
      .values({ companyId: company.id, displayName: 'CF Vendor' })
      .returning();
    vendorId = vend.id;

    const [it] = await db
      .insert(items)
      .values({ companyId: company.id, name: 'CF Item', type: 'service' })
      .returning();
    itemId = it.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Definitions
  // -------------------------------------------------------------------------

  it('returns empty definitions by default', async () => {
    const defs = await getCustomFieldDefinitions(ctx);
    expect(defs).toEqual({ customer: [], vendor: [], item: [], invoice: [] });
  });

  it('sets per-entity definitions, trimming names and keeping omitted entities', async () => {
    const defs = await setCustomFieldDefinitions(ctx, {
      customer: [{ name: '  Account Rep ' }, { name: 'Region' }],
      item: [{ name: 'Color' }],
    });
    expect(defs.customer).toEqual([{ name: 'Account Rep' }, { name: 'Region' }]);
    expect(defs.item).toEqual([{ name: 'Color' }]);
    expect(defs.vendor).toEqual([]);
    expect(defs.invoice).toEqual([]);

    // Persisted in companies.settings.customFields.
    const [company] = await db.select().from(companies).where(eq(companies.id, ctx.companyId));
    expect((company.settings as Record<string, unknown>).customFields).toMatchObject({
      customer: [{ name: 'Account Rep' }, { name: 'Region' }],
    });

    // Updating only vendor leaves customer untouched.
    const defs2 = await setCustomFieldDefinitions(ctx, { vendor: [{ name: 'Account #' }] });
    expect(defs2.customer).toEqual([{ name: 'Account Rep' }, { name: 'Region' }]);
    expect(defs2.vendor).toEqual([{ name: 'Account #' }]);
  });

  it('enforces the QB-like maximum per entity', async () => {
    const tooMany = Array.from({ length: MAX_CUSTOM_FIELDS + 1 }, (_, i) => ({
      name: `Field ${i + 1}`,
    }));
    await expect(
      setCustomFieldDefinitions(ctx, { customer: tooMany }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // Exactly MAX is fine.
    const exactly = Array.from({ length: MAX_CUSTOM_FIELDS }, (_, i) => ({
      name: `Inv Field ${i + 1}`,
    }));
    const defs = await setCustomFieldDefinitions(ctx, { invoice: exactly });
    expect(defs.invoice).toHaveLength(MAX_CUSTOM_FIELDS);
  });

  it('rejects duplicate (case-insensitive), empty, and over-long names', async () => {
    await expect(
      setCustomFieldDefinitions(ctx, { customer: [{ name: 'Rep' }, { name: 'rep' }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await expect(
      setCustomFieldDefinitions(ctx, { customer: [{ name: '   ' }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await expect(
      setCustomFieldDefinitions(ctx, { customer: [{ name: 'x'.repeat(32) }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // -------------------------------------------------------------------------
  // Values
  // -------------------------------------------------------------------------

  it('sets, merges, and clears values on a customer', async () => {
    const v1 = await setEntityCustomFields(ctx, 'customer', customerId, {
      'Account Rep': 'Dana',
      Region: 'West',
    });
    expect(v1).toEqual({ 'Account Rep': 'Dana', Region: 'West' });

    // Patch-merge: only Region changes, Account Rep survives.
    const v2 = await setEntityCustomFields(ctx, 'customer', customerId, { Region: 'East' });
    expect(v2).toEqual({ 'Account Rep': 'Dana', Region: 'East' });

    // Empty string clears a key.
    const v3 = await setEntityCustomFields(ctx, 'customer', customerId, { 'Account Rep': '' });
    expect(v3).toEqual({ Region: 'East' });

    // Persisted on the row.
    const [row] = await db.select().from(customers).where(eq(customers.id, customerId));
    expect(row.customFields).toEqual({ Region: 'East' });
  });

  it('rejects values for undefined field names', async () => {
    await expect(
      setEntityCustomFields(ctx, 'customer', customerId, { 'Not Defined': 'x' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('writes values for vendors and items against their own definitions', async () => {
    const v = await setEntityCustomFields(ctx, 'vendor', vendorId, { 'Account #': 'V-1001' });
    expect(v).toEqual({ 'Account #': 'V-1001' });

    const iv = await setEntityCustomFields(ctx, 'item', itemId, { Color: 'Red' });
    expect(iv).toEqual({ Color: 'Red' });

    // Customer-defined names are not valid for vendors.
    await expect(
      setEntityCustomFields(ctx, 'vendor', vendorId, { Region: 'West' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('throws NOT_FOUND for an entity row outside the company', async () => {
    await expect(
      setEntityCustomFields(ctx, 'customer', '00000000-0000-0000-0000-000000000000', {
        Region: 'West',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
