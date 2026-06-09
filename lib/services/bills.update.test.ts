/**
 * Integration tests for updateBill (edit an unpaid bill in place).
 *
 * Mirrors updateInvoice: void + repost the GL entry, reverse + redo inventory
 * receipts from item lines, audit old/new. Editing is blocked once payments or
 * vendor credits have been applied, or after voiding.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import {
  auditLogs,
  billLines,
  companies,
  items,
  journalEntries,
  journalEntryLines,
  users,
  vendors,
} from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { trialBalance } from './reports';
import { createBill, getBill, updateBill, voidBill } from './bills';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-bills-update');
let ctx: ServiceContext;
let db: DB;

const acct: Record<string, string> = {};
let vendorId: string;
let vendor2Id: string;
let itemId: string;

describe('updateBill — edit unpaid bills', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'bills-update@test.local', name: 'Bill Editor', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Bill Update Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['1300', 'Inventory Asset', 'asset', 'inventory'],
      ['2000', 'Accounts Payable', 'liability', 'accounts_payable'],
      ['6000', 'Advertising', 'expense', 'operating_expenses'],
      ['6300', 'Office Supplies', 'expense', 'operating_expenses'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }

    const [vendor] = await db
      .insert(vendors)
      .values({ companyId: company.id, displayName: 'Edit Test Vendor' })
      .returning();
    vendorId = vendor.id;
    const [vendor2] = await db
      .insert(vendors)
      .values({ companyId: company.id, displayName: 'Second Vendor' })
      .returning();
    vendor2Id = vendor2.id;

    // Average-cost inventory item (no FIFO layers).
    const [item] = await db
      .insert(items)
      .values({
        companyId: company.id,
        name: 'Widget',
        type: 'inventory',
        assetAccountId: acct['1300'],
        quantityOnHand: '0.0000',
        averageCost: '0.0000',
      })
      .returning();
    itemId = item.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Expense-line bill edit: void + repost
  // -----------------------------------------------------------------------

  it('edits an expense bill: replaces lines, voids the old JE, posts a new one', async () => {
    const bill = await createBill(ctx, {
      vendorId,
      billNumber: 'ED-001',
      date: new Date('2026-02-10'),
      lines: [{ accountId: acct['6300'], description: 'Paper', amount: '100.00' }],
    });
    const oldEntryId = bill.postedEntryId!;

    const updated = await updateBill(ctx, bill.id, {
      vendorId: vendor2Id, // vendor change is honored
      billNumber: 'ED-001-R',
      date: new Date('2026-02-15'),
      memo: 'corrected',
      lines: [
        { accountId: acct['6000'], description: 'Ads', amount: '120.00' },
        { accountId: acct['6300'], description: 'Paper', amount: '30.00' },
      ],
    });

    expect(updated.total).toBe('150.00');
    expect(updated.balanceDue).toBe('150.00');
    expect(updated.vendorId).toBe(vendor2Id);
    expect(updated.billNumber).toBe('ED-001-R');
    expect(updated.memo).toBe('corrected');
    expect(updated.postedEntryId).not.toBe(oldEntryId);

    // Old entry voided; new entry posted with sourceRef intact.
    const [oldEntry] = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, oldEntryId));
    expect(oldEntry.status).toBe('void');

    const [newEntry] = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, updated.postedEntryId!));
    expect(newEntry.status).toBe('posted');
    expect(newEntry.sourceRef).toBe(`bill:${bill.id}`);
    expect(new Date(newEntry.date).toISOString().slice(0, 10)).toBe('2026-02-15');

    // New entry credits A/P for the full new total.
    const lines = await db
      .select()
      .from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, newEntry.id));
    const apCredit = lines.find((l) => l.accountId === acct['2000']);
    expect(apCredit?.credit).toBe('150.00');

    // Bill lines replaced.
    const detail = await getBill(ctx, bill.id);
    expect(detail.lines.length).toBe(2);
    expect(detail.lines.map((l) => l.amount).sort()).toEqual(['120.00', '30.00']);

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('writes an update audit row with old and new values', async () => {
    const [audit] = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.companyId, ctx.companyId),
          eq(auditLogs.entityType, 'bill'),
          eq(auditLogs.action, 'update'),
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    expect(audit).toBeTruthy();
    const oldValues = audit.oldValues as { total: string };
    const newValues = audit.newValues as { total: string };
    expect(oldValues.total).toBe('100.00');
    expect(newValues.total).toBe('150.00');
  });

  // -----------------------------------------------------------------------
  // Inventory item lines: reverse + redo the stock receipt
  // -----------------------------------------------------------------------

  it('reverses and re-receives inventory stock when item lines change', async () => {
    const bill = await createBill(ctx, {
      vendorId,
      billNumber: 'ED-INV-1',
      date: new Date('2026-03-01'),
      lines: [{ itemId, quantity: 5, unitCost: '10.00' }],
    });

    let [item] = await db.select().from(items).where(eq(items.id, itemId));
    expect(item.quantityOnHand).toBe('5.0000');
    expect(item.averageCost).toBe('10.0000');

    await updateBill(ctx, bill.id, {
      vendorId,
      billNumber: 'ED-INV-1',
      date: new Date('2026-03-02'),
      lines: [{ itemId, quantity: 3, unitCost: '12.00' }],
    });

    [item] = await db.select().from(items).where(eq(items.id, itemId));
    expect(item.quantityOnHand).toBe('3.0000');
    expect(item.averageCost).toBe('12.0000');

    const detail = await getBill(ctx, bill.id);
    expect(detail.total).toBe('36.00');
    expect(detail.lines.length).toBe(1);
    expect(detail.lines[0].quantity).toBe('3.0000');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);

    // Cleanup: void to pull the 3 units back out for later tests.
    await voidBill(ctx, bill.id);
    [item] = await db.select().from(items).where(eq(items.id, itemId));
    expect(item.quantityOnHand).toBe('0.0000');
  });

  // -----------------------------------------------------------------------
  // Guards
  // -----------------------------------------------------------------------

  it('rejects editing a bill with payments applied (CONFLICT)', async () => {
    const bill = await createBill(ctx, {
      vendorId,
      date: new Date('2026-03-05'),
      lines: [{ accountId: acct['6300'], amount: '80.00' }],
    });

    // Simulate an applied payment.
    const { bills } = await import('@/lib/db/schema');
    await db
      .update(bills)
      .set({ amountPaid: '80.00', balanceDue: '0.00', status: 'paid' })
      .where(eq(bills.id, bill.id));

    await expect(
      updateBill(ctx, bill.id, {
        vendorId,
        date: new Date('2026-03-06'),
        lines: [{ accountId: acct['6300'], amount: '90.00' }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects editing a bill with vendor credits applied (CONFLICT)', async () => {
    const bill = await createBill(ctx, {
      vendorId,
      date: new Date('2026-03-07'),
      lines: [{ accountId: acct['6300'], amount: '60.00' }],
    });

    const { bills } = await import('@/lib/db/schema');
    await db
      .update(bills)
      .set({ amountCredited: '10.00', balanceDue: '50.00' })
      .where(eq(bills.id, bill.id));

    await expect(
      updateBill(ctx, bill.id, {
        vendorId,
        date: new Date('2026-03-08'),
        lines: [{ accountId: acct['6300'], amount: '55.00' }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects editing a voided bill (CONFLICT)', async () => {
    const bill = await createBill(ctx, {
      vendorId,
      date: new Date('2026-03-09'),
      lines: [{ accountId: acct['6000'], amount: '40.00' }],
    });
    await voidBill(ctx, bill.id);

    await expect(
      updateBill(ctx, bill.id, {
        vendorId,
        date: new Date('2026-03-10'),
        lines: [{ accountId: acct['6000'], amount: '45.00' }],
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rejects invalid new lines without touching the saved bill', async () => {
    const bill = await createBill(ctx, {
      vendorId,
      date: new Date('2026-03-11'),
      lines: [{ accountId: acct['6000'], amount: '70.00' }],
    });

    await expect(
      updateBill(ctx, bill.id, {
        vendorId,
        date: new Date('2026-03-12'),
        lines: [{ accountId: acct['6000'], amount: '0.00' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // Untouched: total and lines remain.
    const detail = await getBill(ctx, bill.id);
    expect(detail.total).toBe('70.00');
    const rows = await db.select().from(billLines).where(eq(billLines.billId, bill.id));
    expect(rows.length).toBe(1);
  });
});
