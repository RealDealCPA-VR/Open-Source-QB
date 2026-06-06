/**
 * Integration tests for statements.ts.
 *
 * Uses an isolated PGlite throwaway directory. Verifies:
 *  - customerStatement: produces chronological lines with a correct running balance.
 *  - vendor1099Report: only includes is_1099 vendors with total >= $600.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import {
  users,
  companies,
  accounts,
  customers,
  vendors,
  invoices,
  paymentsReceived,
  bills,
  billLines,
  billPayments,
  billPaymentApplications,
  expenses,
} from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { customerStatement, vendor1099Report } from './statements';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-statements-a7f3');
let ctx: ServiceContext;
let db: DB;

describe('statements service (integration)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'owner@stmts.test', name: 'Owner', passwordHash: 'x' })
      .returning();

    const [company] = await db
      .insert(companies)
      .values({ name: 'Statements Test Co', ownerId: user.id })
      .returning();

    ctx = { db, companyId: company.id, userId: user.id };
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // customerStatement
  // -------------------------------------------------------------------------

  describe('customerStatement', () => {
    let customerId: string;

    beforeAll(async () => {
      // Seed: create a customer.
      const [cust] = await db
        .insert(customers)
        .values({
          companyId: ctx.companyId,
          displayName: 'Acme Corp',
          email: 'billing@acme.test',
        })
        .returning();
      customerId = cust.id;

      // Invoice #1 — $500 on Jan 5
      await db.insert(invoices).values({
        companyId: ctx.companyId,
        customerId,
        invoiceNumber: 1001,
        date: new Date('2025-01-05'),
        status: 'open',
        subtotal: '500.00',
        discount: '0',
        taxAmount: '0',
        total: '500.00',
        amountPaid: '0',
        balanceDue: '500.00',
      });

      // Invoice #2 — $200 on Jan 20
      await db.insert(invoices).values({
        companyId: ctx.companyId,
        customerId,
        invoiceNumber: 1002,
        date: new Date('2025-01-20'),
        status: 'open',
        subtotal: '200.00',
        discount: '0',
        taxAmount: '0',
        total: '200.00',
        amountPaid: '0',
        balanceDue: '200.00',
      });

      // Payment — $300 on Jan 25
      await db.insert(paymentsReceived).values({
        companyId: ctx.companyId,
        customerId,
        date: new Date('2025-01-25'),
        method: 'check',
        reference: 'CHK-001',
        amount: '300.00',
        unapplied: '0',
      });
    });

    it('returns all lines in chronological order', async () => {
      const stmt = await customerStatement(ctx, customerId);
      expect(stmt.lines).toHaveLength(3);
      expect(stmt.lines[0].type).toBe('invoice');
      expect(stmt.lines[1].type).toBe('invoice');
      expect(stmt.lines[2].type).toBe('payment');
    });

    it('opening balance is zero when no range is given', async () => {
      const stmt = await customerStatement(ctx, customerId);
      expect(stmt.openingBalance).toBe('0.00');
    });

    it('computes correct running balance', async () => {
      const stmt = await customerStatement(ctx, customerId);
      // Line 1: invoice $500 → balance 500
      expect(stmt.lines[0].runningBalance).toBe('500.00');
      // Line 2: invoice $200 → balance 700
      expect(stmt.lines[1].runningBalance).toBe('700.00');
      // Line 3: payment $300 → balance 400
      expect(stmt.lines[2].runningBalance).toBe('400.00');
      // Closing balance == last running balance
      expect(stmt.closingBalance).toBe('400.00');
    });

    it('respects date range — from filter', async () => {
      // Request only from Jan 15 onwards: only inv#2 + payment should appear.
      const stmt = await customerStatement(ctx, customerId, {
        from: new Date('2025-01-15'),
      });
      // Opening balance = prior invoice ($500) - prior payments ($0)
      expect(stmt.openingBalance).toBe('500.00');
      expect(stmt.lines).toHaveLength(2);
      expect(stmt.lines[0].ref).toBe('1002');
      expect(stmt.lines[0].runningBalance).toBe('700.00'); // 500 opening + 200 invoice
      expect(stmt.lines[1].runningBalance).toBe('400.00'); // - 300 payment
    });

    it('customer not found throws NOT_FOUND', async () => {
      await expect(
        customerStatement(ctx, '00000000-0000-0000-0000-000000000000'),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('voided invoices are excluded', async () => {
      // Create a void invoice
      await db.insert(invoices).values({
        companyId: ctx.companyId,
        customerId,
        invoiceNumber: 9999,
        date: new Date('2025-01-10'),
        status: 'void',
        subtotal: '1000.00',
        discount: '0',
        taxAmount: '0',
        total: '1000.00',
        amountPaid: '0',
        balanceDue: '1000.00',
      });
      const stmt = await customerStatement(ctx, customerId);
      // Should still be 3 lines (not 4)
      const inv9999 = stmt.lines.find((l) => l.ref === '9999');
      expect(inv9999).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // vendor1099Report
  // -------------------------------------------------------------------------

  describe('vendor1099Report', () => {
    let vendor1099Id: string;
    let vendorNon1099Id: string;
    let expenseAccountId: string;

    beforeAll(async () => {
      // Create minimal accounts needed for bills/expenses
      const [expAcct] = await db
        .insert(accounts)
        .values({
          companyId: ctx.companyId,
          code: '5100',
          name: 'Contractor Expenses',
          type: 'expense',
          subtype: 'operating_expenses',
        })
        .returning();
      expenseAccountId = expAcct.id;

      const [cashAcct] = await db
        .insert(accounts)
        .values({
          companyId: ctx.companyId,
          code: '1000',
          name: 'Checking',
          type: 'asset',
          subtype: 'checking',
        })
        .returning();

      // 1099 vendor
      const [v1] = await db
        .insert(vendors)
        .values({
          companyId: ctx.companyId,
          displayName: 'Jane Doe Consulting',
          is1099: true,
          taxId: '12-3456789',
        })
        .returning();
      vendor1099Id = v1.id;

      // Non-1099 vendor
      const [v2] = await db
        .insert(vendors)
        .values({
          companyId: ctx.companyId,
          displayName: 'Office Supplies Inc',
          is1099: false,
        })
        .returning();
      vendorNon1099Id = v2.id;

      // --- Bill + payment for 1099 vendor: $700 paid in 2025 ---

      // Create a bill for $700
      const [bill1] = await db
        .insert(bills)
        .values({
          companyId: ctx.companyId,
          vendorId: vendor1099Id,
          billNumber: 'B-001',
          date: new Date('2025-03-01'),
          status: 'paid',
          total: '700.00',
          amountPaid: '700.00',
          balanceDue: '0.00',
        })
        .returning();

      await db.insert(billLines).values({
        billId: bill1.id,
        accountId: expenseAccountId,
        description: 'Consulting services',
        amount: '700.00',
      });

      // Create the payment
      const [bp1] = await db
        .insert(billPayments)
        .values({
          companyId: ctx.companyId,
          vendorId: vendor1099Id,
          date: new Date('2025-03-15'),
          method: 'check',
          amount: '700.00',
          paymentAccountId: cashAcct.id,
        })
        .returning();

      await db.insert(billPaymentApplications).values({
        billPaymentId: bp1.id,
        billId: bill1.id,
        amountApplied: '700.00',
      });

      // --- Expense for non-1099 vendor: $800 (should NOT appear in report) ---
      await db.insert(expenses).values({
        companyId: ctx.companyId,
        vendorId: vendorNon1099Id,
        date: new Date('2025-04-01'),
        method: 'check',
        paymentAccountId: cashAcct.id,
        total: '800.00',
      });

      // --- Direct expense for 1099 vendor: $50 (below threshold) ---
      const [v3] = await db
        .insert(vendors)
        .values({
          companyId: ctx.companyId,
          displayName: 'Small Contractor',
          is1099: true,
          taxId: '99-9999999',
        })
        .returning();

      await db.insert(expenses).values({
        companyId: ctx.companyId,
        vendorId: v3.id,
        date: new Date('2025-05-01'),
        method: 'check',
        paymentAccountId: cashAcct.id,
        total: '50.00',
      });
    });

    it('returns only 1099 vendors with total >= $600', async () => {
      const rows = await vendor1099Report(ctx, { year: 2025 });
      // Only Jane Doe Consulting with $700 should appear.
      expect(rows).toHaveLength(1);
      expect(rows[0].vendorName).toBe('Jane Doe Consulting');
      expect(rows[0].total).toBe('700.00');
      expect(rows[0].taxId).toBe('12-3456789');
    });

    it('excludes non-1099 vendors regardless of amount', async () => {
      const rows = await vendor1099Report(ctx, { year: 2025 });
      const officeSupplies = rows.find((r) => r.vendorName === 'Office Supplies Inc');
      expect(officeSupplies).toBeUndefined();
    });

    it('excludes 1099 vendors below $600 threshold', async () => {
      const rows = await vendor1099Report(ctx, { year: 2025 });
      const small = rows.find((r) => r.vendorName === 'Small Contractor');
      expect(small).toBeUndefined();
    });

    it('excludes payments outside the requested year', async () => {
      // 2024 should return empty (no 2024 transactions seeded)
      const rows = await vendor1099Report(ctx, { year: 2024 });
      expect(rows).toHaveLength(0);
    });

    it('combines bill-payments and expenses for the same vendor', async () => {
      // Seed a vendor with $400 via expense (2025) — still below threshold alone.
      // Then confirm they appear if combined with a later bill payment.
      const [vCombo] = await db
        .insert(vendors)
        .values({
          companyId: ctx.companyId,
          displayName: 'Combo Vendor',
          is1099: true,
          taxId: '55-5555555',
        })
        .returning();

      // Grab cash account
      const [cashAcct] = await ctx.db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.companyId, ctx.companyId),
            eq(accounts.code, '1000'),
          ),
        );

      // Direct expense $400
      await db.insert(expenses).values({
        companyId: ctx.companyId,
        vendorId: vCombo.id,
        date: new Date('2025-06-01'),
        method: 'check',
        paymentAccountId: cashAcct.id,
        total: '400.00',
      });

      // Bill + payment $300
      const [billCombo] = await db
        .insert(bills)
        .values({
          companyId: ctx.companyId,
          vendorId: vCombo.id,
          date: new Date('2025-07-01'),
          status: 'paid',
          total: '300.00',
          amountPaid: '300.00',
          balanceDue: '0.00',
        })
        .returning();

      await db.insert(billLines).values({
        billId: billCombo.id,
        accountId: expenseAccountId,
        amount: '300.00',
      });

      const [bpCombo] = await db
        .insert(billPayments)
        .values({
          companyId: ctx.companyId,
          vendorId: vCombo.id,
          date: new Date('2025-07-15'),
          method: 'check',
          amount: '300.00',
          paymentAccountId: cashAcct.id,
        })
        .returning();

      await db.insert(billPaymentApplications).values({
        billPaymentId: bpCombo.id,
        billId: billCombo.id,
        amountApplied: '300.00',
      });

      const rows = await vendor1099Report(ctx, { year: 2025 });
      const combo = rows.find((r) => r.vendorName === 'Combo Vendor');
      expect(combo).toBeDefined();
      expect(combo!.total).toBe('700.00'); // $400 expense + $300 bill payment
    });
  });
});
