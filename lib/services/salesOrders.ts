/**
 * Sales Orders service.
 *
 * Sales orders are pre-sale commitments that do NOT post to the GL.
 * They become invoices when `convertToInvoice` is called, which calls
 * `createInvoice` and stamps the order with the resulting invoice id.
 *
 * Status flow:  open → closed  (via convertToInvoice)
 *               open → void    (via updateStatus)
 */
import { and, eq, sql } from 'drizzle-orm';
import { Money, toAmountString } from '@/lib/money';
import { customers, salesOrders, salesOrderLines } from '@/lib/db/schema';
import {
  type ServiceContext,
  ServiceError,
  inTransaction,
  notFound,
  validation,
  writeAudit,
} from './_base';
import { createInvoice } from './invoices';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SalesOrderLineInput {
  itemId?: string | null;
  description?: string | null;
  quantity: string | number;
  rate: string | number;
}

export interface CreateSalesOrderInput {
  customerId: string;
  date: Date;
  lines: SalesOrderLineInput[];
  memo?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function nextOrderNumber(ctx: ServiceContext): Promise<number> {
  const [row] = await ctx.db
    .select({ max: sql<number>`COALESCE(MAX(${salesOrders.orderNumber}), 0)` })
    .from(salesOrders)
    .where(eq(salesOrders.companyId, ctx.companyId));
  return (row?.max ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// createSalesOrder
// ---------------------------------------------------------------------------

export async function createSalesOrder(ctx: ServiceContext, input: CreateSalesOrderInput) {
  if (!input.lines || input.lines.length === 0) {
    throw validation('A sales order must have at least one line.');
  }

  // Verify customer belongs to company.
  const [customer] = await ctx.db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.companyId, ctx.companyId), eq(customers.id, input.customerId)));
  if (!customer) throw notFound('Customer');

  // Compute per-line amounts.
  type ComputedLine = {
    itemId: string | null;
    description: string | null;
    quantity: string;
    rate: string;
    amount: string;
    lineOrder: number;
  };

  let subtotal = Money.zero();
  const computedLines: ComputedLine[] = [];

  for (let i = 0; i < input.lines.length; i++) {
    const l = input.lines[i];
    const qty = Money.of(l.quantity);
    const rate = Money.of(l.rate);
    if (qty.lessThanOrEqualTo(0)) throw validation(`Line ${i + 1}: quantity must be positive.`);
    if (rate.lessThan(0)) throw validation(`Line ${i + 1}: rate cannot be negative.`);

    const amount = Money.round2(Money.mul(qty, rate));
    subtotal = subtotal.plus(amount);

    computedLines.push({
      itemId: l.itemId ?? null,
      description: l.description ?? null,
      quantity: toAmountString(qty),
      rate: toAmountString(rate),
      amount: toAmountString(amount),
      lineOrder: i,
    });
  }

  const total = Money.round2(subtotal);

  return inTransaction(ctx, async (tx) => {
    const orderNumber = await nextOrderNumber(tx);

    const [order] = await tx.db
      .insert(salesOrders)
      .values({
        companyId: tx.companyId,
        customerId: input.customerId,
        orderNumber,
        date: input.date,
        status: 'open',
        subtotal: toAmountString(subtotal),
        total: toAmountString(total),
        memo: input.memo ?? null,
      })
      .returning();

    await tx.db.insert(salesOrderLines).values(
      computedLines.map((cl) => ({
        salesOrderId: order.id,
        itemId: cl.itemId,
        description: cl.description,
        quantity: cl.quantity,
        rate: cl.rate,
        amount: cl.amount,
        lineOrder: cl.lineOrder,
      })),
    );

    await writeAudit(tx, {
      action: 'create',
      entityType: 'sales_order',
      entityId: order.id,
      newValues: {
        orderNumber,
        customerId: input.customerId,
        total: toAmountString(total),
      },
    });

    return { ...order, lines: computedLines };
  });
}

// ---------------------------------------------------------------------------
// listSalesOrders
// ---------------------------------------------------------------------------

