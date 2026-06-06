/**
 * customerPricing service tests.
 *
 * Scenarios:
 *  1. setCustomerPrice creates a row; getPrice returns it.
 *  2. setCustomerPrice on the same (customer, item) updates the price (upsert).
 *  3. getPrice returns null when no custom price exists.
 *  4. listCustomerPrices scopes to companyId and optionally customerId.
 *  5. deleteCustomerPrice removes the row; getPrice returns null afterwards.
 *  6. Rejects negative price.
 *  7. Rejects unknown customer / item (NOT_FOUND).
 *  8. deleteCustomerPrice on wrong company throws NOT_FOUND.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, customers, items } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import {
  listCustomerPrices,
  setCustomerPrice,
  deleteCustomerPrice,
  getPrice,
} from './customerPricing';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-customer-pricing');

let db: DB;
let ctx: ServiceContext;
let ctx2: ServiceContext; // second company for scoping tests
let customerId: string;
let customerId2: string;
let itemId: string;
let itemId2: string;

describe('customerPricing service', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    // Company 1
    const [user] = await db
      .insert(users)
      .values({ email: 'owner@cpricing-test.local', name: 'CP Owner', passwordHash: 'x' })
      .returning();

    const [company] = await db
      .insert(companies)
      .values({ name: 'CP Test Co', ownerId: user.id })
      .returning();

    ctx = { db, companyId: company.id, userId: user.id };

    // Company 2 (for scoping test)
    const [user2] = await db
      .insert(users)
      .values({ email: 'owner2@cpricing-test.local', name: 'CP Owner 2', passwordHash: 'x' })
      .returning();

    const [company2] = await db
      .insert(companies)
      .values({ name: 'CP Test Co 2', ownerId: user2.id })
      .returning();

    ctx2 = { db, companyId: company2.id, userId: user2.id };

    // Seed customers for company 1
    const [c1] = await db
      .insert(customers)
      .values({ companyId: company.id, displayName: 'Alice Corp', balance: '0' })
      .returning();
    customerId = c1.id;

    const [c2] = await db
      .insert(customers)
      .values({ companyId: company.id, displayName: 'Bob Inc', balance: '0' })
      .returning();
    customerId2 = c2.id;

    // Seed items for company 1
    const [i1] = await db
      .insert(items)
      .values({ companyId: company.id, name: 'Widget', type: 'inventory', salesPrice: '10.00' })
      .returning();
    itemId = i1.id;

    const [i2] = await db
      .insert(items)
      .values({ companyId: company.id, name: 'Gadget', type: 'service', salesPrice: '50.00' })
      .returning();
    itemId2 = i2.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // getPrice returns null when no price is set
  // -------------------------------------------------------------------------

  it('getPrice returns null when no custom price exists', async () => {
    const price = await getPrice(ctx, customerId, itemId);
    expect(price).toBeNull();
  });

  // -------------------------------------------------------------------------
  // setCustomerPrice creates a row; getPrice returns it
  // -------------------------------------------------------------------------

  it('setCustomerPrice creates a price and getPrice returns it', async () => {
    const result = await setCustomerPrice(ctx, {
      customerId,
      itemId,
      price: '8.50',
    });

    expect(result.customerId).toBe(customerId);
    expect(result.itemId).toBe(itemId);
    expect(result.companyId).toBe(ctx.companyId);
    // price stored as 4dp decimal
    expect(parseFloat(result.price)).toBeCloseTo(8.5, 4);

    const fetched = await getPrice(ctx, customerId, itemId);
    expect(fetched).not.toBeNull();
    expect(parseFloat(fetched!)).toBeCloseTo(8.5, 4);
  });

  // -------------------------------------------------------------------------
  // setCustomerPrice is an upsert — second call updates the price
  // -------------------------------------------------------------------------

  it('setCustomerPrice upserts: second call updates the price', async () => {
    const updated = await setCustomerPrice(ctx, {
      customerId,
      itemId,
      price: '7.25',
    });

    expect(parseFloat(updated.price)).toBeCloseTo(7.25, 4);

    // getPrice should return the new value
    const fetched = await getPrice(ctx, customerId, itemId);
    expect(parseFloat(fetched!)).toBeCloseTo(7.25, 4);

    // listCustomerPrices should still have exactly one row for this pair
    const list = await listCustomerPrices(ctx, customerId);
    const matches = list.filter((p) => p.itemId === itemId);
    expect(matches).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // listCustomerPrices scoping
  // -------------------------------------------------------------------------

  it('listCustomerPrices returns all prices for company when customerId omitted', async () => {
    // Add a price for a second customer/item combo
    await setCustomerPrice(ctx, { customerId: customerId2, itemId: itemId2, price: '45.00' });

    const all = await listCustomerPrices(ctx);
    expect(all.length).toBeGreaterThanOrEqual(2);
    // All rows belong to our company
    expect(all.every((p) => p.companyId === ctx.companyId)).toBe(true);
  });

  it('listCustomerPrices filtered by customerId returns only that customer', async () => {
    const list = await listCustomerPrices(ctx, customerId2);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every((p) => p.customerId === customerId2)).toBe(true);
  });

  it('listCustomerPrices for company2 returns empty (scoping)', async () => {
    const list = await listCustomerPrices(ctx2);
    expect(list).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // deleteCustomerPrice
  // -------------------------------------------------------------------------

  it('deleteCustomerPrice removes the row; getPrice returns null afterwards', async () => {
    // Set a fresh price to delete
    const cp = await setCustomerPrice(ctx, { customerId, itemId: itemId2, price: '44.00' });

    await deleteCustomerPrice(ctx, cp.id);

    const fetched = await getPrice(ctx, customerId, itemId2);
    expect(fetched).toBeNull();
  });

  it('deleteCustomerPrice from wrong company throws NOT_FOUND', async () => {
    // Create a price in ctx (company 1)
    const cp = await setCustomerPrice(ctx, { customerId, itemId, price: '9.99' });

    // Attempt delete from ctx2 (company 2) — should fail
    await expect(deleteCustomerPrice(ctx2, cp.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  it('rejects negative price', async () => {
    await expect(
      setCustomerPrice(ctx, { customerId, itemId, price: '-5' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects unknown customer', async () => {
    await expect(
      setCustomerPrice(ctx, {
        customerId: '00000000-0000-0000-0000-000000000000',
        itemId,
        price: '10',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects unknown item', async () => {
    await expect(
      setCustomerPrice(ctx, {
        customerId,
        itemId: '00000000-0000-0000-0000-000000000000',
        price: '10',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
