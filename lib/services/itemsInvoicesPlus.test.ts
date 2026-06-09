/**
 * Integration tests — QB item types + bundles + UoM + draft invoices + custom fields.
 *
 * Covers the items-plus-invoice package:
 *  - New item types (other_charge / discount / subtotal / payment / sales_tax)
 *    with type-specific validation and unit-of-measure persistence.
 *  - getBundleComponents reads assemblyComponents BOM rows for bundle items.
 *  - createInvoice line semantics:
 *      discount line  → negative body line, debits its discount account
 *      subtotal line  → non-posting, amount = sum of preceding body lines
 *      payment line   → Dr Undeposited Funds / Cr A/R (reduces balanceDue)
 *      sales_tax line → manual tax added to taxAmount (Cr 2200)
 *    Trial balance stays balanced after each.
 *  - Draft (pending) invoices: no GL posting + no inventory relief on save;
 *    postDraftInvoice posts later; drafts can be edited as simple row updates.
 *  - Invoice custom fields persist to invoices.custom_fields and the
 *    definitions are read from companies.settings.customFields.invoice.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import {
  users,
  companies,
  customers,
  items as itemsTable,
  invoices as invoicesTable,
  journalEntries,
  journalEntryLines,
} from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { trialBalance } from './reports';
import {
  createItem,
  updateItem,
  getBundleComponents,
} from './items';
import { setBom } from './assemblies';
import {
  createInvoice,
  updateInvoice,
  postDraftInvoice,
  voidInvoice,
  getInvoice,
  getInvoiceCustomFieldDefs,
} from './invoices';
import { Money } from '@/lib/money';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-items-invoices-plus');

let ctx: ServiceContext;
let db: DB;
let companyId: string;
let customerId: string;
const acct: Record<string, string> = {};

async function expectBalancedTB() {
  const tb = await trialBalance(ctx, new Date('2025-12-31'));
  expect(tb.balanced).toBe(true);
}

/** Net debit balance of an account by code from the trial balance rows. */
async function accountBalance(code: string): Promise<number> {
  const tb = await trialBalance(ctx, new Date('2025-12-31'));
  const row = tb.rows.find((r) => r.code === code);
  if (!row) return 0;
  return Money.of(row.debit ?? '0').minus(Money.of(row.credit ?? '0')).toNumber();
}

