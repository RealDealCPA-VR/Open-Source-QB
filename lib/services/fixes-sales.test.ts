/**
 * Regression tests for the "sales" audit-fix package.
 *
 * Covers:
 *  1. Invoice API route forwards discountType / currency / exchangeRate /
 *     retainagePercent / per-line taxRateId (previously silently dropped).
 *  2. Multi-line foreign-currency invoices no longer throw UNBALANCED
 *     (per-line FX rounding fixed via penny pre-allocation).
 *  3. creditMemos.applyToInvoice respects retainage (delegates to markPaidAmount).
 *  4. Customer statements include credit memos (opening + running balance).
 *  5. receivePayment foreign-currency handling — A/R clears at the booked rate
 *     and the difference posts to Exchange Gain/Loss (6900).
 *  6. Duplicate invoiceIds in a payment's applications are rejected.
 *  7. Estimate / sales-order conversion is atomic (no closed-source-doc with a
 *     failed invoice, second convert always conflicts).
 *  8. listInvoices / listCreditMemos filter in SQL and return correct subsets.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import {
  users,
  companies,
  accounts,
  customers,
  estimates,
  invoices,
  journalEntryLines,
  salesOrders,
  taxAgencies,
  taxRates,
} from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { trialBalance } from './reports';
import { createInvoice, listInvoices } from './invoices';
import { createCreditMemo, applyToInvoice, listCreditMemos } from './creditMemos';
import { receivePayment } from './payments';
import { customerStatement } from './statements';
import { createEstimate, convertToInvoice as convertEstimate } from './estimates';
import { createSalesOrder, convertToInvoice as convertSalesOrder } from './salesOrders';
import { Money } from '@/lib/money';

// Route handler under test (uses the mocked getServerContext below).
vi.mock('@/lib/context', () => ({
  getServerContext: vi.fn(async () => ctx),
}));
import { POST as invoicesPOST } from '@/app/api/invoices/route';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-fixes-sales');

let ctx: ServiceContext;
let db: DB;
const acct: Record<string, string> = {};
let customerId: string;
let taxRateId: string;

describe('sales audit fixes (end-to-end)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'owner@fixes-sales.test', name: 'Owner', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Sales Fixes Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['1050', 'Undeposited Funds', 'asset', 'checking'],
      ['1200', 'Accounts Receivable', 'asset', 'accounts_receivable'],
      ['2200', 'Sales Tax Payable', 'liability', 'long_term_liability'],
      ['3000', 'Owner Equity', 'equity', 'owners_equity'],
      ['4000', 'Sales Income', 'revenue', 'sales'],
      ['4100', 'Service Income', 'revenue', 'service_revenue'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }

    const [cust] = await db
      .insert(customers)
      .values({ companyId: company.id, displayName: 'Acme Corp', taxable: true })
      .returning();
    customerId = cust.id;

    const [agency] = await db
      .insert(taxAgencies)
      .values({ companyId: company.id, name: 'State Tax Board', liabilityAccountId: acct['2200'] })
      .returning();
    const [tr] = await db
      .insert(taxRates)
      .values({
        companyId: company.id,
        name: 'Sales Tax 10%',
        rate: '0.100000',
        agencyId: agency.id,
        isActive: true,
      })
      .returning();
    taxRateId = tr.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // 1. Invoice API route forwards previously-dropped fields
  // ---------------------------------------------------------------------------

  it('POST /api/invoices forwards discountType, currency, exchangeRate, retainagePercent and per-line taxRateId', async () => {
    const req = new Request('http://localhost/api/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId,
        date: '2026-01-10',
        discount: '10',
        discountType: 'percent',
        currency: 'EUR',
        exchangeRate: '1.10',
        retainagePercent: '5',
        lines: [
          { accountId: acct['4000'], description: 'Widget', quantity: 1, rate: 100, taxRateId },
        ],
      }),
    });
    const res = await invoicesPOST(req as never);
    expect(res.status).toBe(201);
    const body = await res.json();

    // Percent discount: 10% of 100 = 10.00 (not a flat $10 by accident of the same number —
    // assert the resolved type + value round-tripped).
    expect(body.discountType).toBe('percent');
    expect(body.discount).toBe('10.00');
    expect(body.currency).toBe('EUR');
    expect(Money.of(body.exchangeRate).toFixed(2)).toBe('1.10');
    expect(body.retainagePercent).toBe('5.00');
    // Per-line tax rate reached the service: tax = 100 * 10% = 10.00
    expect(body.taxAmount).toBe('10.00');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('POST /api/invoices rejects an unknown discountType', async () => {
    const req = new Request('http://localhost/api/invoices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId,
        date: '2026-01-10',
        discount: '10',
        discountType: 'bogus',
        lines: [{ accountId: acct['4000'], quantity: 1, rate: 100 }],
      }),
    });
    const res = await invoicesPOST(req as never);
    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // 2. Multi-line FX invoice — per-line rounding no longer unbalances the entry
  // ---------------------------------------------------------------------------

  it('creates a 2-line EUR invoice at rate 1.5 with unlucky cents (previously UNBALANCED)', async () => {
    // 0.55 * 1.5 = 0.825 → two independently rounded credits of 0.83 = 1.66,
    // but the A/R debit round2(1.10 * 1.5) = 1.65. allocate() must reconcile.
    const invoice = await createInvoice(ctx, {
      customerId,
      date: new Date('2026-01-15'),
      currency: 'EUR',
      exchangeRate: '1.5',
      lines: [
        { accountId: acct['4000'], quantity: 1, rate: '0.55' },
        { accountId: acct['4100'], quantity: 1, rate: '0.55' },
      ],
    });

    expect(invoice.total).toBe('1.10'); // transaction currency
    expect(invoice.postedEntryId).toBeTruthy();

    // Both sides of the GL entry sum to exactly round2(1.10 * 1.5) = 1.65.
    const lines = await db
      .select()
      .from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, invoice.postedEntryId!));
    const debits = lines.reduce((s, l) => s.plus(Money.of(l.debit)), Money.zero());
    const credits = lines.reduce((s, l) => s.plus(Money.of(l.credit)), Money.zero());
    expect(debits.toFixed(2)).toBe('1.65');
    expect(credits.toFixed(2)).toBe('1.65');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('keeps base-currency invoices byte-identical after the allocation change', async () => {
    const invoice = await createInvoice(ctx, {
      customerId,
      date: new Date('2026-01-16'),
      taxRateId,
      discount: '50',
      lines: [
        { accountId: acct['4000'], quantity: 2, rate: '100' }, // 200, taxable
        { accountId: acct['4100'], quantity: 1, rate: '300', taxable: false },
      ],
    });
    // subtotal 500, discount 50, tax 10% of 200 = 20, total 470
    expect(invoice.subtotal).toBe('500.00');
    expect(invoice.total).toBe('470.00');

    const lines = await db
      .select()
      .from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, invoice.postedEntryId!));
    const byAcct = new Map(lines.map((l) => [l.accountId, l]));
    expect(byAcct.get(acct['1200'])?.debit).toBe('470.00');
    expect(byAcct.get(acct['4100'])?.credit).toBe('300.00');
    expect(byAcct.get(acct['2200'])?.credit).toBe('20.00');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 3. Credit memo applied to a retainage invoice
  // ---------------------------------------------------------------------------

  it('applying a credit memo equal to the net balance of a retainage invoice settles it', async () => {
    // total 100, retainage 10% → balanceDue 90
    const invoice = await createInvoice(ctx, {
      customerId,
      date: new Date('2026-02-01'),
      retainagePercent: '10',
      lines: [{ accountId: acct['4000'], quantity: 1, rate: '100' }],
    });
    expect(invoice.balanceDue).toBe('90.00');
    expect(invoice.retainageAmount).toBe('10.00');

    const memo = await createCreditMemo(ctx, {
      customerId,
      date: new Date('2026-02-05'),
      lines: [{ quantity: 1, rate: '90', accountId: acct['4000'] }],
    });

    const { invoice: updated } = await applyToInvoice(ctx, {
      creditMemoId: memo.id,
      invoiceId: invoice.id,
      amount: '90.00',
    });

    // Previously: newBalance = 100 - 90 = 10 → status 'partial'. Must be settled.
    expect(updated.balanceDue).toBe('0.00');
    expect(updated.status).toBe('paid');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 4. Customer statements include credit memos
  // ---------------------------------------------------------------------------

  it('customer statement subtracts credit memos in both opening and running balance', async () => {
    // Isolated customer so other tests don't pollute the ledger.
    const [cust] = await db
      .insert(customers)
      .values({ companyId: ctx.companyId, displayName: 'Statement Cust' })
      .returning();

    // Prior period: invoice 500 (Jan 5), credit memo 100 (Jan 10).
    await createInvoice(ctx, {
      customerId: cust.id,
      date: new Date('2026-01-05'),
      lines: [{ accountId: acct['4000'], quantity: 1, rate: '500' }],
    });
    await createCreditMemo(ctx, {
      customerId: cust.id,
      date: new Date('2026-01-10'),
      lines: [{ quantity: 1, rate: '100' }],
    });

    // In-period: invoice 200 (Feb 5), credit memo 50 (Feb 10).
    await createInvoice(ctx, {
      customerId: cust.id,
      date: new Date('2026-02-05'),
      lines: [{ accountId: acct['4000'], quantity: 1, rate: '200' }],
    });
    await createCreditMemo(ctx, {
      customerId: cust.id,
      date: new Date('2026-02-10'),
      lines: [{ quantity: 1, rate: '50' }],
    });

    const stmt = await customerStatement(ctx, cust.id, {
      from: new Date('2026-02-01'),
      to: new Date('2026-02-28'),
    });

    // Opening: 500 - 100 = 400 (was 500 before the fix).
    expect(stmt.openingBalance).toBe('400.00');

    // Lines: invoice 200 then credit memo 50.
    expect(stmt.lines).toHaveLength(2);
    expect(stmt.lines[0].type).toBe('invoice');
    expect(stmt.lines[1].type).toBe('credit_memo');
    expect(stmt.lines[1].amount).toBe('50.00');

    // Closing: 400 + 200 - 50 = 550 (was 700 before the fix).
    expect(stmt.closingBalance).toBe('550.00');
  });

  // ---------------------------------------------------------------------------
  // 5. receivePayment FX handling
  // ---------------------------------------------------------------------------

  it('pays a 100 EUR invoice booked at 1.10 with settlement rate 1.20 — A/R clears, gain posts', async () => {
    const [cust] = await db
      .insert(customers)
      .values({ companyId: ctx.companyId, displayName: 'FX Customer' })
      .returning();

    const arBefore = Money.of(
      (await db.select().from(accounts).where(eq(accounts.id, acct['1200'])))[0].balance,
    );

    const invoice = await createInvoice(ctx, {
      customerId: cust.id,
      date: new Date('2026-03-01'),
      currency: 'EUR',
      exchangeRate: '1.10',
      lines: [{ accountId: acct['4000'], quantity: 1, rate: '100' }],
    });
    expect(invoice.balanceDue).toBe('100.00'); // EUR

    const { payment } = await receivePayment(ctx, {
      customerId: cust.id,
      date: new Date('2026-03-15'),
      method: 'bank_transfer',
      amount: '100.00', // EUR
      currency: 'EUR',
      exchangeRate: '1.20',
      depositAccountId: acct['1000'],
      applications: [{ invoiceId: invoice.id, amountApplied: '100.00' }],
    });

    expect(payment.currency).toBe('EUR');

    // Invoice settled in transaction currency.
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(inv.status).toBe('paid');
    expect(inv.balanceDue).toBe('0.00');

    // A/R nets to exactly zero in base currency: Dr 110 (invoice) / Cr 110 (payment).
    const arAfter = Money.of(
      (await db.select().from(accounts).where(eq(accounts.id, acct['1200'])))[0].balance,
    );
    expect(arAfter.minus(arBefore).toFixed(2)).toBe('0.00');

    // Exchange Gain/Loss (6900) was created and credited 10.00 (gain).
    const [fxAcct] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, '6900')));
    expect(fxAcct).toBeTruthy();
    // Expense account, natural debit: a credit of 10 → balance -10.00.
    expect(Money.of(fxAcct.balance).toFixed(2)).toBe('-10.00');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('posts a realized FX loss when settlement rate is below the booked rate', async () => {
    const [cust] = await db
      .insert(customers)
      .values({ companyId: ctx.companyId, displayName: 'FX Loss Customer' })
      .returning();

    const invoice = await createInvoice(ctx, {
      customerId: cust.id,
      date: new Date('2026-03-02'),
      currency: 'EUR',
      exchangeRate: '1.20',
      lines: [{ accountId: acct['4000'], quantity: 1, rate: '100' }],
    });

    const fxBefore = Money.of(
      (
        await db
          .select()
          .from(accounts)
          .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, '6900')))
      )[0].balance,
    );

    await receivePayment(ctx, {
      customerId: cust.id,
      date: new Date('2026-03-20'),
      method: 'bank_transfer',
      amount: '100.00',
      currency: 'EUR',
      exchangeRate: '1.10',
      depositAccountId: acct['1000'],
      applications: [{ invoiceId: invoice.id, amountApplied: '100.00' }],
    });

    // Loss of 10.00 debited to 6900 (expense, natural debit → +10).
    const fxAfter = Money.of(
      (
        await db
          .select()
          .from(accounts)
          .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, '6900')))
      )[0].balance,
    );
    expect(fxAfter.minus(fxBefore).toFixed(2)).toBe('10.00');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('rejects a payment whose currency does not match the applied invoice', async () => {
    const invoice = await createInvoice(ctx, {
      customerId,
      date: new Date('2026-03-03'),
      currency: 'EUR',
      exchangeRate: '1.10',
      lines: [{ accountId: acct['4000'], quantity: 1, rate: '100' }],
    });

    await expect(
      receivePayment(ctx, {
        customerId,
        date: new Date('2026-03-21'),
        method: 'check',
        amount: '100.00', // base currency — mismatch
        applications: [{ invoiceId: invoice.id, amountApplied: '100.00' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // ---------------------------------------------------------------------------
  // 6. Duplicate applications rejected
  // ---------------------------------------------------------------------------

  it('rejects duplicate invoiceId in a payment\'s applications', async () => {
    const invoice = await createInvoice(ctx, {
      customerId,
      date: new Date('2026-04-01'),
      lines: [{ accountId: acct['4000'], quantity: 1, rate: '100' }],
    });

    await expect(
      receivePayment(ctx, {
        customerId,
        date: new Date('2026-04-02'),
        method: 'check',
        amount: '200.00',
        applications: [
          { invoiceId: invoice.id, amountApplied: '100.00' },
          { invoiceId: invoice.id, amountApplied: '100.00' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // Subledger untouched and GL untouched (still balanced, invoice still open).
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(inv.status).toBe('open');
    expect(inv.amountPaid).toBe('0.00');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 7. Atomic conversions
  // ---------------------------------------------------------------------------

  it('estimate conversion is atomic — a failed invoice leaves the estimate convertible, success closes it once', async () => {
    // Customer with a credit limit that the conversion will blow through.
    const [cust] = await db
      .insert(customers)
      .values({ companyId: ctx.companyId, displayName: 'Limited Cust', creditLimit: '50.00' })
      .returning();

    const estimate = await createEstimate(ctx, {
      customerId: cust.id,
      date: new Date('2026-05-01'),
      lines: [{ description: 'Big job', quantity: 1, rate: '100' }],
    });

    // createInvoice throws (credit limit) — the estimate must remain unconverted.
    await expect(convertEstimate(ctx, estimate.id)).rejects.toMatchObject({ code: 'VALIDATION' });
    const [est1] = await db.select().from(estimates).where(eq(estimates.id, estimate.id));
    expect(est1.status).toBe('draft');
    expect(est1.convertedInvoiceId).toBeNull();
    const orphanInvoices = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.companyId, ctx.companyId), eq(invoices.customerId, cust.id)));
    expect(orphanInvoices).toHaveLength(0);

    // Lift the limit; conversion succeeds and the second attempt conflicts.
    await db.update(customers).set({ creditLimit: null }).where(eq(customers.id, cust.id));
    const invoice = await convertEstimate(ctx, estimate.id);
    expect(invoice.total).toBe('100.00');

    const [est2] = await db.select().from(estimates).where(eq(estimates.id, estimate.id));
    expect(est2.status).toBe('closed');
    expect(est2.convertedInvoiceId).toBe(invoice.id);

    await expect(convertEstimate(ctx, estimate.id)).rejects.toMatchObject({ code: 'CONFLICT' });

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('sales order conversion is atomic — a failed invoice leaves the order open', async () => {
    const [cust] = await db
      .insert(customers)
      .values({ companyId: ctx.companyId, displayName: 'SO Limited Cust', creditLimit: '50.00' })
      .returning();

    const order = await createSalesOrder(ctx, {
      customerId: cust.id,
      date: new Date('2026-05-02'),
      lines: [{ description: 'Bulk order', quantity: 1, rate: '100' }],
    });

    await expect(convertSalesOrder(ctx, order.id)).rejects.toMatchObject({ code: 'VALIDATION' });
    const [so1] = await db.select().from(salesOrders).where(eq(salesOrders.id, order.id));
    expect(so1.status).toBe('open');
    expect(so1.convertedInvoiceId).toBeNull();

    await db.update(customers).set({ creditLimit: null }).where(eq(customers.id, cust.id));
    const invoice = await convertSalesOrder(ctx, order.id);

    const [so2] = await db.select().from(salesOrders).where(eq(salesOrders.id, order.id));
    expect(so2.status).toBe('closed');
    expect(so2.convertedInvoiceId).toBe(invoice.id);

    await expect(convertSalesOrder(ctx, order.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  // ---------------------------------------------------------------------------
  // 8. SQL-side list filters
  // ---------------------------------------------------------------------------

  it('listInvoices filters by customerId and status in SQL', async () => {
    const [otherCust] = await db
      .insert(customers)
      .values({ companyId: ctx.companyId, displayName: 'Filter Cust' })
      .returning();

    const inv = await createInvoice(ctx, {
      customerId: otherCust.id,
      date: new Date('2026-06-01'),
      lines: [{ accountId: acct['4000'], quantity: 1, rate: '42' }],
    });

    const filtered = await listInvoices(ctx, { customerId: otherCust.id, status: 'open' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(inv.id);

    const none = await listInvoices(ctx, { customerId: otherCust.id, status: 'paid' });
    expect(none).toHaveLength(0);

    // Unfiltered still returns everything for the company.
    const all = await listInvoices(ctx);
    expect(all.length).toBeGreaterThan(1);
  });

  it('listCreditMemos filters by customerId and status in SQL', async () => {
    const [otherCust] = await db
      .insert(customers)
      .values({ companyId: ctx.companyId, displayName: 'Memo Filter Cust' })
      .returning();

    const memo = await createCreditMemo(ctx, {
      customerId: otherCust.id,
      date: new Date('2026-06-02'),
      lines: [{ quantity: 1, rate: '13' }],
    });

    const filtered = await listCreditMemos(ctx, { customerId: otherCust.id, status: 'open' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(memo.id);

    const none = await listCreditMemos(ctx, { customerId: otherCust.id, status: 'paid' });
    expect(none).toHaveLength(0);
  });
});
