/**
 * Integration tests for partial sales-order invoicing + backorder tracking.
 *
 * Uses a throwaway PGlite directory so tests are fully isolated from dev data.
 * Verifies:
 *  - convertToInvoice with per-line quantities: quantityInvoiced accumulates,
 *    order status open → partial → closed, multiple invoices per order.
 *  - Over-invoicing is rejected; invoicing a fully invoiced order throws CONFLICT.
 *  - Default (no lines) convert invoices the full remaining quantity.
 *  - convertedInvoiceId is stamped by the invoice that completes the order.
 *  - backorderReport returns remaining quantity per open SO line and drops
 *    closed/fully-invoiced orders.
 *  - updateStatus guards for partially invoiced orders (no reopen / no void),
 *    while manual close (cancel backorder) is allowed.
 *  - Trial balance stays balanced after every conversion.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { eq, asc } from 'drizzle-orm';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, customers, salesOrderLines } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { trialBalance } from './reports';
import {
  createSalesOrder,
  getSalesOrder,
  updateStatus,
  convertToInvoice,
  backorderReport,
} from './salesOrders';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-so-partial');
let ctx: ServiceContext;
let db: DB;
let customerId: string;

async function soLines(soId: string) {
  return db
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, soId))
    .orderBy(asc(salesOrderLines.lineOrder));
}

describe('Sales orders — partial invoicing + backorders', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'so-partial@test.local', name: 'SO Partial', passwordHash: 'x' })
      .returning();

    const [company] = await db
      .insert(companies)
      .values({ name: 'SO Partial Test Co', ownerId: user.id })
      .returning();

    ctx = { db, companyId: company.id, userId: user.id };

    // Minimum COA for createInvoice.
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['1200', 'Accounts Receivable', 'asset', 'accounts_receivable'],
      ['2200', 'Sales Tax Payable', 'liability', 'accounts_payable'],
      ['4000', 'Sales Income', 'revenue', 'sales'],
    ];
    for (const [code, name, type, subtype] of defs) {
      await createAccount(ctx, { code, name, type: type as never, subtype });
    }

    const [cust] = await db
      .insert(customers)
      .values({ companyId: company.id, displayName: 'Backorder Customer' })
      .returning();
    customerId = cust.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Partial conversion: open → partial → closed
  // -------------------------------------------------------------------------

  it('invoices a partial per-line quantity and marks the order partial', async () => {
    const order = await createSalesOrder(ctx, {
      customerId,
      date: new Date('2025-06-01'),
      lines: [
        { description: 'Widget A', quantity: 5, rate: '100.00' },
        { description: 'Widget B', quantity: 2, rate: '250.00' },
      ],
    });
    const lines = await soLines(order.id);

    // Invoice 2 of 5 Widget A only.
    const invoice = await convertToInvoice(ctx, order.id, {
      lines: [{ lineId: lines[0].id, quantity: 2 }],
    });

    expect(invoice.total).toBe('200.00'); // 2 x 100

    const after = await getSalesOrder(ctx, order.id);
    expect(after.status).toBe('partial');
    expect(after.convertedInvoiceId).toBeNull(); // not complete yet

    const refreshed = await soLines(order.id);
    expect(Number(refreshed[0].quantityInvoiced)).toBe(2);
    expect(Number(refreshed[1].quantityInvoiced)).toBe(0);

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);

    // Backorder report shows the remaining quantities.
    const report = await backorderReport(ctx);
    const rowsForOrder = report.filter((r) => r.salesOrderId === order.id);
    expect(rowsForOrder).toHaveLength(2);
    const widgetA = rowsForOrder.find((r) => r.description === 'Widget A')!;
    expect(Number(widgetA.quantityBackordered)).toBe(3);
    expect(widgetA.customerName).toBe('Backorder Customer');
    const widgetB = rowsForOrder.find((r) => r.description === 'Widget B')!;
    expect(Number(widgetB.quantityBackordered)).toBe(2);

    // Second partial invoice: 3 remaining Widget A + 1 Widget B.
    const invoice2 = await convertToInvoice(ctx, order.id, {
      lines: [
        { lineId: lines[0].id, quantity: 3 },
        { lineId: lines[1].id, quantity: 1 },
      ],
    });
    expect(invoice2.total).toBe('550.00'); // 3*100 + 1*250

    const mid = await getSalesOrder(ctx, order.id);
    expect(mid.status).toBe('partial'); // Widget B still has 1 open

    // Final convert with NO lines: defaults to the full remaining quantity.
    const invoice3 = await convertToInvoice(ctx, order.id);
    expect(invoice3.total).toBe('250.00'); // last Widget B

    const closed = await getSalesOrder(ctx, order.id);
    expect(closed.status).toBe('closed');
    // Stamped with the invoice that completed the order.
    expect(closed.convertedInvoiceId).toBe(invoice3.id);

    const finalLines = await soLines(order.id);
    expect(Number(finalLines[0].quantityInvoiced)).toBe(5);
    expect(Number(finalLines[1].quantityInvoiced)).toBe(2);

    // Fully invoiced — gone from the backorder report.
    const finalReport = await backorderReport(ctx);
    expect(finalReport.some((r) => r.salesOrderId === order.id)).toBe(false);

    const tb2 = await trialBalance(ctx);
    expect(tb2.balanced).toBe(true);
  });

  it('throws CONFLICT when converting an already-closed order', async () => {
    const order = await createSalesOrder(ctx, {
      customerId,
      date: new Date('2025-06-02'),
      lines: [{ description: 'One-shot', quantity: 1, rate: 10 }],
    });
    await convertToInvoice(ctx, order.id);
    await expect(convertToInvoice(ctx, order.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  // -------------------------------------------------------------------------
  // Over-invoicing / input guards
  // -------------------------------------------------------------------------

  it('rejects over-invoicing a line', async () => {
    const order = await createSalesOrder(ctx, {
      customerId,
      date: new Date('2025-06-03'),
      lines: [{ description: 'Limited', quantity: 4, rate: 25 }],
    });
    const lines = await soLines(order.id);

    await expect(
      convertToInvoice(ctx, order.id, { lines: [{ lineId: lines[0].id, quantity: 5 }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // Partial then exceed the remainder.
    await convertToInvoice(ctx, order.id, { lines: [{ lineId: lines[0].id, quantity: 3 }] });
    await expect(
      convertToInvoice(ctx, order.id, { lines: [{ lineId: lines[0].id, quantity: 2 }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // Nothing was double-claimed.
    const refreshed = await soLines(order.id);
    expect(Number(refreshed[0].quantityInvoiced)).toBe(3);
    const after = await getSalesOrder(ctx, order.id);
    expect(after.status).toBe('partial');
  });

  it('rejects zero/negative quantities, unknown and duplicate line ids', async () => {
    const order = await createSalesOrder(ctx, {
      customerId,
      date: new Date('2025-06-04'),
      lines: [{ description: 'Guard', quantity: 2, rate: 10 }],
    });
    const lines = await soLines(order.id);

    await expect(
      convertToInvoice(ctx, order.id, { lines: [{ lineId: lines[0].id, quantity: 0 }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await expect(
      convertToInvoice(ctx, order.id, { lines: [{ lineId: lines[0].id, quantity: -1 }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await expect(
      convertToInvoice(ctx, order.id, {
        lines: [{ lineId: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await expect(
      convertToInvoice(ctx, order.id, {
        lines: [
          { lineId: lines[0].id, quantity: 1 },
          { lineId: lines[0].id, quantity: 1 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // None of the failed attempts consumed quantity.
    const refreshed = await soLines(order.id);
    expect(Number(refreshed[0].quantityInvoiced)).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Status guards for partially invoiced orders
  // -------------------------------------------------------------------------

  it('blocks reopening or voiding a partially invoiced order; allows manual close', async () => {
    const order = await createSalesOrder(ctx, {
      customerId,
      date: new Date('2025-06-05'),
      lines: [{ description: 'Half', quantity: 2, rate: 50 }],
    });
    const lines = await soLines(order.id);
    await convertToInvoice(ctx, order.id, { lines: [{ lineId: lines[0].id, quantity: 1 }] });

    await expect(updateStatus(ctx, order.id, 'open')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(updateStatus(ctx, order.id, 'void')).rejects.toMatchObject({ code: 'CONFLICT' });

    // Manual close = cancel the backorder.
    const closed = await updateStatus(ctx, order.id, 'closed');
    expect(closed.status).toBe('closed');

    // Closed orders fall out of the backorder report even with remaining qty.
    const report = await backorderReport(ctx);
    expect(report.some((r) => r.salesOrderId === order.id)).toBe(false);

    // And cannot be invoiced any further.
    await expect(convertToInvoice(ctx, order.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  // -------------------------------------------------------------------------
  // Legacy behavior: full convert without options
  // -------------------------------------------------------------------------

  it('default convert (no options) invoices everything and closes the order', async () => {
    const order = await createSalesOrder(ctx, {
      customerId,
      date: new Date('2025-06-06'),
      lines: [
        { description: 'Full A', quantity: 3, rate: '100.00' },
        { description: 'Full B', quantity: 1, rate: '250.00' },
      ],
    });

    const invoice = await convertToInvoice(ctx, order.id);
    expect(invoice.total).toBe('550.00');

    const after = await getSalesOrder(ctx, order.id);
    expect(after.status).toBe('closed');
    expect(after.convertedInvoiceId).toBe(invoice.id);

    const lines = await soLines(order.id);
    expect(Number(lines[0].quantityInvoiced)).toBe(3);
    expect(Number(lines[1].quantityInvoiced)).toBe(1);

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });
});
