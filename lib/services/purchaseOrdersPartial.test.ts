/**
 * Integration tests for partial PO billing + item passthrough.
 *
 * Uses a throwaway PGlite directory so tests are fully isolated from dev data.
 * Verifies:
 *  - createPurchaseOrder accepts item-only lines (no accountId) and rejects
 *    lines with neither an item nor an account.
 *  - convertToBill passes itemId/quantity/unitCost through to the bill so
 *    inventory items receive stock (perpetual inventory) — billLines carry the
 *    itemId and quantityOnHand/averageCost move.
 *  - Partial billing: per-line quantities, quantityBilled tracking, PO status
 *    open → partial → closed, multiple bills per PO.
 *  - Over-billing is rejected; billing a fully billed PO throws CONFLICT.
 *  - updateStatus guards for partially billed POs (no reopen / no void).
 *  - Trial balance stays balanced after every mutation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { eq, asc } from 'drizzle-orm';
import { getDb, closeDb, type DB } from '@/lib/db';
import {
  users,
  companies,
  accounts,
  vendors,
  items,
  billLines,
  purchaseOrderLines,
} from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { trialBalance } from './reports';
import {
  createPurchaseOrder,
  getPurchaseOrder,
  updateStatus,
  convertToBill,
} from './purchaseOrders';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-po-partial');
let ctx: ServiceContext;
let db: DB;

/** account code → id */
const acct: Record<string, string> = {};
let vendorId: string;
let widgetId: string; // inventory item (average-cost)

async function poLines(poId: string) {
  return db
    .select()
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, poId))
    .orderBy(asc(purchaseOrderLines.lineOrder));
}

async function itemRow(id: string) {
  const [row] = await db.select().from(items).where(eq(items.id, id));
  return row;
}

