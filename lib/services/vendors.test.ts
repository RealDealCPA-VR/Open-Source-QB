/**
 * Integration tests for the Vendors service.
 *
 * Boots a throwaway PGlite directory, seeds a user + company, then exercises
 * every service function. Also verifies that the trial balance stays balanced
 * after any indirect GL impact (via bills that reference vendors) — here we
 * just confirm that vendor CRUD itself does NOT touch the GL (it is pure master
 * data), so the trial balance starts and ends at zero debits/credits.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';
import { trialBalance } from './reports';
import {
  listVendors,
  getVendor,
  createVendor,
  updateVendor,
  deactivateVendor,
} from './vendors';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-vendors');
let ctx: ServiceContext;
let db: DB;

describe('Vendors service (integration)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);
    const [user] = await db
      .insert(users)
      .values({ email: 'owner@test.local', name: 'Owner', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // createVendor
  // -------------------------------------------------------------------------

  it('creates a basic vendor with required fields only', async () => {
    const v = await createVendor(ctx, { displayName: 'Office Depot' });
    expect(v.id).toBeTruthy();
    expect(v.displayName).toBe('Office Depot');
    expect(v.companyId).toBe(ctx.companyId);
    expect(v.isActive).toBe(true);
    expect(v.is1099).toBe(false);
    expect(v.terms).toBe('net_30');
  });

  it('creates a 1099 vendor with all optional fields', async () => {
    const v = await createVendor(ctx, {
      displayName: 'Jane Doe Consulting',
      companyName: 'JDC LLC',
      email: 'jane@jdc.example',
      phone: '555-0100',
      address: { street: '1 Main St', city: 'Austin', state: 'TX', zip: '78701' },
      terms: 'net_15',
      is1099: true,
      taxId: '12-3456789',
      notes: 'Preferred contractor',
    });
    expect(v.is1099).toBe(true);
    expect(v.taxId).toBe('12-3456789');
    expect(v.email).toBe('jane@jdc.example');
    expect(v.terms).toBe('net_15');
  });

  it('rejects an empty displayName', async () => {
    await expect(createVendor(ctx, { displayName: '' })).rejects.toBeInstanceOf(ServiceError);
    await expect(createVendor(ctx, { displayName: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('rejects a duplicate displayName within the same company', async () => {
    await createVendor(ctx, { displayName: 'Acme Corp' });
    await expect(createVendor(ctx, { displayName: 'Acme Corp' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  // -------------------------------------------------------------------------
  // listVendors
  // -------------------------------------------------------------------------

  it('listVendors returns only active vendors by default', async () => {
    const active = await listVendors(ctx);
    expect(active.every((v) => v.isActive)).toBe(true);
  });

  it('listVendors returns all vendors when includeInactive is true', async () => {
    // deactivate one first
    const v = await createVendor(ctx, { displayName: 'To Be Deactivated' });
    await deactivateVendor(ctx, v.id);
    const all = await listVendors(ctx, { includeInactive: true });
    const active = await listVendors(ctx);
    expect(all.length).toBeGreaterThan(active.length);
    expect(all.some((x) => !x.isActive)).toBe(true);
  });

  it('listVendors results are ordered by displayName ascending', async () => {
    const rows = await listVendors(ctx);
    const names = rows.map((r) => r.displayName);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  // -------------------------------------------------------------------------
  // getVendor
  // -------------------------------------------------------------------------

  it('getVendor returns the correct vendor', async () => {
    const created = await createVendor(ctx, { displayName: 'Get Me' });
    const fetched = await getVendor(ctx, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.displayName).toBe('Get Me');
  });

  it('getVendor throws NOT_FOUND for an unknown id', async () => {
    await expect(
      getVendor(ctx, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('getVendor is scoped: a vendor from another company is NOT_FOUND', async () => {
    // Create a second company
    const [user2] = await db
      .insert(users)
      .values({ email: 'other@test.local', name: 'Other', passwordHash: 'x' })
      .returning();
    const [company2] = await db
      .insert(companies)
      .values({ name: 'Other Co', ownerId: user2.id })
      .returning();
    const ctx2: ServiceContext = { db, companyId: company2.id, userId: user2.id };
    const v2 = await createVendor(ctx2, { displayName: 'Foreign Vendor' });

    // ctx1 must NOT see v2
    await expect(getVendor(ctx, v2.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // updateVendor
  // -------------------------------------------------------------------------

  it('updateVendor patches only supplied fields', async () => {
    const v = await createVendor(ctx, {
      displayName: 'Patch Target',
      email: 'old@example.com',
      is1099: false,
    });
    const updated = await updateVendor(ctx, v.id, { email: 'new@example.com', is1099: true });
    expect(updated.email).toBe('new@example.com');
    expect(updated.is1099).toBe(true);
    // displayName untouched
    expect(updated.displayName).toBe('Patch Target');
  });

  it('updateVendor allows renaming displayName to a new unique name', async () => {
    const v = await createVendor(ctx, { displayName: 'Old Name Vendor' });
    const updated = await updateVendor(ctx, v.id, { displayName: 'New Name Vendor' });
    expect(updated.displayName).toBe('New Name Vendor');
  });

  it('updateVendor rejects rename to a displayName already used by another vendor', async () => {
    await createVendor(ctx, { displayName: 'Taken Name' });
    const v = await createVendor(ctx, { displayName: 'Rename Me' });
    await expect(updateVendor(ctx, v.id, { displayName: 'Taken Name' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('updateVendor throws NOT_FOUND for an unknown id', async () => {
    await expect(
      updateVendor(ctx, '00000000-0000-0000-0000-000000000000', { email: 'x@example.com' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // deactivateVendor
  // -------------------------------------------------------------------------

  it('deactivateVendor marks the vendor inactive', async () => {
    const v = await createVendor(ctx, { displayName: 'Deactivate Me' });
    expect(v.isActive).toBe(true);
    const deactivated = await deactivateVendor(ctx, v.id);
    expect(deactivated.isActive).toBe(false);
  });

  it('deactivateVendor throws NOT_FOUND for an unknown id', async () => {
    await expect(
      deactivateVendor(ctx, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // GL invariant: vendors have NO direct GL impact
  // -------------------------------------------------------------------------

  it('trial balance stays balanced (zero) after vendor CRUD — no GL touched', async () => {
    const tb = await trialBalance(ctx);
    // No journal entries have been posted in this test suite, so the trial
    // balance has no rows and is trivially balanced.
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe('0.00');
    expect(tb.totalCredit).toBe('0.00');
  });
});
