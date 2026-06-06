/**
 * Integration tests for the Purchase Orders service.
 *
 * Uses a throwaway PGlite directory so tests are fully isolated from dev data.
 * Verifies:
 *  - createPurchaseOrder stores the PO + lines, computes totals, no GL entry.
 *  - listPurchaseOrders / getPurchaseOrder return the correct data.
 *  - updateStatus guard rails work (cannot reopen closed, cannot convert voided).
 *  - convertToBill creates a bill, posts A/P, stamps convertedBillId + status 'closed'.
 *  - Trial balance stays balanced after every mutation (POs themselves have zero GL impact).
 *  - Conflict guards: double-convert throws CONFLICT.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts, vendors, bills } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { trialBalance } from './reports';
import {
  createPurchaseOrder,
  listPurchaseOrders,
  getPurchaseOrder,
  updateStatus,
  convertToBill,
} from './purchaseOrders';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-purchase-orders-p1');
let ctx: ServiceContext;
let db: DB;

/** account code → id */
const acct: Record<string, string> = {};
let vendorId: string;

describe('Purchase Orders service', () => {
  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'po-owner@test.local', name: 'PO Owner', passwordHash: 'x' })
      .returning();

    const [company] = await db
      .insert(companies)
      .values({ name: 'PO Test Co', ownerId: user.id })
      .returning();

    ctx = { db, companyId: company.id, userId: user.id };

    // Seed minimum chart of accounts.
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['2000', 'Accounts Payable', 'liability', 'accounts_payable'],
      ['5000', 'Cost of Goods Sold', 'expense', 'cost_of_goods_sold'],
      ['6000', 'Advertising', 'expense', 'operating_expenses'],
      ['6300', 'Office Supplies', 'expense', 'operating_expenses'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }

    // Seed one vendor.
    const [vendor] = await db
      .insert(vendors)
      .values({ companyId: company.id, displayName: 'Test Supplier LLC' })
      .returning();
    vendorId = vendor.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Validation guards
  // -------------------------------------------------------------------------

  it('rejects a PO with no lines', async () => {
    await expect(
      createPurchaseOrder(ctx, {
        vendorId,
        date: new Date('2025-04-01'),
        lines: [],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a line with zero quantity', async () => {
    await expect(
      createPurchaseOrder(ctx, {
        vendorId,
        date: new Date('2025-04-01'),
        lines: [{ accountId: acct['5000'], quantity: 0, rate: 10 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a PO for a vendor in another company', async () => {
    await expect(
      createPurchaseOrder(ctx, {
        vendorId: '00000000-0000-0000-0000-000000000000',
        date: new Date('2025-04-01'),
        lines: [{ accountId: acct['5000'], quantity: 1, rate: 10 }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // createPurchaseOrder — happy path
  // -------------------------------------------------------------------------

  it('creates a single-line PO with correct totals and no GL entry', async () => {
    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-04-10'),
      lines: [{ accountId: acct['5000'], description: 'Raw materials', quantity: 10, rate: 50 }],
      memo: 'Q2 materials',
    });

    expect(po.poNumber).toBe(1);
    expect(po.status).toBe('open');
    expect(po.total).toBe('500.00');
    expect(po.convertedBillId).toBeNull();
    expect(po.lines).toHaveLength(1);
    expect(po.lines[0].amount).toBe('500.00');

    // No GL entry — A/P balance must remain 0.
    const [ap] = await db.select().from(accounts).where(eq(accounts.id, acct['2000']));
    expect(ap.balance).toBe('0.00');

    // Trial balance is trivially balanced (all zeros).
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('creates a multi-line PO and sums amounts correctly', async () => {
    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-04-15'),
      lines: [
        { accountId: acct['6000'], description: 'Ads', quantity: 2, rate: '150.00' },
        { accountId: acct['6300'], description: 'Pens', quantity: 5, rate: '3.50' },
      ],
    });

    // 2*150 + 5*3.5 = 300 + 17.5 = 317.5
    expect(po.total).toBe('317.50');
    expect(po.lines).toHaveLength(2);
    expect(po.lines[0].amount).toBe('300.00');
    expect(po.lines[1].amount).toBe('17.50');
  });

  it('PO numbers auto-increment per company', async () => {
    const before = await listPurchaseOrders(ctx);
    const maxBefore = Math.max(...before.map((p) => p.poNumber));

    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-04-20'),
      lines: [{ accountId: acct['5000'], quantity: 1, rate: 1 }],
    });

    expect(po.poNumber).toBe(maxBefore + 1);
  });

  // -------------------------------------------------------------------------
  // listPurchaseOrders / getPurchaseOrder
  // -------------------------------------------------------------------------

  it('listPurchaseOrders returns all POs for the company', async () => {
    const list = await listPurchaseOrders(ctx);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((p) => p.companyId === ctx.companyId)).toBe(true);
  });

  it('getPurchaseOrder returns the PO with its lines', async () => {
    const all = await listPurchaseOrders(ctx);
    const first = all[0];
    const full = await getPurchaseOrder(ctx, first.id);
    expect(full.id).toBe(first.id);
    expect(Array.isArray(full.lines)).toBe(true);
    expect(full.lines.length).toBeGreaterThan(0);
  });

  it('getPurchaseOrder throws NOT_FOUND for an unknown id', async () => {
    await expect(
      getPurchaseOrder(ctx, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // updateStatus
  // -------------------------------------------------------------------------

  it('updateStatus can set status to void on an open PO', async () => {
    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-04-22'),
      lines: [{ accountId: acct['5000'], quantity: 1, rate: 10 }],
    });
    const updated = await updateStatus(ctx, po.id, 'void');
    expect(updated.status).toBe('void');
  });

  it('updateStatus throws CONFLICT when trying to reopen a closed PO', async () => {
    // Create and convert a PO so it becomes closed.
    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-04-25'),
      lines: [{ accountId: acct['5000'], quantity: 1, rate: 100 }],
    });
    await convertToBill(ctx, po.id);

    await expect(
      updateStatus(ctx, po.id, 'open'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  // -------------------------------------------------------------------------
  // convertToBill — main scenario
  // -------------------------------------------------------------------------

  it('convertToBill creates a bill, posts A/P, stamps convertedBillId, leaves trial balance balanced', async () => {
    // Snapshot A/P before.
    const [apBefore] = await db.select().from(accounts).where(eq(accounts.id, acct['2000']));
    const apBefore$ = Number(apBefore.balance);

    // Create a PO to convert.
    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-05-01'),
      expectedDate: new Date('2025-05-15'),
      lines: [
        { accountId: acct['5000'], description: 'Inventory', quantity: 20, rate: '25.00' },
        { accountId: acct['6300'], description: 'Packing supplies', quantity: 10, rate: '2.00' },
      ],
      memo: 'May restock',
    });
    // total = 20*25 + 10*2 = 500 + 20 = 520

    const bill = await convertToBill(ctx, po.id);

    // Bill was created.
    expect(bill).toBeDefined();
    expect(bill.vendorId).toBe(vendorId);
    expect(bill.total).toBe('520.00');
    expect(bill.status).toBe('open');
    expect(bill.postedEntryId).toBeTruthy();

    // A/P increased by 520.
    const [apAfter] = await db.select().from(accounts).where(eq(accounts.id, acct['2000']));
    expect(Number(apAfter.balance)).toBeCloseTo(apBefore$ + 520, 2);

    // PO is now closed and stamped with the bill id.
    const updatedPo = await getPurchaseOrder(ctx, po.id);
    expect(updatedPo.status).toBe('closed');
    expect(updatedPo.convertedBillId).toBe(bill.id);

    // Verify the bill exists in the DB.
    const [billRow] = await db.select().from(bills).where(eq(bills.id, bill.id));
    expect(billRow).toBeDefined();
    expect(billRow.companyId).toBe(ctx.companyId);

    // Trial balance must be balanced.
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it('convertToBill throws CONFLICT when PO is already converted', async () => {
    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-05-05'),
      lines: [{ accountId: acct['5000'], quantity: 1, rate: 50 }],
    });
    await convertToBill(ctx, po.id);

    await expect(convertToBill(ctx, po.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('convertToBill throws CONFLICT when PO is voided', async () => {
    const po = await createPurchaseOrder(ctx, {
      vendorId,
      date: new Date('2025-05-08'),
      lines: [{ accountId: acct['5000'], quantity: 1, rate: 75 }],
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
