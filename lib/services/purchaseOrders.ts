/**
 * Purchase Orders service.
 *
 * A Purchase Order is a pre-purchase commitment sent to a vendor. It does NOT
 * post to the GL — POs are off-balance-sheet until goods/services are received
 * and a bill is created.
 *
 * Status flow:
 *   open  →  partial  (via convertToBill with per-line quantities — some qty unbilled)
 *   open / partial  →  closed   (via convertToBill once every line is fully billed,
 *                                or manually via updateStatus)
 *   open  →  void     (via updateStatus; blocked once anything has been billed)
 *
 * Conversion / partial billing:
 *   convertToBill(ctx, poId, opts?) bills the PO (default: every line's full
 *   remaining quantity; or per-line quantities via opts.lines). Item lines pass
 *   itemId/quantity/unitCost through to createBill so inventory items receive
 *   stock (perpetual inventory). purchaseOrderLines.quantityBilled tracks how
 *   much of each line has been pulled onto bills; multiple bills per PO are
 *   supported. Idempotency / over-billing is enforced by a guarded conditional
 *   UPDATE on quantityBilled inside the transaction. convertedBillId is stamped
 *   with the bill that completes (closes) the PO.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { purchaseOrders, purchaseOrderLines, vendors } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import { createBill } from '@/lib/services/bills';
import {
  type ServiceContext,
  ServiceError,
  inTransaction,
  notFound,
  validation,
  writeAudit,
} from './_base';

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface PurchaseOrderLineInput {
  /** Item being ordered — passes through to the bill (inventory items receive stock). */
  itemId?: string | null;
  /**
   * GL account to debit when the PO is billed (expense / asset).
   * Required unless itemId is set (item lines route via the item's accounts).
   */
  accountId?: string | null;
  description?: string | null;
  quantity: string | number;
  rate: string | number;
}

export interface CreatePurchaseOrderInput {
  vendorId: string;
  date: Date;
  expectedDate?: Date | null;
  lines: PurchaseOrderLineInput[];
  memo?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function nextPoNumber(ctx: ServiceContext): Promise<number> {
  const [row] = await ctx.db
    .select({ max: sql<number>`COALESCE(MAX(${purchaseOrders.poNumber}), 0)` })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.companyId, ctx.companyId));
  return (row?.max ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// createPurchaseOrder
// ---------------------------------------------------------------------------

export async function createPurchaseOrder(
  ctx: ServiceContext,
  input: CreatePurchaseOrderInput,
) {
  if (!input.lines || input.lines.length === 0) {
    throw validation('A purchase order must have at least one line.');
  }

  // Verify vendor belongs to this company.
  const [vendor] = await ctx.db
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.id, input.vendorId), eq(vendors.companyId, ctx.companyId)));
  if (!vendor) throw notFound('Vendor');

  // Compute per-line amounts using safe decimal math.
  type ComputedLine = {
    itemId: string | null;
    accountId: string | null;
    description: string | null;
    quantity: string;
    rate: string;
    amount: string;
    lineOrder: number;
  };

  let total = Money.zero();
  const computedLines: ComputedLine[] = [];

  for (let i = 0; i < input.lines.length; i++) {
    const l = input.lines[i];
    const qty = Money.of(l.quantity);
    const rate = Money.of(l.rate);
    if (qty.lessThanOrEqualTo(0)) throw validation(`Line ${i + 1}: quantity must be positive.`);
    if (rate.lessThan(0)) throw validation(`Line ${i + 1}: rate cannot be negative.`);
    if (!l.accountId && !l.itemId) {
      throw validation(`Line ${i + 1}: select an account or an item.`);
    }

    const amount = Money.round2(Money.mul(qty, rate));
    total = total.plus(amount);

    computedLines.push({
      itemId: l.itemId ?? null,
      accountId: l.accountId ?? null,
      description: l.description ?? null,
      quantity: toAmountString(qty),
      rate: toAmountString(rate),
      amount: toAmountString(amount),
      lineOrder: i,
    });
  }

  const totalStr = toAmountString(total);

  return inTransaction(ctx, async (tx) => {
    const poNumber = await nextPoNumber(tx);

    const [po] = await tx.db
      .insert(purchaseOrders)
      .values({
        companyId: tx.companyId,
        vendorId: input.vendorId,
        poNumber,
        date: input.date,
        expectedDate: input.expectedDate ?? null,
        status: 'open',
        total: totalStr,
        memo: input.memo ?? null,
      })
      .returning();

    await tx.db.insert(purchaseOrderLines).values(
      computedLines.map((cl) => ({
        purchaseOrderId: po.id,
        itemId: cl.itemId,
        accountId: cl.accountId,
        description: cl.description,
        quantity: cl.quantity,
        rate: cl.rate,
        amount: cl.amount,
        lineOrder: cl.lineOrder,
      })),
    );

    await writeAudit(tx, {
      action: 'create',
      entityType: 'purchase_order',
      entityId: po.id,
      newValues: { poNumber, vendorId: input.vendorId, total: totalStr },
    });

    return { ...po, lines: computedLines };
  });
}

