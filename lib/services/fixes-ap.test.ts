/**
 * Regression tests for the AP audit-fix package:
 *  1. PO-to-bill conversion is atomic — a failure mid-conversion rolls back the PO claim,
 *     and double-conversion can never double-post A/P.
 *  2. Vendor credit application uses bills.amountCredited (not amountPaid); unapplyFromBill
 *     reverses an application; voidBill blocks on applied credits with a distinct message.
 *  3. vendor1099Report excludes credit-card-funded bill payments and expenses.
 *  4. Recurring templates use the RUN date, not the frozen payload date (dueDate offset carried).
 *  5. listBillPayments returns newest-first.
 *  6. GL descriptions/memos use the vendor name, never the vendor UUID.
 *  7. Duplicate billIds in payBills applications are rejected (over-application guard).
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
  vendors,
  bills,
  expenses,
  journalEntries,
  journalEntryLines,
  purchaseOrders,
  purchaseOrderLines,
} from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { createBill, voidBill } from './bills';
import { payBills, listBillPayments } from './billPayments';
import { createVendorCredit, applyToBill, unapplyFromBill, voidVendorCredit } from './vendorCredits';
import { createPurchaseOrder, convertToBill } from './purchaseOrders';
import { createTemplate, runDue } from './recurring';
import { vendor1099Report } from './statements';
import { trialBalance } from './reports';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-fixes-ap');
let ctx: ServiceContext;
let db: DB;
const acct: Record<string, string> = {};
let vendorId: string;
const VENDOR_NAME = 'Acme Tooling Supply';

async function newVendor(displayName: string, extra: Partial<typeof vendors.$inferInsert> = {}) {
  const [v] = await db
    .insert(vendors)
    .values({ companyId: ctx.companyId, displayName, ...extra })
    .returning();
  return v;
}

describe('AP audit fixes', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'ap-fixes@test.local', name: 'AP Fixes', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'AP Fixes Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['2000', 'Accounts Payable', 'liability', 'accounts_payable'],
      ['2100', 'Company Credit Card', 'liability', 'credit_card'],
      ['5000', 'Office Supplies Expense', 'expense', 'operating_expenses'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }

    const v = await newVendor(VENDOR_NAME);
    vendorId = v.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. PO-to-bill conversion atomicity
  // ──────────────────────────────────────────────────────────────────────────

  describe('convertToBill atomicity', () => {
    it('converts once, stamps the PO, and rejects a second conversion', async () => {
      const po = await createPurchaseOrder(ctx, {
        vendorId,
        date: new Date('2025-02-01'),
        lines: [{ accountId: acct['5000'], quantity: '2', rate: '50.00' }],
      });

      const bill = await convertToBill(ctx, po.id);
      expect(bill.total).toBe('100.00');

      const [stamped] = await db
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, po.id));
      expect(stamped.status).toBe('closed');
      expect(stamped.convertedBillId).toBe(bill.id);

      await expect(convertToBill(ctx, po.id)).rejects.toMatchObject({ code: 'CONFLICT' });

      // Exactly ONE bill exists for this conversion.
      const vendorBills = await db
        .select()
        .from(bills)
        .where(and(eq(bills.companyId, ctx.companyId), eq(bills.vendorId, vendorId)));
      expect(vendorBills.filter((b) => b.id === bill.id)).toHaveLength(1);
    });

    it('rolls back the PO claim when bill creation fails mid-conversion', async () => {
      // Insert a PO whose line has NO accountId — bill creation will throw inside
      // the conversion transaction, after the PO has been claimed.
      const [po] = await db
        .insert(purchaseOrders)
        .values({
          companyId: ctx.companyId,
          vendorId,
          poNumber: 9001,
          date: new Date('2025-02-05'),
          status: 'open',
          total: '75.00',
        })
        .returning();
      await db.insert(purchaseOrderLines).values({
        purchaseOrderId: po.id,
        accountId: null,
        quantity: '1',
        rate: '75.00',
        amount: '75.00',
        lineOrder: 0,
      });

      const billsBefore = await db
        .select({ id: bills.id })
        .from(bills)
        .where(eq(bills.companyId, ctx.companyId));

      await expect(convertToBill(ctx, po.id)).rejects.toMatchObject({ code: 'VALIDATION' });

      // The PO must still be open and unconverted — the claim was rolled back.
      const [after] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, po.id));
      expect(after.status).toBe('open');
      expect(after.convertedBillId).toBeNull();

      // No bill (and therefore no A/P posting) leaked out of the failed conversion.
      const billsAfter = await db
        .select({ id: bills.id })
        .from(bills)
        .where(eq(bills.companyId, ctx.companyId));
      expect(billsAfter.length).toBe(billsBefore.length);

      const tb = await trialBalance(ctx);
      expect(tb.balanced).toBe(true);

      // And the rolled-back PO can still be converted once fixed.
      await db
        .update(purchaseOrderLines)
        .set({ accountId: acct['5000'] })
        .where(eq(purchaseOrderLines.purchaseOrderId, po.id));
      const bill = await convertToBill(ctx, po.id);
      expect(bill.total).toBe('75.00');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Vendor credits — amountCredited, unapply, void guards
  // ──────────────────────────────────────────────────────────────────────────

  describe('vendor credits use bills.amountCredited', () => {
    it('applyToBill increments amountCredited, never amountPaid', async () => {
      const credit = await createVendorCredit(ctx, {
        vendorId,
        date: new Date('2025-03-01'),
        lines: [{ accountId: acct['5000'], amount: '150.00' }],
      });
      const bill = await createBill(ctx, {
        vendorId,
        date: new Date('2025-03-02'),
        lines: [{ accountId: acct['5000'], amount: '400.00' }],
      });

      const result = await applyToBill(ctx, {
        vendorCreditId: credit.id,
        billId: bill.id,
        amount: '100.00',
      });

      expect(result.bill.amountCredited).toBe('100.00');
      expect(result.bill.amountPaid).toBe('0.00');
      expect(result.bill.balanceDue).toBe('300.00');
      expect(result.bill.status).toBe('partial');

      // Voiding a credit-applied bill is blocked with a credits-specific message.
      await expect(voidBill(ctx, bill.id)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(voidBill(ctx, bill.id)).rejects.toThrow(/vendor credits/i);

      // Paying off the remainder keeps balanceDue = total - amountPaid - amountCredited.
      await payBills(ctx, {
        vendorId,
        date: new Date('2025-03-10'),
        method: 'check',
        paymentAccountId: acct['1000'],
        applications: [{ billId: bill.id, amountApplied: '300.00' }],
      });

      const [paid] = await db.select().from(bills).where(eq(bills.id, bill.id));
      expect(paid.amountPaid).toBe('300.00');
      expect(paid.amountCredited).toBe('100.00');
      expect(paid.balanceDue).toBe('0.00');
      expect(paid.status).toBe('paid');
    });

    it('unapplyFromBill restores both sides, making void possible', async () => {
      const credit = await createVendorCredit(ctx, {
        vendorId,
        date: new Date('2025-03-15'),
        lines: [{ accountId: acct['5000'], amount: '80.00' }],
      });
      const bill = await createBill(ctx, {
        vendorId,
        date: new Date('2025-03-16'),
        lines: [{ accountId: acct['5000'], amount: '200.00' }],
      });

      await applyToBill(ctx, { vendorCreditId: credit.id, billId: bill.id, amount: '80.00' });
      // Fully applied credit cannot be voided yet.
      await expect(voidVendorCredit(ctx, credit.id)).rejects.toMatchObject({ code: 'CONFLICT' });

      const result = await unapplyFromBill(ctx, {
        vendorCreditId: credit.id,
        billId: bill.id,
        amount: '80.00',
      });

      expect(result.credit.unapplied).toBe('80.00');
      expect(result.credit.status).toBe('open');
      expect(result.bill.amountCredited).toBe('0.00');
      expect(result.bill.balanceDue).toBe('200.00');
      expect(result.bill.status).toBe('open');

      // Now both "unapply first" instructions are satisfiable.
      const voidedCredit = await voidVendorCredit(ctx, credit.id);
      expect(voidedCredit.status).toBe('void');
      const voidedBill = await voidBill(ctx, bill.id);
      expect(voidedBill.status).toBe('void');

      const tb = await trialBalance(ctx);
      expect(tb.balanced).toBe(true);
    });

    it('rejects unapplying more than was applied', async () => {
      const credit = await createVendorCredit(ctx, {
        vendorId,
        date: new Date('2025-03-20'),
        lines: [{ accountId: acct['5000'], amount: '60.00' }],
      });
      const bill = await createBill(ctx, {
        vendorId,
        date: new Date('2025-03-21'),
        lines: [{ accountId: acct['5000'], amount: '100.00' }],
      });
      await applyToBill(ctx, { vendorCreditId: credit.id, billId: bill.id, amount: '40.00' });

      await expect(
        unapplyFromBill(ctx, { vendorCreditId: credit.id, billId: bill.id, amount: '50.00' }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Duplicate billId guard in payBills
  // ──────────────────────────────────────────────────────────────────────────

  describe('payBills duplicate-application guard', () => {
    it('rejects duplicate billIds that would bypass the over-application check', async () => {
      const bill = await createBill(ctx, {
        vendorId,
        date: new Date('2025-04-01'),
        lines: [{ accountId: acct['5000'], amount: '100.00' }],
      });

      await expect(
        payBills(ctx, {
          vendorId,
          date: new Date('2025-04-02'),
          method: 'check',
          paymentAccountId: acct['1000'],
          applications: [
            { billId: bill.id, amountApplied: '60.00' },
            { billId: bill.id, amountApplied: '60.00' },
          ],
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });

      // Bill untouched — no partial application leaked.
      const [unchanged] = await db.select().from(bills).where(eq(bills.id, bill.id));
      expect(unchanged.amountPaid).toBe('0.00');
      expect(unchanged.balanceDue).toBe('100.00');
      expect(unchanged.status).toBe('open');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. listBillPayments newest-first
  // ──────────────────────────────────────────────────────────────────────────

  describe('listBillPayments ordering', () => {
    it('returns newest-first and the default limit keeps the most recent rows', async () => {
      // Three bills paid on three distinct, out-of-order dates.
      const dates = ['2025-05-20', '2025-05-01', '2025-05-10'];
      for (const d of dates) {
        const bill = await createBill(ctx, {
          vendorId,
          date: new Date('2025-04-30'),
          lines: [{ accountId: acct['5000'], amount: '10.00' }],
        });
        await payBills(ctx, {
          vendorId,
          date: new Date(d),
          method: 'check',
          paymentAccountId: acct['1000'],
          applications: [{ billId: bill.id, amountApplied: '10.00' }],
        });
      }

      const payments = await listBillPayments(ctx);
      for (let i = 1; i < payments.length; i++) {
        expect(payments[i - 1].date.getTime()).toBeGreaterThanOrEqual(payments[i].date.getTime());
      }

      // limit: 1 must return the NEWEST payment, not the oldest.
      const [newest] = await listBillPayments(ctx, { limit: 1 });
      const maxDate = Math.max(...payments.map((p) => p.date.getTime()));
      expect(newest.date.getTime()).toBe(maxDate);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. GL descriptions/memos use vendor names, not UUIDs
  // ──────────────────────────────────────────────────────────────────────────

  describe('GL descriptions use the vendor name', () => {
    it('bill payment journal entry shows the vendor name, not the UUID', async () => {
      const bill = await createBill(ctx, {
        vendorId,
        date: new Date('2025-06-01'),
        lines: [{ accountId: acct['5000'], amount: '50.00' }],
      });
      const payment = await payBills(ctx, {
        vendorId,
        date: new Date('2025-06-02'),
        method: 'check',
        paymentAccountId: acct['1000'],
        applications: [{ billId: bill.id, amountApplied: '50.00' }],
      });

      const [entry] = await db
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.id, payment.postedEntryId!));
      expect(entry.description).toContain(VENDOR_NAME);
      expect(entry.description).not.toContain(vendorId);

      const lines = await db
        .select()
        .from(journalEntryLines)
        .where(eq(journalEntryLines.journalEntryId, entry.id));
      const apLine = lines.find((l) => l.accountId === acct['2000']);
      expect(apLine?.memo).toContain(VENDOR_NAME);
      expect(apLine?.memo).not.toContain(vendorId);
    });

    it('bill posting A/P memo shows the vendor name, not the UUID', async () => {
      const bill = await createBill(ctx, {
        vendorId,
        billNumber: 'BILL-NAME-1',
        date: new Date('2025-06-05'),
        lines: [{ accountId: acct['5000'], amount: '25.00' }],
      });

      const lines = await db
        .select()
        .from(journalEntryLines)
        .where(eq(journalEntryLines.journalEntryId, bill.postedEntryId!));
      const apLine = lines.find((l) => l.accountId === acct['2000']);
      expect(apLine?.memo).toContain(VENDOR_NAME);
      expect(apLine?.memo).not.toContain(vendorId);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. 1099 totals exclude card-settled payments
  // ──────────────────────────────────────────────────────────────────────────

  describe('vendor1099Report card exclusions', () => {
    it('includes check payments, excludes card-method and card-funded payments', async () => {
      // Vendor A: $700 by check → INCLUDED.
      const vA = await newVendor('Check Contractor', { is1099: true, taxId: '11-1111111' });
      const billA = await createBill(ctx, {
        vendorId: vA.id,
        date: new Date('2025-07-01'),
        lines: [{ accountId: acct['5000'], amount: '700.00' }],
      });
      await payBills(ctx, {
        vendorId: vA.id,
        date: new Date('2025-07-05'),
        method: 'check',
        paymentAccountId: acct['1000'],
        applications: [{ billId: billA.id, amountApplied: '700.00' }],
      });

      // Vendor B: $700 by credit_card method → EXCLUDED (1099-K territory).
      const vB = await newVendor('Card Contractor', { is1099: true, taxId: '22-2222222' });
      const billB = await createBill(ctx, {
        vendorId: vB.id,
        date: new Date('2025-07-01'),
        lines: [{ accountId: acct['5000'], amount: '700.00' }],
      });
      await payBills(ctx, {
        vendorId: vB.id,
        date: new Date('2025-07-05'),
        method: 'credit_card',
        paymentAccountId: acct['2100'],
        applications: [{ billId: billB.id, amountApplied: '700.00' }],
      });

      // Vendor C: $900 direct expense, method 'other' but FUNDED from the credit
      // card account → EXCLUDED by the funding-account check.
      const vC = await newVendor('Sneaky Card Contractor', { is1099: true, taxId: '33-3333333' });
      await db.insert(expenses).values({
        companyId: ctx.companyId,
        vendorId: vC.id,
        date: new Date('2025-07-10'),
        method: 'other',
        paymentAccountId: acct['2100'],
        total: '900.00',
      });

      // Vendor D: mixed — $500 check + $300 card → only $500 counts → below $600.
      const vD = await newVendor('Mixed Contractor', { is1099: true, taxId: '44-4444444' });
      const billD1 = await createBill(ctx, {
        vendorId: vD.id,
        date: new Date('2025-07-01'),
        lines: [{ accountId: acct['5000'], amount: '500.00' }],
      });
      await payBills(ctx, {
        vendorId: vD.id,
        date: new Date('2025-07-06'),
        method: 'check',
        paymentAccountId: acct['1000'],
        applications: [{ billId: billD1.id, amountApplied: '500.00' }],
      });
      const billD2 = await createBill(ctx, {
        vendorId: vD.id,
        date: new Date('2025-07-02'),
        lines: [{ accountId: acct['5000'], amount: '300.00' }],
      });
      await payBills(ctx, {
        vendorId: vD.id,
        date: new Date('2025-07-07'),
        method: 'credit_card',
        paymentAccountId: acct['2100'],
        applications: [{ billId: billD2.id, amountApplied: '300.00' }],
      });

      const rows = await vendor1099Report(ctx, { year: 2025 });

      const a = rows.find((r) => r.vendorName === 'Check Contractor');
      expect(a).toBeDefined();
      expect(a!.total).toBe('700.00');

      expect(rows.find((r) => r.vendorName === 'Card Contractor')).toBeUndefined();
      expect(rows.find((r) => r.vendorName === 'Sneaky Card Contractor')).toBeUndefined();
      expect(rows.find((r) => r.vendorName === 'Mixed Contractor')).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Recurring templates use the run date
  // ──────────────────────────────────────────────────────────────────────────

  describe('recurring templates use the run date', () => {
    it('two runs a month apart produce two distinct document dates (not the frozen payload date)', async () => {
      const tpl = await createTemplate(ctx, {
        name: 'Monthly Tool Rental',
        docType: 'bill',
        frequency: 'monthly',
        nextRunDate: new Date('2025-08-10T00:00:00.000Z'),
        template: {
          vendorId,
          // Frozen original document date + a 30-day terms offset.
          date: '2025-01-01T00:00:00.000Z',
          dueDate: '2025-01-31T00:00:00.000Z',
          lines: [{ accountId: acct['5000'], amount: '120.00' }],
        },
      });
      expect(tpl.id).toBeTruthy();

      // First run.
      const run1 = await runDue(ctx, new Date('2025-08-10T00:00:00.000Z'));
      expect(run1.generated).toHaveLength(1);
      const [bill1] = await db
        .select()
        .from(bills)
        .where(eq(bills.id, run1.generated[0].docId));
      expect(bill1.date.toISOString().slice(0, 10)).toBe('2025-08-10');
      // dueDate = run date + original 30-day offset.
      expect(bill1.dueDate!.toISOString().slice(0, 10)).toBe('2025-09-09');

      // Second run, one month later.
      const run2 = await runDue(ctx, new Date('2025-09-10T00:00:00.000Z'));
      expect(run2.generated).toHaveLength(1);
      const [bill2] = await db
        .select()
        .from(bills)
        .where(eq(bills.id, run2.generated[0].docId));
      expect(bill2.date.toISOString().slice(0, 10)).toBe('2025-09-10');
      expect(bill2.dueDate!.toISOString().slice(0, 10)).toBe('2025-10-10');

      // The two recurrences carry DISTINCT run dates — neither is the frozen 2025-01-01.
      expect(bill1.date.getTime()).not.toBe(bill2.date.getTime());
      expect(bill1.date.toISOString().slice(0, 10)).not.toBe('2025-01-01');
    });
  });
});