export async function listSalesOrders(ctx: ServiceContext) {
  return ctx.db
    .select()
    .from(salesOrders)
    .where(eq(salesOrders.companyId, ctx.companyId))
    .orderBy(salesOrders.orderNumber);
}

// ---------------------------------------------------------------------------
// getSalesOrder (with lines)
// ---------------------------------------------------------------------------

export async function getSalesOrder(ctx: ServiceContext, id: string) {
  const [order] = await ctx.db
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, ctx.companyId), eq(salesOrders.id, id)));
  if (!order) throw notFound('Sales order');

  const lines = await ctx.db
    .select()
    .from(salesOrderLines)
    .where(eq(salesOrderLines.salesOrderId, id))
    .orderBy(salesOrderLines.lineOrder);

  return { ...order, lines };
}

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------

export async function updateStatus(
  ctx: ServiceContext,
  id: string,
  status: 'open' | 'closed' | 'void',
) {
  const [order] = await ctx.db
    .select()
    .from(salesOrders)
    .where(and(eq(salesOrders.companyId, ctx.companyId), eq(salesOrders.id, id)));
  if (!order) throw notFound('Sales order');

  if (order.status === 'closed' && status !== 'closed') {
    throw new ServiceError('CONFLICT', 'Cannot reopen a closed (converted) sales order.');
  }

  const [updated] = await ctx.db
    .update(salesOrders)
    .set({ status })
    .where(eq(salesOrders.id, id))
    .returning();

  await writeAudit(ctx, {
    action: 'update',
    entityType: 'sales_order',
    entityId: id,
    oldValues: { status: order.status },
    newValues: { status },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// convertToInvoice
// ---------------------------------------------------------------------------

/**
 * Convert a sales order to an invoice:
 * 1. Validate the order is open and not already converted.
 * 2. Load the order lines.
 * 3. Call `createInvoice` (which posts the GL entry).
 * 4. Stamp convertedInvoiceId on the order and set status = 'closed'.
 * 5. Return the newly created invoice.
 */
export async function convertToInvoice(ctx: ServiceContext, salesOrderId: string) {
  // Invoice creation and order stamping must commit or roll back TOGETHER —
  // otherwise a failure after createInvoice leaves a posted GL invoice with the
  // order still open and convertible again (duplicate invoice + revenue).
  // Re-loading the order inside the transaction also closes the
  // read-then-write race between concurrent converts.
  return inTransaction(ctx, async (tx) => {
    const [order] = await tx.db
      .select()
      .from(salesOrders)
      .where(and(eq(salesOrders.companyId, tx.companyId), eq(salesOrders.id, salesOrderId)));
    if (!order) throw notFound('Sales order');

    if (order.status === 'closed' || order.convertedInvoiceId) {
      throw new ServiceError('CONFLICT', 'Sales order has already been converted to an invoice.');
    }
    if (order.status === 'void') {
      throw new ServiceError('CONFLICT', 'Cannot convert a voided sales order.');
    }

    const lines = await tx.db
      .select()
      .from(salesOrderLines)
      .where(eq(salesOrderLines.salesOrderId, salesOrderId))
      .orderBy(salesOrderLines.lineOrder);

    // Create the invoice — this does GL posting via postJournalEntry internally;
    // its internal inTransaction nests as a savepoint on this transaction.
    const invoice = await createInvoice(tx, {
      customerId: order.customerId,
      date: order.date,
      memo: order.memo,
      lines: lines.map((l) => ({
        itemId: l.itemId ?? null,
        description: l.description ?? null,
        quantity: l.quantity,
        rate: l.rate,
      })),
    });

    // Stamp the order as converted.
    await tx.db
      .update(salesOrders)
      .set({ status: 'closed', convertedInvoiceId: invoice.id })
      .where(eq(salesOrders.id, salesOrderId));

    await writeAudit(tx, {
      action: 'update',
      entityType: 'sales_order',
      entityId: salesOrderId,
      oldValues: { status: order.status, convertedInvoiceId: null },
      newValues: { status: 'closed', convertedInvoiceId: invoice.id },
    });

    return invoice;
  });
}