// ---------------------------------------------------------------------------
// listPurchaseOrders
// ---------------------------------------------------------------------------

export async function listPurchaseOrders(
  ctx: ServiceContext,
  opts?: { vendorId?: string; status?: string },
) {
  const conditions = [eq(purchaseOrders.companyId, ctx.companyId)];
  if (opts?.vendorId) conditions.push(eq(purchaseOrders.vendorId, opts.vendorId));
  if (opts?.status) conditions.push(eq(purchaseOrders.status, opts.status as never));

  return ctx.db
    .select()
    .from(purchaseOrders)
    .where(and(...conditions))
    .orderBy(desc(purchaseOrders.date), asc(purchaseOrders.poNumber));
}

// ---------------------------------------------------------------------------
// getPurchaseOrder (header + lines)
// ---------------------------------------------------------------------------

export async function getPurchaseOrder(ctx: ServiceContext, id: string) {
  const [po] = await ctx.db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.companyId, ctx.companyId)));
  if (!po) throw notFound('Purchase order');

  const lines = await ctx.db
    .select()
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, id))
    .orderBy(asc(purchaseOrderLines.lineOrder));

  return { ...po, lines };
}

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------

export async function updateStatus(
  ctx: ServiceContext,
  id: string,
  status: 'open' | 'closed' | 'void',
) {
  const [po] = await ctx.db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.companyId, ctx.companyId)));
  if (!po) throw notFound('Purchase order');

  if (po.status === 'closed' && status !== 'closed') {
    throw new ServiceError(
      'CONFLICT',
      'Cannot reopen a closed (converted) purchase order.',
    );
  }

  if (po.status === 'partial' && status === 'open') {
    throw new ServiceError(
      'CONFLICT',
      'Cannot mark a partially billed purchase order as open — its billed quantities already track the open balance.',
    );
  }

  if (po.status === 'partial' && status === 'void') {
    throw new ServiceError(
      'CONFLICT',
      'Cannot void a partially billed purchase order. Close it instead to stop further billing.',
    );
  }

  const [updated] = await ctx.db
    .update(purchaseOrders)
    .set({ status })
    .where(eq(purchaseOrders.id, id))
    .returning();

  await writeAudit(ctx, {
    action: 'update',
    entityType: 'purchase_order',
    entityId: id,
    oldValues: { status: po.status },
    newValues: { status },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// convertToBill
// ---------------------------------------------------------------------------

/** A per-line billing request for partial PO billing. */
export interface ConvertToBillLineInput {
  /** purchaseOrderLines.id to bill from. */
  lineId: string;
  /** Quantity to bill now (> 0 and ≤ the line's remaining unbilled quantity). */
  quantity: string | number;
}

export interface ConvertToBillOptions {
  /**
   * Per-line quantities to bill. Lines omitted from the array are not billed.
   * When undefined, every line is billed at its full remaining quantity
   * (legacy full-convert behaviour).
   */
  lines?: ConvertToBillLineInput[];
  /** Bill date — defaults to the PO date. */
  date?: Date;
  /** Vendor bill / reference number for the created bill. */
  billNumber?: string | null;
}

/**
 * Bill a purchase order (fully or partially) — atomically:
 * 1. Validate the PO is billable (not void, not closed) and resolve the billing
 *    plan: requested per-line quantities, or every line's remaining quantity.
 * 2. Inside ONE transaction:
 *    a. Claim each billed line via a guarded conditional UPDATE that increments
 *       quantityBilled only while quantityBilled + qty ≤ quantity. Zero rows
 *       back means a concurrent bill consumed the quantity — throw CONFLICT.
 *       This per-line quantity guard is the idempotency / over-billing guard
 *       (multiple bills per PO are now allowed, so the old single-shot
 *       convertedBillId claim no longer applies).
 *    b. Call `createBill` with the tx context (posts the A/P GL entry in the
 *       same transaction via a savepoint). Item lines pass itemId + quantity +
 *       unitCost through so inventory items receive stock perpetually.
 *    c. Recompute the PO status: 'closed' when every line is fully billed
 *       (stamping convertedBillId with the closing bill), else 'partial'.
 * Any failure rolls back the line claims, the bill, and the GL entry together,
 * so a crash mid-conversion can never leave a posted bill with stale PO
 * quantities (and re-running convert can never double-post A/P).
 */
export async function convertToBill(
  ctx: ServiceContext,
  poId: string,
  opts?: ConvertToBillOptions,
) {
  const [po] = await ctx.db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.companyId, ctx.companyId)));
  if (!po) throw notFound('Purchase order');

  if (po.status === 'closed') {
    throw new ServiceError('CONFLICT', 'Purchase order has already been fully billed.');
  }
  if (po.status === 'void') {
    throw new ServiceError('CONFLICT', 'Cannot convert a voided purchase order.');
  }

  const lines = await ctx.db
    .select()
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, poId))
    .orderBy(asc(purchaseOrderLines.lineOrder));

  if (lines.length === 0) {
    throw validation('Purchase order has no lines to convert.');
  }

  const remainingOf = (l: (typeof lines)[number]) =>
    Money.of(l.quantity).minus(Money.of(l.quantityBilled ?? '0'));

  // --- Resolve the billing plan -------------------------------------------
  type PlanEntry = { line: (typeof lines)[number]; qty: ReturnType<typeof Money.of> };
  const plan: PlanEntry[] = [];

  if (opts?.lines && opts.lines.length > 0) {
    const lineById = new Map(lines.map((l) => [l.id, l]));
    const seen = new Set<string>();
    for (const [i, req] of opts.lines.entries()) {
      const line = lineById.get(req.lineId);
      if (!line) {
        throw validation(`Billing line ${i + 1}: purchase order line not found.`);
      }
      if (seen.has(req.lineId)) {
        throw validation(`Billing line ${i + 1}: duplicate purchase order line.`);
      }
      seen.add(req.lineId);

      const qty = Money.of(req.quantity);
      if (qty.lessThanOrEqualTo(0)) {
        throw validation(`Billing line ${i + 1}: quantity must be positive.`);
      }
      const remaining = remainingOf(line);
      if (qty.greaterThan(remaining)) {
        throw validation(
          `Billing line ${i + 1}: only ${remaining.toFixed(4)} remaining unbilled ` +
            `(ordered ${Money.of(line.quantity).toFixed(4)}, ` +
            `billed ${Money.of(line.quantityBilled ?? '0').toFixed(4)}).`,
        );
      }
      plan.push({ line, qty });
    }
  } else {
    // Default: bill the full remaining quantity of every line.
    for (const line of lines) {
      const remaining = remainingOf(line);
      if (remaining.greaterThan(0)) plan.push({ line, qty: remaining });
    }
  }

  if (plan.length === 0) {
    throw new ServiceError('CONFLICT', 'Purchase order has no unbilled quantity remaining.');
  }

  // --- Map the plan to bill lines (item passthrough → perpetual inventory) --
  const billLineInputs = plan.map(({ line, qty }, i) => {
    if (!line.itemId && !line.accountId) {
      throw validation(
        `Purchase order line ${i + 1} has no account or item; cannot convert to bill.`,
      );
    }
    const amount = toAmountString(Money.round2(Money.mul(qty, line.rate)));
    return line.itemId
      ? {
          // Item line: createBill routes the debit via the item (inventory items
          // go Dr Inventory Asset and receive stock in the same transaction).
          itemId: line.itemId,
          accountId: line.accountId ?? null,
          description: line.description ?? null,
          quantity: qty.toFixed(4),
          unitCost: line.rate,
          amount,
        }
      : {
          accountId: line.accountId,
          description: line.description ?? null,
          quantity: qty.toFixed(4),
          amount,
        };
  });

  return inTransaction(ctx, async (tx) => {
    // Claim each line's quantity with a guarded conditional UPDATE. If a
    // concurrent conversion already consumed the quantity, zero rows come back
    // and we bail without posting anything.
    for (const { line, qty } of plan) {
      const qtyStr = qty.toFixed(4);
      const claimed = await tx.db
        .update(purchaseOrderLines)
        .set({
          quantityBilled: sql`${purchaseOrderLines.quantityBilled} + ${qtyStr}::numeric`,
        })
        .where(
          and(
            eq(purchaseOrderLines.id, line.id),
            eq(purchaseOrderLines.purchaseOrderId, poId),
            sql`${purchaseOrderLines.quantityBilled} + ${qtyStr}::numeric <= ${purchaseOrderLines.quantity}`,
          ),
        )
        .returning({ id: purchaseOrderLines.id });
      if (claimed.length === 0) {
        throw new ServiceError(
          'CONFLICT',
          'Purchase order quantities were billed by another transaction. Reload and retry.',
        );
      }
    }

    // Passing the tx context means the bill + GL entry post inside this
    // transaction (createBill's own inTransaction becomes a savepoint).
    const bill = await createBill(tx, {
      vendorId: po.vendorId,
      billNumber: opts?.billNumber ?? null,
      date: opts?.date ?? po.date,
      dueDate: po.expectedDate ?? null,
      memo: po.memo,
      lines: billLineInputs,
    });

    // Recompute PO status from the post-claim line quantities.
    const refreshed = await tx.db
      .select({
        quantity: purchaseOrderLines.quantity,
        quantityBilled: purchaseOrderLines.quantityBilled,
      })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.purchaseOrderId, poId));
    const fullyBilled = refreshed.every(
      (l) => !Money.of(l.quantity).minus(Money.of(l.quantityBilled ?? '0')).greaterThan(0),
    );
    const newStatus = fullyBilled ? ('closed' as const) : ('partial' as const);

    await tx.db
      .update(purchaseOrders)
      .set({
        status: newStatus,
        // Stamp the bill that completes the PO (legacy full-convert semantics);
        // earlier partial bills are linked via quantityBilled + the audit trail.
        ...(fullyBilled && !po.convertedBillId ? { convertedBillId: bill.id } : {}),
      })
      .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.companyId, tx.companyId)));

    await writeAudit(tx, {
      action: 'update',
      entityType: 'purchase_order',
      entityId: poId,
      oldValues: { status: po.status },
      newValues: {
        status: newStatus,
        billId: bill.id,
        billedQuantities: plan.map(({ line, qty }) => ({
          lineId: line.id,
          quantity: qty.toFixed(4),
        })),
      },
    });

    return bill;
  });
}
