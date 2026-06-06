/**
 * Integration tests for form1099Xml.ts.
 *
 * Seeds a 1099 vendor + a paid bill so vendor1099Report returns them, then asserts
 * that the generated XML contains the expected vendor name and payment amount.
 *
 * Uses a unique throwaway PGlite directory to stay fully isolated.
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
  bills,
  billLines,
  billPayments,
  billPaymentApplications,
} from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { generate1099NecFile } from './form1099Xml';

const TEST_DIR = path.resolve(
  process.cwd(),
  '.bookkeeper-data',
  'test-form1099xml-c4e9',
);
let ctx: ServiceContext;
let db: DB;

describe('generate1099NecFile', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    // --- Users + company ---
    const [user] = await db
      .insert(users)
      .values({ email: 'owner@1099xml.test', name: 'Test Owner', passwordHash: 'x' })
      .returning();

    const [company] = await db
      .insert(companies)
      .values({ name: 'Acme Payer LLC', ownerId: user.id })
      .returning();

    ctx = { db, companyId: company.id, userId: user.id };

    // --- Accounts needed for bill/payment posting ---
    const [expAcct] = await db
      .insert(accounts)
      .values({
        companyId: company.id,
        code: '6100',
        name: 'Contractor Expenses',
        type: 'expense',
        subtype: 'operating_expenses',
      })
      .returning();

    const [cashAcct] = await db
      .insert(accounts)
      .values({
        companyId: company.id,
        code: '1000',
        name: 'Checking',
        type: 'asset',
        subtype: 'checking',
      })
      .returning();

    // --- 1099 vendor with taxId ---
    const [vendor1099] = await db
      .insert(vendors)
      .values({
        companyId: company.id,
        displayName: 'Jane Doe Consulting',
        is1099: true,
        taxId: '12-3456789',
      })
      .returning();

    // --- Bill for $750 in 2025 ---
    const [bill] = await db
      .insert(bills)
      .values({
        companyId: company.id,
        vendorId: vendor1099.id,
        billNumber: 'INV-2025-001',
        date: new Date('2025-04-10'),
        status: 'paid',
        total: '750.00',
        amountPaid: '750.00',
        balanceDue: '0.00',
      })
      .returning();

    await db.insert(billLines).values({
      billId: bill.id,
      accountId: expAcct.id,
      description: 'Consulting Q1 2025',
      amount: '750.00',
    });

    // --- Bill payment applied to that bill ---
    const [bp] = await db
      .insert(billPayments)
      .values({
        companyId: company.id,
        vendorId: vendor1099.id,
        date: new Date('2025-04-15'),
        method: 'check',
        amount: '750.00',
        paymentAccountId: cashAcct.id,
      })
      .returning();

    await db.insert(billPaymentApplications).values({
      billPaymentId: bp.id,
      billId: bill.id,
      amountApplied: '750.00',
    });

    // --- Non-1099 vendor (should be excluded) ---
    const [vendorNot] = await db
      .insert(vendors)
      .values({
        companyId: company.id,
        displayName: 'Office Depot',
        is1099: false,
      })
      .returning();

    // Bill payment for non-1099 vendor (should NOT appear in XML)
    const [billNot] = await db
      .insert(bills)
      .values({
        companyId: company.id,
        vendorId: vendorNot.id,
        date: new Date('2025-05-01'),
        status: 'paid',
        total: '900.00',
        amountPaid: '900.00',
        balanceDue: '0.00',
      })
      .returning();

    await db.insert(billLines).values({
      billId: billNot.id,
      accountId: expAcct.id,
      amount: '900.00',
    });

    const [bpNot] = await db
      .insert(billPayments)
      .values({
        companyId: company.id,
        vendorId: vendorNot.id,
        date: new Date('2025-05-05'),
        method: 'check',
        amount: '900.00',
        paymentAccountId: cashAcct.id,
      })
      .returning();

    await db.insert(billPaymentApplications).values({
      billPaymentId: bpNot.id,
      billId: billNot.id,
      amountApplied: '900.00',
    });
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns a string', async () => {
    const xml = await generate1099NecFile(ctx, { year: 2025 });
    expect(typeof xml).toBe('string');
  });

  it('starts with an XML declaration', async () => {
    const xml = await generate1099NecFile(ctx, { year: 2025 });
    expect(xml.trimStart()).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  });

  it('contains the correct tax year', async () => {
    const xml = await generate1099NecFile(ctx, { year: 2025 });
    expect(xml).toContain('<TaxYear>2025</TaxYear>');
  });

  it('contains the payer company name', async () => {
    const xml = await generate1099NecFile(ctx, { year: 2025 });
    expect(xml).toContain('Acme Payer LLC');
  });

  it('contains the eligible vendor name', async () => {
    const xml = await generate1099NecFile(ctx, { year: 2025 });
    expect(xml).toContain('Jane Doe Consulting');
  });

  it('contains the vendor tax ID', async () => {
    const xml = await generate1099NecFile(ctx, { year: 2025 });
    expect(xml).toContain('12-3456789');
  });

  it('contains the correct NonemployeeCompensation amount', async () => {
    const xml = await generate1099NecFile(ctx, { year: 2025 });
    expect(xml).toContain('<NonemployeeCompensation>750.00</NonemployeeCompensation>');
  });

  it('excludes non-1099 vendors', async () => {
    const xml = await generate1099NecFile(ctx, { year: 2025 });
    expect(xml).not.toContain('Office Depot');
  });

  it('returns empty vendor list when year has no eligible payments', async () => {
    const xml = await generate1099NecFile(ctx, { year: 2020 });
    // No Form1099NEC records for 2020
    expect(xml).not.toContain('<Form1099NEC>');
    // But still has the root element and payer
    expect(xml).toContain('<Form1099NECFile>');
    expect(xml).toContain('Acme Payer LLC');
  });

  it('wraps vendor list in Form1099NECFile root element', async () => {
    const xml = await generate1099NecFile(ctx, { year: 2025 });
    expect(xml).toContain('<Form1099NECFile>');
    expect(xml).toContain('</Form1099NECFile>');
  });

  it('throws VALIDATION for an out-of-range year', async () => {
    await expect(generate1099NecFile(ctx, { year: 1800 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});
