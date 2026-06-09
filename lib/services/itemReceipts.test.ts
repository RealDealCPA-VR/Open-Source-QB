/**
 * Integration tests for the Item Receipts service (QB "Receive Items").
 *
 * Uses a throwaway PGlite directory so tests are fully isolated from dev data.
 * Verifies:
 *  - createItemReceipt posts Dr Inventory (or expense) / Cr 2050 accrual
 *    (find-or-create), receives stock (avg-cost update or FIFO layer), and the
 *    trial balance stays balanced.
 *  - PO-linked receipts claim purchaseOrderLines.quantityBilled (partial ->
 *    closed), reject over-receipts / wrong vendors / items not on the PO, and
 *    block later double-billing from the PO.
 *  - convertToBill creates a real A/P bill (Dr 2050 / Cr 2000), leaves
 *    inventory untouched, stamps convertedBillId, and is conflict-guarded.
 *  - voidItemReceipt reverses GL + stock, releases PO quantities, and is
 *    blocked when billed or when the received stock was consumed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { getDb, closeDb, type DB } from '@/lib/db';
import {
  users,
  companies,
  accounts,
  vendors,
  items,
  inventoryLayers,
  journalEntries,
  purchaseOrderLines,
} from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { trialBalance } from './reports';
import { createPurchaseOrder, getPurchaseOrder, convertToBill as convertPoToBill } from './purchaseOrders';
import { getBill } from './bills';
import {
  createItemReceipt,
  listItemReceipts,
  getItemReceipt,
  convertToBill as convertReceiptToBill,
  voidItemReceipt,
  ITEM_RECEIPT_ACCRUAL_CODE,
} from './itemReceipts';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-item-receipts-p1');
let ctx: ServiceContext;
let db: DB;

/** account code -> id */
const acct: Record<string, string> = {};
let vendorId: string;
let otherVendorId: string;
let widgetId: string; // inventory, average-cost
let gadgetId: string; // inventory, FIFO-tracked
let svcId: string; // service item with an expense account
let svcNoExpId: string; // service item with NO expense account

async function balanceOf(code: string): Promise<number> {
  const [row] = await db
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, code)));
  return row ? Number(row.balance) : 0;
}

async function itemRow(id: string) {
  const [row] = await db.select().from(items).where(eq(items.id, id));
  return row;
}