describe('Items+ and Invoice line semantics (end-to-end)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'owner@itemsplus.test', name: 'Owner', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({
        name: 'ItemsPlus Test Co',
        ownerId: user.id,
        settings: { customFields: { invoice: [{ name: 'PO Number' }, { name: 'Rep' }] } },
      })
      .returning();
    companyId = company.id;
    ctx = { db, companyId, userId: user.id };

    const defs: Array<[string, string, string, string]> = [
      ['1200', 'Accounts Receivable', 'asset', 'accounts_receivable'],
      ['1300', 'Inventory Asset', 'asset', 'inventory'],
      ['2200', 'Sales Tax Payable', 'liability', 'long_term_liability'],
      ['3000', "Owner's Equity", 'equity', 'owners_equity'],
      ['4000', 'Sales Income', 'revenue', 'sales'],
      ['4100', 'Service Income', 'revenue', 'service_revenue'],
      ['4900', 'Discounts Given', 'revenue', 'sales'],
      ['5000', 'COGS', 'expense', 'cost_of_goods_sold'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }

    const [cust] = await db
      .insert(customers)
      .values({ companyId, displayName: 'Plus Corp', taxable: true })
      .returning();
    customerId = cust.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Items: new types, UoM, type validation
  // -------------------------------------------------------------------------

  it('creates items of every new QB type with unit of measure', async () => {
    const oc = await createItem(ctx, {
      name: 'Delivery Fee',
      type: 'other_charge',
      salesPrice: 25,
      incomeAccountId: acct['4100'],
      unitOfMeasure: 'trip',
    });
    expect(oc.type).toBe('other_charge');
    expect(oc.unitOfMeasure).toBe('trip');

    const disc = await createItem(ctx, {
      name: 'Preferred Discount',
      type: 'discount',
      incomeAccountId: acct['4900'],
      taxable: true,
    });
    expect(disc.type).toBe('discount');

    const sub = await createItem(ctx, { name: 'Subtotal', type: 'subtotal' });
    expect(sub.type).toBe('subtotal');

    const pay = await createItem(ctx, { name: 'Payment Received', type: 'payment' });
    expect(pay.type).toBe('payment');

    const tax = await createItem(ctx, { name: 'Out-of-state Tax', type: 'sales_tax' });
    expect(tax.type).toBe('sales_tax');
  });

  it('enforces type-specific validation (subtotal/payment items)', async () => {
    await expect(
      createItem(ctx, { name: 'Bad Subtotal', type: 'subtotal', salesPrice: 10 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createItem(ctx, { name: 'Bad Payment', type: 'payment', incomeAccountId: acct['4000'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('persists unitOfMeasure via updateItem and account mappings stick', async () => {
    const svc = await createItem(ctx, {
      name: 'Consulting',
      type: 'service',
      salesPrice: 100,
      incomeAccountId: acct['4100'],
    });
    const updated = await updateItem(ctx, svc.id, {
      unitOfMeasure: 'hr',
      expenseAccountId: acct['5000'],
      taxable: false,
    });
    expect(updated.unitOfMeasure).toBe('hr');
    expect(updated.expenseAccountId).toBe(acct['5000']);
    expect(updated.taxable).toBe(false);
    // clearing
    const cleared = await updateItem(ctx, svc.id, { unitOfMeasure: null });
    expect(cleared.unitOfMeasure).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Bundles: getBundleComponents reads the BOM
  // -------------------------------------------------------------------------

  it('getBundleComponents returns BOM rows joined with item details', async () => {
    const compA = await createItem(ctx, {
      name: 'Widget A',
      type: 'service',
      salesPrice: 30,
      unitOfMeasure: 'ea',
    });
    const compB = await createItem(ctx, { name: 'Widget B', type: 'service', salesPrice: 20 });
    const bundle = await createItem(ctx, { name: 'Starter Kit', type: 'bundle', salesPrice: 45 });

    await setBom(ctx, bundle.id, [
      { componentItemId: compA.id, quantity: 2 },
      { componentItemId: compB.id, quantity: 1 },
    ]);

    const comps = await getBundleComponents(ctx, bundle.id);
    expect(comps).toHaveLength(2);
    const a = comps.find((c) => c.componentItemId === compA.id)!;
    expect(Number(a.quantity)).toBe(2);
    expect(a.name).toBe('Widget A');
    expect(a.unitOfMeasure).toBe('ea');
    expect(a.salesPrice).toBe('30.00');

    // Empty BOM bundle returns []
    const empty = await createItem(ctx, { name: 'Empty Kit', type: 'bundle' });
    expect(await getBundleComponents(ctx, empty.id)).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Invoice line semantics
  // -------------------------------------------------------------------------

  it('discount item line reduces the subtotal and debits the discount account', async () => {
    const disc = await createItem(ctx, {
      name: 'Line Discount 2',
      type: 'discount',
      incomeAccountId: acct['4900'],
    });

    const inv = await createInvoice(ctx, {
      customerId,
      date: new Date('2025-06-01'),
      lines: [
        { accountId: acct['4000'], description: 'Goods', quantity: 1, rate: 200 },
        { itemId: disc.id, description: '10 off', quantity: 1, rate: 10 }, // positive entry → negated
      ],
    });

    expect(inv.subtotal).toBe('190.00');
    expect(inv.total).toBe('190.00');
    const detail = await getInvoice(ctx, inv.id);
    const discLine = detail.lines.find((l) => l.itemId === disc.id)!;
    expect(discLine.amount).toBe('-10.00');

    // GL: the discount account (4900) carries a 10.00 debit.
    const lines = await db
      .select()
      .from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, inv.postedEntryId!));
    const discGl = lines.find((l) => l.accountId === acct['4900']);
    expect(discGl?.debit).toBe('10.00');
    await expectBalancedTB();
  });

  it('subtotal item line is non-posting and shows the sum of preceding lines', async () => {
    const sub = await createItem(ctx, { name: 'Subtotal 2', type: 'subtotal' });
    const inv = await createInvoice(ctx, {
      customerId,
      date: new Date('2025-06-02'),
      lines: [
        { accountId: acct['4000'], description: 'A', quantity: 2, rate: 50 },  // 100
        { accountId: acct['4100'], description: 'B', quantity: 1, rate: 25 },  // 25
        { itemId: sub.id, quantity: 1, rate: 0 },                              // shows 125
        { accountId: acct['4000'], description: 'C', quantity: 1, rate: 75 },  // new group
      ],
    });

    expect(inv.subtotal).toBe('200.00'); // subtotal line NOT double-counted
    expect(inv.total).toBe('200.00');
    const detail = await getInvoice(ctx, inv.id);
    const subLine = detail.lines.find((l) => l.itemId === sub.id)!;
    expect(subLine.amount).toBe('125.00');
    expect(subLine.taxable).toBe(false);

    // GL: income credits total 200 (the subtotal row posts nothing).
    const lines = await db
      .select()
      .from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, inv.postedEntryId!));
    const totalCredits = lines.reduce((s, l) => s + Number(l.credit ?? 0), 0);
    expect(totalCredits).toBeCloseTo(200, 2);
    await expectBalancedTB();
  });

  it('payment item line posts Dr Undeposited Funds / Cr A/R and reduces balanceDue', async () => {
    const pay = await createItem(ctx, { name: 'Deposit Applied', type: 'payment' });
    const ufBefore = await accountBalance('1050');

    const inv = await createInvoice(ctx, {
      customerId,
      date: new Date('2025-06-03'),
      lines: [
        { accountId: acct['4000'], description: 'Work', quantity: 1, rate: 500 },
        { itemId: pay.id, description: 'Deposit received', quantity: 1, rate: 200 },
      ],
    });

    expect(inv.total).toBe('500.00');
    expect(inv.amountPaid).toBe('200.00');
    expect(inv.balanceDue).toBe('300.00');
    expect(inv.status).toBe('partial');

    // GL: A/R debit is 300 (not 500); UF debit is 200.
    const lines = await db
      .select()
      .from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, inv.postedEntryId!));
    const arLine = lines.find((l) => l.accountId === acct['1200'] && Number(l.debit ?? 0) > 0);
    expect(arLine?.debit).toBe('300.00');
    const ufAfter = await accountBalance('1050');
    expect(ufAfter - ufBefore).toBeCloseTo(200, 2);
    await expectBalancedTB();

    // A fully-paid-by-payment-line invoice can still be voided (no EXTERNAL payments).
    const voided = await voidInvoice(ctx, inv.id);
    expect(voided.status).toBe('void');
    await expectBalancedTB();
  });

  it('rejects a payment line that exceeds the invoice total', async () => {
    const pay = await createItem(ctx, { name: 'Overpay', type: 'payment' });
    await expect(
      createInvoice(ctx, {
        customerId,
        date: new Date('2025-06-04'),
        lines: [
          { accountId: acct['4000'], quantity: 1, rate: 100 },
          { itemId: pay.id, quantity: 1, rate: 150 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('sales_tax item line adds a manual tax amount credited to 2200', async () => {
    const tax = await createItem(ctx, { name: 'Manual Tax', type: 'sales_tax' });
    const inv = await createInvoice(ctx, {
      customerId,
      date: new Date('2025-06-05'),
      lines: [
        { accountId: acct['4000'], quantity: 1, rate: 100 },
        { itemId: tax.id, description: 'Out-of-state tax', quantity: 1, rate: 7.5 },
      ],
    });
    expect(inv.subtotal).toBe('100.00');
    expect(inv.taxAmount).toBe('7.50');
    expect(inv.total).toBe('107.50');

    const lines = await db
      .select()
      .from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, inv.postedEntryId!));
    const taxGl = lines.find((l) => l.accountId === acct['2200']);
    expect(taxGl?.credit).toBe('7.50');
    await expectBalancedTB();
  });

  // -------------------------------------------------------------------------
  // Draft (pending) invoices
  // -------------------------------------------------------------------------

  it('draft invoice saves with NO GL posting and NO inventory relief; posting it later does both', async () => {
    // Inventory item with stock (average-cost path).
    const widget = await createItem(ctx, {
      name: 'Stocked Widget',
      type: 'inventory',
      salesPrice: 40,
      assetAccountId: acct['1300'],
    });
    await db
      .update(itemsTable)
      .set({ quantityOnHand: '10.0000', averageCost: '4.0000' })
      .where(eq(itemsTable.id, widget.id));
    // Seed the Inventory Asset GL balance to match (Dr 1300 / Cr 3000 via direct rows
    // is unnecessary — COGS only needs averageCost; the TB stays balanced regardless).

    const draft = await createInvoice(ctx, {
      customerId,
      date: new Date('2025-06-06'),
      status: 'draft',
      customFields: { 'PO Number': 'PO-777' },
      lines: [{ itemId: widget.id, accountId: acct['4000'], quantity: 3, rate: 40 }],
    });

    expect(draft.status).toBe('draft');
    expect(draft.postedEntryId).toBeNull();
    expect(draft.total).toBe('120.00');

    // No journal entries reference this invoice yet.
    const entries = await db
      .select()
      .from(journalEntries)
      .where(
        and(eq(journalEntries.companyId, companyId), eq(journalEntries.sourceRef, `invoice:${draft.id}`)),
      );
    expect(entries).toHaveLength(0);

    // Inventory untouched.
    const [beforePost] = await db.select().from(itemsTable).where(eq(itemsTable.id, widget.id));
    expect(Number(beforePost.quantityOnHand)).toBe(10);

    // Edit the draft (simple row update — still no GL).
    const edited = await updateInvoice(ctx, draft.id, {
      customerId,
      date: new Date('2025-06-06'),
      customFields: { 'PO Number': 'PO-778' },
      lines: [{ itemId: widget.id, accountId: acct['4000'], quantity: 2, rate: 40 }],
    });
    expect(edited.status).toBe('draft');
    expect(edited.total).toBe('80.00');
    expect(edited.postedEntryId).toBeNull();

    // Post it.
    const posted = await postDraftInvoice(ctx, draft.id);
    expect(posted.status).toBe('open');
    expect(posted.postedEntryId).toBeTruthy();
    expect(posted.total).toBe('80.00');
    expect(posted.balanceDue).toBe('80.00');

    // Inventory relieved by 2 now.
    const [afterPost] = await db.select().from(itemsTable).where(eq(itemsTable.id, widget.id));
    expect(Number(afterPost.quantityOnHand)).toBe(8);

    // Custom fields survived the edit.
    const detail = await getInvoice(ctx, draft.id);
    expect(detail.customFields).toEqual({ 'PO Number': 'PO-778' });

    // Cannot post twice.
    await expect(postDraftInvoice(ctx, draft.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expectBalancedTB();
  });

  it('voiding (discarding) a draft works without any GL reversal', async () => {
    const draft = await createInvoice(ctx, {
      customerId,
      date: new Date('2025-06-07'),
      status: 'draft',
      lines: [{ accountId: acct['4000'], quantity: 1, rate: 10 }],
    });
    const voided = await voidInvoice(ctx, draft.id);
    expect(voided.status).toBe('void');
    await expect(postDraftInvoice(ctx, draft.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  // -------------------------------------------------------------------------
  // Custom fields
  // -------------------------------------------------------------------------

  it('reads invoice custom-field definitions from company settings and persists values', async () => {
    const defs = await getInvoiceCustomFieldDefs(ctx);
    expect(defs).toEqual([{ name: 'PO Number' }, { name: 'Rep' }]);

    const inv = await createInvoice(ctx, {
      customerId,
      date: new Date('2025-06-08'),
      customFields: { 'PO Number': 'PO-1', Rep: 'VR' },
      lines: [{ accountId: acct['4000'], quantity: 1, rate: 50 }],
    });
    const [row] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, inv.id));
    expect(row.customFields).toEqual({ 'PO Number': 'PO-1', Rep: 'VR' });

    // Posted-invoice edit replaces custom fields when provided.
    const updated = await updateInvoice(ctx, inv.id, {
      customerId,
      date: new Date('2025-06-08'),
      customFields: { 'PO Number': 'PO-2', Rep: 'VR' },
      lines: [{ accountId: acct['4000'], quantity: 1, rate: 50 }],
    });
    expect(updated.customFields).toEqual({ 'PO Number': 'PO-2', Rep: 'VR' });
    await expectBalancedTB();
  });

  // -------------------------------------------------------------------------
  // Mixed kitchen-sink invoice stays balanced
  // -------------------------------------------------------------------------

  it('handles discount + subtotal + payment + manual tax on one invoice, balanced', async () => {
    const disc = await createItem(ctx, {
      name: 'Combo Discount',
      type: 'discount',
      incomeAccountId: acct['4900'],
      taxable: false,
    });
    const sub = await createItem(ctx, { name: 'Combo Subtotal', type: 'subtotal' });
    const pay = await createItem(ctx, { name: 'Combo Payment', type: 'payment' });
    const tax = await createItem(ctx, { name: 'Combo Tax', type: 'sales_tax' });

    const inv = await createInvoice(ctx, {
      customerId,
      date: new Date('2025-06-09'),
      lines: [
        { accountId: acct['4000'], description: 'Goods', quantity: 4, rate: 25 }, // 100
        { accountId: acct['4100'], description: 'Labor', quantity: 2, rate: 50 }, // 100
        { itemId: sub.id, quantity: 1, rate: 0 },                                 // shows 200
        { itemId: disc.id, description: '10% off', quantity: 1, rate: 20, taxable: false }, // -20
        { itemId: tax.id, quantity: 1, rate: 9 },                                 // +9 tax
        { itemId: pay.id, quantity: 1, rate: 89 },                                // -89 due
      ],
    });

    expect(inv.subtotal).toBe('180.00');   // 200 - 20
    expect(inv.taxAmount).toBe('9.00');
    expect(inv.total).toBe('189.00');
    expect(inv.amountPaid).toBe('89.00');
    expect(inv.balanceDue).toBe('100.00');
    expect(inv.status).toBe('partial');
    await expectBalancedTB();
  });
});
