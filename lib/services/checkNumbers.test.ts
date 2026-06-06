/**
 * Tests for checkNumbers.ts
 *
 * Inserts bill payments and expenses with numeric/non-numeric references,
 * asserts that nextCheckNumber returns max+1, and verifies the optional
 * paymentAccountId filter.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import {
  users,
  companies,
  accounts,
  vendors,
  billPayments,
  expenses,
} from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { nextCheckNumber, reserveCheckNumber } from './checkNumbers';

const TEST_DIR = path.resolve(
  process.cwd(),
  '.bookkeeper-data',
  'test-check-numbers-svc',
);

let ctx: ServiceContext;
let db: DB;
let checkingAccountId: string;
let vendorId: string;

describe('checkNumbers service', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'checks-owner@test.local', name: 'Checks Owner', passwordHash: 'x' })
      .returning();

    const [company] = await db
      .insert(companies)
      .values({ name: 'Check Numbers Test Co', ownerId: user.id })
      .returning();

    ctx = { db, companyId: company.id, userId: user.id };

    // Seed a checking account
    const [acct] = await db
      .insert(accounts)
      .values({
        companyId: company.id,
        code: '1000',
        name: 'Checking',
        type: 'asset',
        subtype: 'checking',
      })
      .returning();
    checkingAccountId = acct.id;

    // Seed a vendor
    const [vendor] = await db
      .insert(vendors)
      .values({
        companyId: company.id,
        displayName: 'Test Vendor',
      })
      .returning();
    vendorId = vendor.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns 1001 when no numeric references exist', async () => {
    const next = await nextCheckNumber(ctx);
    expect(next).toBe('1001');
  });

  it('returns max+1 after inserting bill payments with numeric references', async () => {
    // Insert two bill payments with check-style references.
    await db.insert(billPayments).values([
      {
        companyId: ctx.companyId,
        vendorId,
        date: new Date('2025-01-10'),
        method: 'check',
        reference: '1001',
        amount: '500.00',
        paymentAccountId: checkingAccountId,
      },
      {
        companyId: ctx.companyId,
        vendorId,
        date: new Date('2025-01-15'),
        method: 'check',
        reference: '1005',
        amount: '250.00',
        paymentAccountId: checkingAccountId,
      },
    ]);

    const next = await nextCheckNumber(ctx);
    expect(next).toBe('1006');
  });

  it('also considers expense references when finding the max', async () => {
    // Insert an expense with a higher check number.
    await db.insert(expenses).values({
      companyId: ctx.companyId,
      date: new Date('2025-02-01'),
      method: 'check',
      reference: '2000',
      paymentAccountId: checkingAccountId,
      total: '100.00',
    });

    const next = await nextCheckNumber(ctx);
    expect(next).toBe('2001');
  });

  it('ignores non-numeric references like "ACH-12345" or "wire"', async () => {
    await db.insert(billPayments).values({
      companyId: ctx.companyId,
      vendorId,
      date: new Date('2025-03-01'),
      method: 'ach',
      reference: 'ACH-99999', // not a pure numeric string
      amount: '750.00',
      paymentAccountId: checkingAccountId,
    });

    // Max numeric is still 2000, so next should still be 2001.
    const next = await nextCheckNumber(ctx);
    expect(next).toBe('2001');
  });

  it('filters by paymentAccountId when provided', async () => {
    // Create a second account and add a high check number there.
    const [acct2] = await db
      .insert(accounts)
      .values({
        companyId: ctx.companyId,
        code: '1010',
        name: 'Savings',
        type: 'asset',
        subtype: 'savings',
      })
      .returning();

    await db.insert(billPayments).values({
      companyId: ctx.companyId,
      vendorId,
      date: new Date('2025-04-01'),
      method: 'check',
      reference: '5000', // only on savings account
      amount: '100.00',
      paymentAccountId: acct2.id,
    });

    // Scoped to original checking account — max is still 2000.
    const nextChecking = await nextCheckNumber(ctx, checkingAccountId);
    expect(nextChecking).toBe('2001');

    // Scoped to savings account — max is 5000.
    const nextSavings = await nextCheckNumber(ctx, acct2.id);
    expect(nextSavings).toBe('5001');
  });

  it('reserveCheckNumber is an alias for nextCheckNumber', async () => {
    const a = await nextCheckNumber(ctx, checkingAccountId);
    const b = await reserveCheckNumber(ctx, checkingAccountId);
    expect(a).toBe(b);
  });

  it('scopes by companyId — other companies do not affect the count', async () => {
    // Create a completely separate company with a very high check number.
    const [user2] = await db
      .insert(users)
      .values({ email: 'other-co@test.local', name: 'Other', passwordHash: 'x' })
      .returning();
    const [co2] = await db
      .insert(companies)
      .values({ name: 'Other Co', ownerId: user2.id })
      .returning();
    const [acctOther] = await db
      .insert(accounts)
      .values({
        companyId: co2.id,
        code: '1000',
        name: 'Checking',
        type: 'asset',
        subtype: 'checking',
      })
      .returning();
    const [vendorOther] = await db
      .insert(vendors)
      .values({ companyId: co2.id, displayName: 'Other Vendor' })
      .returning();

    await db.insert(billPayments).values({
      companyId: co2.id,
      vendorId: vendorOther.id,
      date: new Date('2025-01-01'),
      method: 'check',
      reference: '9999',
      amount: '1.00',
      paymentAccountId: acctOther.id,
    });

    // Our company already has references up to 5000 (from the savings account
    // test above), so the unscoped next should be 5001 — unaffected by the
    // other company's 9999 reference.
    const next = await nextCheckNumber(ctx);
    expect(next).toBe('5001');
  });
});