describe('Item Receipts service', () => {
  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'ir-owner@test.local', name: 'IR Owner', passwordHash: 'x' })
      .returning();

    const [company] = await db
      .insert(companies)
      .values({ name: 'IR Test Co', ownerId: user.id })
      .returning();

    ctx = { db, companyId: company.id, userId: user.id };

    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['1300', 'Inventory Asset', 'asset', 'inventory'],
      ['2000', 'Accounts Payable', 'liability', 'accounts_payable'],
      ['5000', 'Cost of Goods Sold', 'expense', 'cost_of_goods_sold'],
      ['6300', 'Office Supplies', 'expense', 'operating_expenses'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }

    const [vendor] = await db
      .insert(vendors)
      .values({ companyId: company.id, displayName: 'Receiving Supplier LLC' })
      .returning();
    vendorId = vendor.id;
    const [other] = await db
      .insert(vendors)
      .values({ companyId: company.id, displayName: 'Other Vendor Inc' })
      .returning();
    otherVendorId = other.id;

    const [widget] = await db
      .insert(items)
      .values({
        companyId: company.id,
        name: 'Widget',
        type: 'inventory',
        assetAccountId: acct['1300'],
        expenseAccountId: acct['5000'],
        quantityOnHand: '0',
        averageCost: '0',
      })
      .returning();
    widgetId = widget.id;

    const [gadget] = await db
      .insert(items)
      .values({
        companyId: company.id,
        name: 'Gadget',
        type: 'inventory',
        assetAccountId: acct['1300'],
        expenseAccountId: acct['5000'],
        quantityOnHand: '0',
        averageCost: '0',
      })
      .returning();
    gadgetId = gadget.id;
    // Mark the gadget FIFO-tracked (any layer row, even fully consumed).
    await db.insert(inventoryLayers).values({
      companyId: company.id,
      itemId: gadgetId,
      date: new Date('2025-01-01'),
      quantityRemaining: '0.0000',
      unitCost: '1.0000',
    });

    const [svc] = await db
      .insert(items)
      .values({
        companyId: company.id,
        name: 'Inbound Freight',
        type: 'service',
        expenseAccountId: acct['6300'],
      })
      .returning();
    svcId = svc.id;

    const [svcNoExp] = await db
      .insert(items)
      .values({ companyId: company.id, name: 'Mystery Service', type: 'service' })
      .returning();
    svcNoExpId = svcNoExp.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Validation guards
  // -------------------------------------------------------------------------

  it('rejects a receipt with no lines', async () => {
    await expect(
      createItemReceipt(ctx, { vendorId, date: new Date('2025-04-01'), lines: [] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects zero quantity and negative unit cost', async () => {
    await expect(
      createItemReceipt(ctx, {
        vendorId,
        date: new Date('2025-04-01'),
        lines: [{ itemId: widgetId, quantity: 0, unitCost: 5 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createItemReceipt(ctx, {
        vendorId,
        date: new Date('2025-04-01'),
        lines: [{ itemId: widgetId, quantity: 1, unitCost: -5 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects an unknown vendor and an unknown item', async () => {
    await expect(
      createItemReceipt(ctx, {
        vendorId: '00000000-0000-0000-0000-000000000000',
        date: new Date('2025-04-01'),
        lines: [{ itemId: widgetId, quantity: 1, unitCost: 5 }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      createItemReceipt(ctx, {
        vendorId,
        date: new Date('2025-04-01'),
        lines: [{ itemId: '00000000-0000-0000-0000-000000000000', quantity: 1, unitCost: 5 }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects a non-inventory item with no expense account', async () => {
    await expect(
      createItemReceipt(ctx, {
        vendorId,
        date: new Date('2025-04-01'),
        lines: [{ itemId: svcNoExpId, quantity: 1, unitCost: 5 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // -------------------------------------------------------------------------
  // createItemReceipt — average-cost stock + GL
  // -------------------------------------------------------------------------

  let firstReceiptId: string;

  it('receives average-cost stock and posts Dr Inventory / Cr 2050 accrual', async () => {
    const invBefore = await balanceOf('1300');
    const accrualBefore = await balanceOf(ITEM_RECEIPT_ACCRUAL_CODE);

    const receipt = await createItemReceipt(ctx, {
      vendorId,
      date: new Date('2025-04-10'),
      reference: 'PS-100',
      lines: [{ itemId: widgetId, quantity: 10, unitCost: 4 }],
    });
    firstReceiptId = receipt.id;

    expect(receipt.status).toBe('open');
    expect(receipt.total).toBe('40.00');
    expect(receipt.postedEntryId).toBeTruthy();
    expect(receipt.lines).toHaveLength(1);
    expect(receipt.lines[0].amount).toBe('40.00');

    // Stock received: qty 10 @ avg 4.
    const widget = await itemRow(widgetId);
    expect(Number(widget.quantityOnHand)).toBe(10);
    expect(Number(widget.averageCost)).toBe(4);

    // GL: inventory up 40, accrual (auto-created) up 40, A/P untouched.
    expect((await balanceOf('1300')) - invBefore).toBe(40);
    expect((await balanceOf(ITEM_RECEIPT_ACCRUAL_CODE)) - accrualBefore).toBe(40);
    const [accrual] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, ITEM_RECEIPT_ACCRUAL_CODE)));
    expect(accrual.type).toBe('liability');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('receives FIFO-tracked stock as a new cost layer (no avg-cost update)', async () => {
    const receipt = await createItemReceipt(ctx, {
      vendorId,
      date: new Date('2025-04-11'),
      lines: [{ itemId: gadgetId, quantity: 5, unitCost: 7 }],
    });
    expect(receipt.total).toBe('35.00');

    const gadget = await itemRow(gadgetId);
    expect(Number(gadget.quantityOnHand)).toBe(5);

    const layers = await db
      .select()
      .from(inventoryLayers)
      .where(and(eq(inventoryLayers.companyId, ctx.companyId), eq(inventoryLayers.itemId, gadgetId)));
    const live = layers.filter((l) => Number(l.quantityRemaining) > 0);
    expect(live).toHaveLength(1);
    expect(Number(live[0].quantityRemaining)).toBe(5);
    expect(Number(live[0].unitCost)).toBe(7);

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('routes non-inventory item lines to the item expense account', async () => {
    const expBefore = await balanceOf('6300');
    await createItemReceipt(ctx, {
      vendorId,
      date: new Date('2025-04-12'),
      lines: [{ itemId: svcId, quantity: 2, unitCost: 10 }],
    });
    expect((await balanceOf('6300')) - expBefore).toBe(20);
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('list and get return receipts with lines', async () => {
    const all = await listItemReceipts(ctx);
    expect(all.length).toBeGreaterThanOrEqual(3);
    const open = await listItemReceipts(ctx, { status: 'open' });
    expect(open.every((r) => r.status === 'open')).toBe(true);

    const detail = await getItemReceipt(ctx, firstReceiptId);
    expect(detail.reference).toBe('PS-100');
    expect(detail.lines).toHaveLength(1);
    expect(Number(detail.lines[0].quantity)).toBe(10);
  });

  // -------------------------------------------------------------------------
  // PO-linked receipts
  // -------------------------------------------------------------------------

  it('claims PO quantities (partial -> closed), rejects over-receipt and wrong vendor', async () => {
    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-05-01'),
      lines: [{ itemId: widgetId, quantity: 10, rate: 4 }],
    });

    // Wrong vendor.
    await expect(
      createItemReceipt(ctx, {
        vendorId: otherVendorId,
        date: new Date('2025-05-02'),
        purchaseOrderId: po.id,
        lines: [{ itemId: widgetId, quantity: 1, unitCost: 4 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // Item not on the PO.
    await expect(
      createItemReceipt(ctx, {
        vendorId,
        date: new Date('2025-05-02'),
        purchaseOrderId: po.id,
        lines: [{ itemId: gadgetId, quantity: 1, unitCost: 7 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // Partial receipt: 4 of 10.
    await createItemReceipt(ctx, {
      vendorId,
      date: new Date('2025-05-03'),
      purchaseOrderId: po.id,
      lines: [{ itemId: widgetId, quantity: 4, unitCost: 4 }],
    });
    let detail = await getPurchaseOrder(ctx, po.id);
    expect(detail.status).toBe('partial');
    expect(Number(detail.lines[0].quantityBilled)).toBe(4);

    // Over-receipt: only 6 remain.
    await expect(
      createItemReceipt(ctx, {
        vendorId,
        date: new Date('2025-05-04'),
        purchaseOrderId: po.id,
        lines: [{ itemId: widgetId, quantity: 7, unitCost: 4 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // Receive the remaining 6 — PO closes.
    await createItemReceipt(ctx, {
      vendorId,
      date: new Date('2025-05-05'),
      purchaseOrderId: po.id,
      lines: [{ itemId: widgetId, quantity: 6, unitCost: 4 }],
    });
    detail = await getPurchaseOrder(ctx, po.id);
    expect(detail.status).toBe('closed');
    expect(Number(detail.lines[0].quantityBilled)).toBe(10);

    // The PO can no longer be billed (received quantities are locked).
    await expect(convertPoToBill(ctx, po.id)).rejects.toMatchObject({ code: 'CONFLICT' });

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  // -------------------------------------------------------------------------
  // convertToBill
  // -------------------------------------------------------------------------

  it('converts a receipt to a bill: Dr 2050 / Cr 2000, inventory untouched', async () => {
    const accrualBefore = await balanceOf(ITEM_RECEIPT_ACCRUAL_CODE);
    const apBefore = await balanceOf('2000');
    const invBefore = await balanceOf('1300');
    const widgetBefore = await itemRow(widgetId);

    const bill = await convertReceiptToBill(ctx, firstReceiptId, {
      billNumber: 'VB-555',
      date: new Date('2025-04-20'),
    });
    expect(bill.total).toBe('40.00');
    expect(bill.billNumber).toBe('VB-555');
    expect(bill.status).toBe('open');

    // Accrual relieved, A/P booked, inventory GL + stock untouched.
    expect((await balanceOf(ITEM_RECEIPT_ACCRUAL_CODE)) - accrualBefore).toBe(-40);
    expect((await balanceOf('2000')) - apBefore).toBe(40);
    expect((await balanceOf('1300')) - invBefore).toBe(0);
    const widgetAfter = await itemRow(widgetId);
    expect(widgetAfter.quantityOnHand).toBe(widgetBefore.quantityOnHand);
    expect(widgetAfter.averageCost).toBe(widgetBefore.averageCost);

    // Receipt stamped billed + convertedBillId; bill lines carry NO itemId
    // (so voiding the bill later can never double-reverse stock).
    const receipt = await getItemReceipt(ctx, firstReceiptId);
    expect(receipt.status).toBe('billed');
    expect(receipt.convertedBillId).toBe(bill.id);
    const billDetail = await getBill(ctx, bill.id);
    expect(billDetail.lines.every((l) => l.itemId === null)).toBe(true);

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);

    // Double-convert and void-after-bill are blocked.
    await expect(convertReceiptToBill(ctx, firstReceiptId)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(voidItemReceipt(ctx, firstReceiptId)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  // -------------------------------------------------------------------------
  // voidItemReceipt
  // -------------------------------------------------------------------------

  it('voids an open receipt: GL + stock reversed, PO quantities released', async () => {
    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-06-01'),
      lines: [{ itemId: gadgetId, quantity: 8, rate: 9 }],
    });

    const gadgetBefore = await itemRow(gadgetId);
    const invBefore = await balanceOf('1300');
    const accrualBefore = await balanceOf(ITEM_RECEIPT_ACCRUAL_CODE);

    const receipt = await createItemReceipt(ctx, {
      vendorId,
      date: new Date('2025-06-02'),
      purchaseOrderId: po.id,
      lines: [{ itemId: gadgetId, quantity: 8, unitCost: 9 }],
    });
    expect((await getPurchaseOrder(ctx, po.id)).status).toBe('closed');

    const voided = await voidItemReceipt(ctx, receipt.id);
    expect(voided.status).toBe('void');
    expect(voided.voidedAt).toBeTruthy();

    // GL and stock back to where they started.
    expect(await balanceOf('1300')).toBe(invBefore);
    expect(await balanceOf(ITEM_RECEIPT_ACCRUAL_CODE)).toBe(accrualBefore);
    const gadgetAfter = await itemRow(gadgetId);
    expect(gadgetAfter.quantityOnHand).toBe(gadgetBefore.quantityOnHand);

    // The journal entry is void.
    const [entry] = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, receipt.postedEntryId!));
    expect(entry.status).toBe('void');

    // PO quantities released — PO reopens.
    const poAfter = await getPurchaseOrder(ctx, po.id);
    expect(poAfter.status).toBe('open');
    const [poLine] = await db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, po.id));
    expect(Number(poLine.quantityBilled)).toBe(0);

    // Voiding again is idempotent.
    const again = await voidItemReceipt(ctx, receipt.id);
    expect(again.status).toBe('void');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('blocks void when the received stock has been consumed', async () => {
    const receipt = await createItemReceipt(ctx, {
      vendorId,
      date: new Date('2025-06-10'),
      lines: [{ itemId: widgetId, quantity: 2, unitCost: 5 }],
    });

    // Simulate consumption: drop on-hand below the received quantity.
    await db
      .update(items)
      .set({ quantityOnHand: '1.0000' })
      .where(eq(items.id, widgetId));

    await expect(voidItemReceipt(ctx, receipt.id)).rejects.toMatchObject({ code: 'CONFLICT' });

    const detail = await getItemReceipt(ctx, receipt.id);
    expect(detail.status).toBe('open'); // nothing flipped
  });
});