describe('Purchase Orders — partial billing + item passthrough', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'po-partial@test.local', name: 'PO Partial', passwordHash: 'x' })
      .returning();

    const [company] = await db
      .insert(companies)
      .values({ name: 'PO Partial Test Co', ownerId: user.id })
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
      .values({ companyId: company.id, displayName: 'Partial Parts Supply' })
      .returning();
    vendorId = vendor.id;

    // Inventory item (average-cost — no FIFO layers seeded).
    const [widget] = await db
      .insert(items)
      .values({
        companyId: company.id,
        name: 'Widget',
        type: 'inventory',
        assetAccountId: acct['1300'],
        quantityOnHand: '0',
        averageCost: '0',
      })
      .returning();
    widgetId = widget.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // createPurchaseOrder — item lines
  // -------------------------------------------------------------------------

  it('accepts an item-only line (no accountId) and rejects a line with neither', async () => {
    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-06-01'),
      lines: [{ itemId: widgetId, quantity: 2, rate: '3.00' }],
    });
    expect(po.total).toBe('6.00');
    expect(po.lines[0].itemId).toBe(widgetId);
    expect(po.lines[0].accountId).toBeNull();

    await expect(
      createPurchaseOrder(ctx, {
        vendorId,
        date: new Date('2025-06-01'),
        lines: [{ quantity: 1, rate: 5 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // -------------------------------------------------------------------------
  // Full convert — item passthrough into perpetual inventory
  // -------------------------------------------------------------------------

  it('full convert passes itemId through to the bill and receives stock', async () => {
    const qohBefore = Number((await itemRow(widgetId)).quantityOnHand ?? 0);

    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-06-02'),
      lines: [
        { itemId: widgetId, description: 'Widgets', quantity: 10, rate: '5.00' },
        { accountId: acct['6300'], description: 'Boxes', quantity: 1, rate: '20.00' },
      ],
    });

    const bill = await convertToBill(ctx, po.id);
    expect(bill.total).toBe('70.00'); // 10*5 + 1*20

    // Bill lines carry the itemId (no longer stripped).
    const bLines = await db
      .select()
      .from(billLines)
      .where(eq(billLines.billId, bill.id))
      .orderBy(asc(billLines.lineOrder));
    expect(bLines).toHaveLength(2);
    expect(bLines[0].itemId).toBe(widgetId);
    expect(bLines[0].accountId).toBe(acct['1300']); // routed to inventory asset
    expect(bLines[1].itemId).toBeNull();

    // Perpetual inventory: quantity on hand + average cost updated.
    const widget = await itemRow(widgetId);
    expect(Number(widget.quantityOnHand)).toBeCloseTo(qohBefore + 10, 4);
    expect(Number(widget.averageCost)).toBeCloseTo(5, 4);

    // PO closed + fully billed per line + convertedBillId stamped.
    const updated = await getPurchaseOrder(ctx, po.id);
    expect(updated.status).toBe('closed');
    expect(updated.convertedBillId).toBe(bill.id);
    for (const l of updated.lines) {
      expect(Number(l.quantityBilled)).toBeCloseTo(Number(l.quantity), 4);
    }

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Partial billing flow
  // -------------------------------------------------------------------------

  it('bills a PO partially, tracks quantityBilled, then closes when fully billed', async () => {
    const qohBefore = Number((await itemRow(widgetId)).quantityOnHand ?? 0);

    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-06-05'),
      lines: [{ itemId: widgetId, description: 'Widgets', quantity: 10, rate: '4.00' }],
    });
    const [line] = await poLines(po.id);

    // --- First partial bill: 4 of 10 ---
    const bill1 = await convertToBill(ctx, po.id, {
      lines: [{ lineId: line.id, quantity: 4 }],
    });
    expect(bill1.total).toBe('16.00'); // 4 * 4.00

    let detail = await getPurchaseOrder(ctx, po.id);
    expect(detail.status).toBe('partial');
    expect(detail.convertedBillId).toBeNull(); // only stamped on the closing bill
    expect(Number(detail.lines[0].quantityBilled)).toBeCloseTo(4, 4);

    // Stock received for the partial quantity only.
    expect(Number((await itemRow(widgetId)).quantityOnHand)).toBeCloseTo(qohBefore + 4, 4);

    // --- Over-billing guard: 7 requested, only 6 remaining ---
    await expect(
      convertToBill(ctx, po.id, { lines: [{ lineId: line.id, quantity: 7 }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // quantityBilled untouched by the failed attempt.
    detail = await getPurchaseOrder(ctx, po.id);
    expect(Number(detail.lines[0].quantityBilled)).toBeCloseTo(4, 4);

    // --- Second bill: default = remaining (6) → PO closes ---
    const bill2 = await convertToBill(ctx, po.id);
    expect(bill2.total).toBe('24.00'); // 6 * 4.00
    expect(bill2.id).not.toBe(bill1.id); // multiple bills per PO

    detail = await getPurchaseOrder(ctx, po.id);
    expect(detail.status).toBe('closed');
    expect(detail.convertedBillId).toBe(bill2.id);
    expect(Number(detail.lines[0].quantityBilled)).toBeCloseTo(10, 4);

    expect(Number((await itemRow(widgetId)).quantityOnHand)).toBeCloseTo(qohBefore + 10, 4);

    // --- Third bill: nothing remaining → CONFLICT ---
    await expect(convertToBill(ctx, po.id)).rejects.toMatchObject({ code: 'CONFLICT' });

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('bills only the requested lines; untouched lines keep the PO partial', async () => {
    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-06-08'),
      lines: [
        { accountId: acct['5000'], description: 'Materials', quantity: 5, rate: '10.00' },
        { accountId: acct['6300'], description: 'Supplies', quantity: 3, rate: '2.00' },
      ],
    });
    const lines = await poLines(po.id);

    const bill = await convertToBill(ctx, po.id, {
      lines: [{ lineId: lines[0].id, quantity: 5 }],
    });
    expect(bill.total).toBe('50.00');

    const detail = await getPurchaseOrder(ctx, po.id);
    expect(detail.status).toBe('partial');
    expect(Number(detail.lines[0].quantityBilled)).toBeCloseTo(5, 4);
    expect(Number(detail.lines[1].quantityBilled)).toBeCloseTo(0, 4);

    // Default convert picks up just the remaining line.
    const bill2 = await convertToBill(ctx, po.id);
    expect(bill2.total).toBe('6.00'); // 3 * 2.00

    const closed = await getPurchaseOrder(ctx, po.id);
    expect(closed.status).toBe('closed');
  });

  it('rejects bad billing requests: unknown line, duplicate line, zero quantity', async () => {
    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-06-10'),
      lines: [{ accountId: acct['5000'], quantity: 2, rate: '7.00' }],
    });
    const [line] = await poLines(po.id);

    await expect(
      convertToBill(ctx, po.id, {
        lines: [{ lineId: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await expect(
      convertToBill(ctx, po.id, {
        lines: [
          { lineId: line.id, quantity: 1 },
          { lineId: line.id, quantity: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await expect(
      convertToBill(ctx, po.id, { lines: [{ lineId: line.id, quantity: 0 }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // -------------------------------------------------------------------------
  // updateStatus guards on partially billed POs
  // -------------------------------------------------------------------------

  it('cannot reopen or void a partially billed PO, but can close it manually', async () => {
    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-06-12'),
      lines: [{ accountId: acct['5000'], quantity: 4, rate: '25.00' }],
    });
    const [line] = await poLines(po.id);
    await convertToBill(ctx, po.id, { lines: [{ lineId: line.id, quantity: 1 }] });

    await expect(updateStatus(ctx, po.id, 'open')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(updateStatus(ctx, po.id, 'void')).rejects.toMatchObject({ code: 'CONFLICT' });

    // Manual close (QB "close PO" on a partially received order).
    const closed = await updateStatus(ctx, po.id, 'closed');
    expect(closed.status).toBe('closed');

    // No further billing once closed.
    await expect(convertToBill(ctx, po.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('cannot convert a voided PO', async () => {
    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-06-14'),
      lines: [{ accountId: acct['5000'], quantity: 1, rate: '9.00' }],
    });
    await updateStatus(ctx, po.id, 'void');
    await expect(convertToBill(ctx, po.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  // -------------------------------------------------------------------------
  // Final overall balance check
  // -------------------------------------------------------------------------

  it('trial balance is balanced after all operations', async () => {
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });
});
