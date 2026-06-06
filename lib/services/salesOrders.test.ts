import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts, journalEntryLines } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { trialBalance } from './reports';
import {
  createSalesOrder,
  listSalesOrders,
  getSalesOrder,
  updateStatus,
  convertToInvoice,
} from './salesOrders';
import { ServiceError } from './_base';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-sales-orders-7a');
let ctx: ServiceContext;
let db: DB;
let customerId: string;

describe('Sales orders service', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'owner-so@test.local', name: 'Owner SO', passwordHash: 'x' })
      .returning();

    const [company] = await db
      .insert(companies)
      .values({ name: 'SO Test Co', ownerId: user.id })
      .returning();

    ctx = { db, companyId: company.id, userId: user.id };

    // Seed the minimum COA accounts needed by createInvoice.
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['1200', 'Accounts Receivable', 'asset', 'accounts_receivable'],
      ['2200', 'Sales Tax Payable', 'liability', 'accounts_payable'],
      ['4000', 'Sales Income', 'revenue', 'sales'],
    ];
    for (const [code, name, type, subtype] of defs) {
      await createAccount(ctx, { code, name, type: type as never, subtype });
    }

    // Create a customer.
    const { customers } = await import('@/lib/db/schema');
    const [cust] = await db
      .insert(customers)
      .values({ companyId: company.id, displayName: 'Test Customer' })
      .returning();
    customerId = cust.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // createSalesOrder
  // -------------------------------------------------------------------------

  it('creates a sales order with correct totals', async () => {
    const order = await createSalesOrder(ctx, {
      customerId,
      date: new Date('2025-03-01'),
      lines: [
        { description: 'Widget A', quantity: 2, rate: 50 },
        { description: 'Widget B', quantity: 1, rate: 100 },
      ],
      memo: 'Test order',
    });

    expect(order.orderNumber).toBe(1);
    expect(order.status).toBe('open');
    expect(order.subtotal).toBe('200.00');
    expect(order.total).toBe('200.00');
    expect(order.lines).toHaveLength(2);
    expect(order.convertedInvoiceId).toBeNull();
  });

  it('rejects a sales order with no lines', async () => {
    await expect(
      createSalesOrder(ctx, { customerId, date: new Date(), lines: [] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects lines with zero or negative quantity', async () => {
    await expect(
      createSalesOrder(ctx, {
        customerId,
        date: new Date(),
        lines: [{ description: 'Bad', quantity: 0, rate: 10 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a non-existent customer', async () => {
    await expect(
      createSalesOrder(ctx, {
        customerId: '00000000-0000-0000-0000-000000000000',
        date: new Date(),
        lines: [{ description: 'x', quantity: 1, rate: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // listSalesOrders / getSalesOrder
  // -------------------------------------------------------------------------

  it('listSalesOrders returns all orders for the company', async () => {
    const orders = await listSalesOrders(ctx);
    expect(orders.length).toBeGreaterThanOrEqual(1);
    expect(orders.every((o) => o.companyId === ctx.companyId)).toBe(true);
  });

  it('getSalesOrder returns order with lines', async () => {
    const orders = await listSalesOrders(ctx);
    const first = orders[0];
    const full = await getSalesOrder(ctx, first.id);
    expect(full.id).toBe(first.id);
    expect(Array.isArray(full.lines)).toBe(true);
  });

  it('getSalesOrder throws NOT_FOUND for unknown id', async () => {
    await expect(
      getSalesOrder(ctx, '00000000-0000-0000-0000-000000000099'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // updateStatus
  // -------------------------------------------------------------------------

  it('updateStatus can set status to void', async () => {
    const order = await createSalesOrder(ctx, {
      customerId,
      date: new Date('2025-03-05'),
      lines: [{ description: 'To be voided', quantity: 1, rate: 25 }],
    });
    const updated = await updateStatus(ctx, order.id, 'void');
    expect(updated.status).toBe('void');
  });

  // -------------------------------------------------------------------------
  // convertToInvoice — main scenario
  // -------------------------------------------------------------------------

  it('convertToInvoice creates an invoice, posts AR, and leaves trial balance balanced', async () => {
    // Create a fresh order to convert.
    const order = await createSalesOrder(ctx, {
      customerId,
      date: new Date('2025-04-01'),
      lines: [
        { description: 'Service A', quantity: 3, rate: '100.00' },
        { description: 'Service B', quantity: 1, rate: '250.00' },
      ],
    });
    // total = 3*100 + 1*250 = 550

    const invoice = await convertToInvoice(ctx, order.id);

    // Invoice was returned.
    expect(invoice).toBeDefined();
    expect(invoice.customerId).toBe(customerId);
    expect(invoice.total).toBe('550.00');
    expect(invoice.postedEntryId).toBeTruthy();

    // Order is now closed and stamped with invoice id.
    const updatedOrder = await getSalesOrder(ctx, order.id);
    expect(updatedOrder.status).toBe('closed');
    expect(updatedOrder.convertedInvoiceId).toBe(invoice.id);

    // A/R was debited — verify a journal entry line exists for 1200 with a debit.
    const arLines = await db
      .select()
      .from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, invoice.postedEntryId!));
    const arDebit = arLines.find((l) => l.debit && Number(l.debit) > 0);
    expect(arDebit).toBeDefined();
    expect(Number(arDebit!.debit)).toBe(550);

    // Trial balance must be balanced after posting.
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it('convertToInvoice throws CONFLICT when order is already converted', async () => {
    const order = await createSalesOrder(ctx, {
      customerId,
      date: new Date('2025-04-10'),
      lines: [{ description: 'Once', quantity: 1, rate: 10 }],
    });
    await convertToInvoice(ctx, order.id);

    await expect(convertToInvoice(ctx, order.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('convertToInvoice throws CONFLICT when order is voided', async () => {
    const order = await createSalesOrder(ctx, {
      customerId,
      date: new Date('2025-04-15'),
      lines: [{ description: 'Voided', quantity: 1, rate: 10 }],
    });
    await updateStatus(ctx, order.id, 'void');

    await expect(convertToInvoice(ctx, order.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('order numbers auto-increment per company', async () => {
    const before = await listSalesOrders(ctx);
    const maxBefore = Math.max(...before.map((o) => o.orderNumber));

    const order = await createSalesOrder(ctx, {
      customerId,
      date: new Date('2025-05-01'),
      lines: [{ description: 'Auto num', quantity: 1, rate: 5 }],
    });
    expect(order.orderNumber).toBe(maxBefore + 1);
  });
});
