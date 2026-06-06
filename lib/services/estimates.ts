/**
 * Estimates (Quotes) service.
 *
 * Estimates represent a price quote to a customer. They do NOT post to the GL —
 * they are pre-sales documents only. An estimate can be:
 *   - draft     → initial state
 *   - accepted  → customer agreed to the quote
 *   - rejected  → customer declined
 *   - closed    → converted into an invoice (convertedInvoiceId is set)
 *
 * `convertToInvoice` is the only mutation that touches the GL, and it does so
 * by delegating entirely to `createInvoice` from the invoices service.
 */
import { and, eq, sql } from 'drizzle-orm';
import { Money, toAmountString } from '@/lib/money';
import { estimates, estimateLines, customers } from '@/lib/db/schema';
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

export interface EstimateLineInput {
  itemId?: string | null;
  description?: string | null;
  quantity: string | number;
  rate: string | number;
  /** Defaults to true. */
  taxable?: boolean;
}

export interface CreateEstimateInput {
  customerId: string;
  date: Date;
  expirationDate?: Date | null;
  lines: EstimateLineInput[];
  memo?: string | null;
}

export type EstimateStatus = 'draft' | 'accepted' | 'rejected' | 'closed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function nextEstimateNumber(ctx: ServiceContext): Promise<number> {
  const [row] = await ctx.db
    .select({ max: sql<number>`COALESCE(MAX(${estimates.estimateNumber}), 0)` })
    .from(estimates)
    .where(eq(estimates.companyId, ctx.companyId));
  return (row?.max ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// createEstimate
// ---------------------------------------------------------------------------

export async function createEstimate(ctx: ServiceContext, input: CreateEstimateInput) {
  if (!input.lines || input.lines.length === 0) {
    throw validation('An estimate must have at least one line.');
  }

  // Verify customer belongs to this company.
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
    taxable: boolean;
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
      taxable: l.taxable !== false,
      lineOrder: i,
    });
  }

  // Tax is $0 for now (no taxRateId on estimates).
  const taxAmount = Money.zero();
  const total = subtotal.plus(taxAmount);

  return inTransaction(ctx, async (tx) => {
    const estimateNumber = await nextEstimateNumber(tx);

    const [estimate] = await tx.db
      .insert(estimates)
      .values({
        companyId: tx.companyId,
        customerId: input.customerId,
        estimateNumber,
        date: input.date,
        expirationDate: input.expirationDate ?? null,
        status: 'draft',
        subtotal: toAmountString(subtotal),
        taxAmount: toAmountString(taxAmount),
        total: toAmountString(total),
        memo: input.memo ?? null,
      })
      .returning();

    await tx.db.insert(estimateLines).values(
      computedLines.map((cl) => ({
        estimateId: estimate.id,
        itemId: cl.itemId,
        description: cl.description,
        quantity: cl.quantity,
        rate: cl.rate,
        amount: cl.amount,
        taxable: cl.taxable,
        lineOrder: cl.lineOrder,
      })),
    );

    await writeAudit(tx, {
      action: 'create',
      entityType: 'estimate',
      entityId: estimate.id,
      newValues: { estimateNumber, customerId: input.customerId, total: toAmountString(total) },
    });

    return { ...estimate, lines: computedLines };
  });
}

// ---------------------------------------------------------------------------
// listEstimates
// ---------------------------------------------------------------------------

export async function listEstimates(ctx: ServiceContext) {
  return ctx.db
    .select()
    .from(estimates)
    .where(eq(estimates.companyId, ctx.companyId))
    .orderBy(estimates.estimateNumber);
}

// ---------------------------------------------------------------------------
// getEstimate (with lines)
// ---------------------------------------------------------------------------

export async function getEstimate(ctx: ServiceContext, id: string) {
  const [estimate] = await ctx.db
    .select()
    .from(estimates)
    .where(and(eq(estimates.companyId, ctx.companyId), eq(estimates.id, id)));
  if (!estimate) throw notFound('Estimate');

  const lines = await ctx.db
    .select()
    .from(estimateLines)
    .where(eq(estimateLines.estimateId, id))
    .orderBy(estimateLines.lineOrder);

  return { ...estimate, lines };
}

// ---------------------------------------------------------------------------
// updateEstimateStatus
// ---------------------------------------------------------------------------

export async function updateEstimateStatus(
  ctx: ServiceContext,
  id: string,
  status: EstimateStatus,
) {
  const [estimate] = await ctx.db
    .select()
    .from(estimates)
    .where(and(eq(estimates.companyId, ctx.companyId), eq(estimates.id, id)));
  if (!estimate) throw notFound('Estimate');

  if (estimate.status === 'closed') {
    throw new ServiceError('CONFLICT', 'Cannot change the status of a closed (converted) estimate.');
  }

  const allowed: EstimateStatus[] = ['draft', 'accepted', 'rejected'];
  if (!allowed.includes(status)) {
    throw validation(`Invalid status "${status}". Allowed: ${allowed.join(', ')}.`);
  }

  return inTransaction(ctx, async (tx) => {
    const [updated] = await tx.db
      .update(estimates)
      .set({ status, updatedAt: new Date() })
      .where(eq(estimates.id, id))
      .returning();

    await writeAudit(tx, {
      action: 'update',
      entityType: 'estimate',
      entityId: id,
      oldValues: { status: estimate.status },
      newValues: { status },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// convertToInvoice
// ---------------------------------------------------------------------------

/**
 * Convert an estimate into an invoice.
 *
 * - Loads the estimate + its lines.
 * - Calls createInvoice (which posts the A/R journal entry).
 * - Stamps estimates.convertedInvoiceId and sets status to 'closed'.
 * - Returns the new invoice.
 */
export async function convertToInvoice(ctx: ServiceContext, estimateId: string) {
  const estimate = await getEstimate(ctx, estimateId);

  if (estimate.status === 'closed') {
    throw new ServiceError('CONFLICT', 'Estimate has already been converted to an invoice.');
  }
  if (estimate.status === 'rejected') {
    throw new ServiceError('CONFLICT', 'Cannot convert a rejected estimate to an invoice.');
  }

  // Map estimate lines to invoice line inputs.
  const invoiceLines = estimate.lines.map((l) => ({
    itemId: l.itemId ?? null,
    description: l.description ?? null,
    quantity: l.quantity,
    rate: l.rate,
    taxable: l.taxable,
  }));

  // createInvoice runs inside its own transaction and posts the GL entry.
  const invoice = await createInvoice(ctx, {
    customerId: estimate.customerId,
    date: new Date(),
    lines: invoiceLines,
    memo: estimate.memo ?? undefined,
  });

  // Stamp the estimate as closed with the invoice reference.
  await inTransaction(ctx, async (tx) => {
    await tx.db
      .update(estimates)
      .set({
        status: 'closed',
        convertedInvoiceId: invoice.id,
        updatedAt: new Date(),
      })
      .where(eq(estimates.id, estimateId));

    await writeAudit(tx, {
      action: 'update',
      entityType: 'estimate',
      entityId: estimateId,
      oldValues: { status: estimate.status },
      newValues: { status: 'closed', convertedInvoiceId: invoice.id },
    });
  });

  return invoice;
}
