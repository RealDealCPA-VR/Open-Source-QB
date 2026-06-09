/**
 * Inventory service — adjustments, COGS recording, valuation, and low-stock queries.
 *
 * GL impact for inventory events:
 *   Receive stock (qty+):
 *     Dr 1300 Inventory Asset      qty * unitCost
 *     Cr 3000 Owner's Equity       qty * unitCost   (opening/adjustment offset)
 *
 *   Remove stock / write-off (qty-):
 *     Dr 5000 COGS                 qty * averageCost
 *     Cr 1300 Inventory Asset      qty * averageCost
 *
 *   recordCOGS (triggered by sales):
 *     Dr 5000 COGS                 qty * averageCost
 *     Cr 1300 Inventory Asset      qty * averageCost
 *
 * averageCost is maintained as a weighted average: updated on positive receipts only.
 */
import { and, eq, sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { items, accounts, inventoryLayers } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import {
  type ServiceContext,
  ServiceError,
  inTransaction,
  notFound,
  validation,
  writeAudit,
} from './_base';

/**
 * Guard against costing-method mixing. The average-cost paths in this module (adjustInventory,
 * recordCOGS) must never operate on an item that is tracked under FIFO (fifo.ts is the only code
 * that maintains inventoryLayers). Doing so silently diverges quantityOnHand/GL from the FIFO
 * layer valuation and values COGS at a null/zero averageCost. Route FIFO items through fifo.ts.
 */
export async function assertNotFifoTracked(ctx: ServiceContext, itemId: string): Promise<void> {
  const [row] = await ctx.db
    .select({ cnt: sql<number>`count(*)` })
    .from(inventoryLayers)
    .where(and(eq(inventoryLayers.companyId, ctx.companyId), eq(inventoryLayers.itemId, itemId)));
  if (Number(row?.cnt ?? 0) > 0) {
    throw validation(
      'This item is FIFO-tracked; use the FIFO receive/consume endpoints rather than average-cost adjustments.',
    );
  }
}
import { postJournalEntry } from './posting';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Resolve an account id by code for the current company. Throws NOT_FOUND. */
async function accountIdByCode(ctx: ServiceContext, code: string): Promise<string> {
  const [row] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, code)));
  if (!row) throw notFound(`Account with code ${code}`);
  return row.id;
}

/** Load an item scoped to the company. Throws NOT_FOUND. */
async function loadItem(ctx: ServiceContext, itemId: string) {
  const [row] = await ctx.db
    .select()
    .from(items)
    .where(and(eq(items.companyId, ctx.companyId), eq(items.id, itemId)));
  if (!row) throw notFound('Item');
  return row;
}

/**
 * Precondition guard for physical inventory counts: the item must be a stock-
 * tracked ('inventory') item and must NOT be FIFO-tracked (physical counts are
 * an average-cost operation — they value the delta at averageCost and do not
 * touch inventoryLayers). Throws VALIDATION otherwise.
 */
export async function assertPhysicalCountable(ctx: ServiceContext, itemId: string): Promise<void> {
  const item = await loadItem(ctx, itemId);
  if (item.type !== 'inventory') {
    throw validation(
      `Physical counts can only be recorded for inventory-type items; "${item.name}" is type "${item.type}".`,
    );
  }
  await assertNotFifoTracked(ctx, itemId);
}

// ---------------------------------------------------------------------------
// setReorderPoint
// ---------------------------------------------------------------------------

/**
 * Set (or clear) an item's reorder point — the threshold that drives the
 * reorder report and low-stock alerts. Pass null to clear it.
 */
export async function setReorderPoint(
  ctx: ServiceContext,
  itemId: string,
  reorderPoint: string | number | null,
) {
  const before = await loadItem(ctx, itemId);

  let stored: string | null = null;
  if (reorderPoint != null && reorderPoint !== '') {
    let value: Decimal;
    try {
      value = Money.of(reorderPoint);
    } catch {
      throw validation(`reorderPoint must be a number (got "${reorderPoint}").`);
    }
    if (value.isNegative()) throw validation('reorderPoint cannot be negative.');
    stored = value.toFixed(4);
  }

  const [row] = await ctx.db
    .update(items)
    .set({ reorderPoint: stored, updatedAt: new Date() })
    .where(and(eq(items.companyId, ctx.companyId), eq(items.id, itemId)))
    .returning();

  await writeAudit(ctx, {
    action: 'update',
    entityType: 'item',
    entityId: itemId,
    oldValues: { reorderPoint: before.reorderPoint },
    newValues: { reorderPoint: stored },
  });

  return row;
}

// ---------------------------------------------------------------------------
// adjustInventory
// ---------------------------------------------------------------------------

export interface AdjustInventoryInput {
  itemId: string;
  /** Positive = receiving stock; negative = removing/writing off stock. */
  quantityChange: string | number;
  /**
   * Unit cost for the received units. Required for positive adjustments (receiving).
   * Ignored for negative adjustments (uses current averageCost).
   */
  unitCost?: string | number | null;
  date: Date;
  memo?: string | null;
}

export async function adjustInventory(ctx: ServiceContext, input: AdjustInventoryInput) {
  const qtyChange = Money.of(input.quantityChange);
  if (qtyChange.isZero()) throw validation('quantityChange cannot be zero.');

  await assertNotFifoTracked(ctx, input.itemId);
  const item = await loadItem(ctx, input.itemId);

  const currentQty = Money.of(item.quantityOnHand ?? '0');
  const currentAvgCost = Money.of(item.averageCost ?? '0');

  // --- Validate removal ---
  if (qtyChange.isNegative()) {
    const absQty = qtyChange.abs();
    if (absQty.greaterThan(currentQty)) {
      throw validation(
        `Cannot remove ${absQty.toFixed(4)} units; only ${currentQty.toFixed(4)} on hand.`,
      );
    }
    if (currentAvgCost.isZero() && !currentQty.isZero()) {
      // Allow zero-cost adjustments but warn via memo; do not block.
    }
  }

  // --- Determine GL amounts ---
  let glAmount: Decimal;
  let newQty: Decimal;
  let newAvgCost: Decimal;

  if (qtyChange.greaterThan(0)) {
    // Receiving stock
    if (input.unitCost == null) {
      throw validation('unitCost is required when receiving stock (quantityChange > 0).');
    }
    const unitCost = Money.of(input.unitCost);
    if (unitCost.isNegative()) throw validation('unitCost cannot be negative.');

    // Weighted-average cost: (oldQty * oldAvgCost + newQty * newCost) / (oldQty + newQty)
    const oldValue = currentQty.times(currentAvgCost);
    const newValue = qtyChange.times(unitCost);
    newQty = currentQty.plus(qtyChange);
    newAvgCost = newQty.isZero()
      ? unitCost
      : oldValue.plus(newValue).dividedBy(newQty);
    glAmount = Money.round2(qtyChange.times(unitCost));
  } else {
    // Removing stock — value at current average cost
    const absQty = qtyChange.abs();
    glAmount = Money.round2(absQty.times(currentAvgCost));
    newQty = currentQty.plus(qtyChange); // qtyChange is negative
    newAvgCost = currentAvgCost; // average cost unchanged on removals
  }

  return inTransaction(ctx, async (tx) => {
    // Resolve GL accounts
    // Inventory Asset is either item.assetAccountId or code 1300
    const inventoryAccountId = item.assetAccountId ?? (await accountIdByCode(tx, '1300'));
    const cogsAccountId = await accountIdByCode(tx, '5000');
    const offsetAccountId = await accountIdByCode(tx, '3000'); // Owner's Equity as adjustment offset

    // Build posting lines
    let postingLines: Array<{ accountId: string; debit?: string; credit?: string; memo?: string | null }>;

    if (qtyChange.greaterThan(0)) {
      // Dr Inventory Asset, Cr Owner's Equity (adjustment/opening offset)
      postingLines = [
        {
          accountId: inventoryAccountId,
          debit: toAmountString(glAmount),
          memo: input.memo ?? 'Inventory receipt',
        },
        {
          accountId: offsetAccountId,
          credit: toAmountString(glAmount),
          memo: input.memo ?? 'Inventory receipt offset',
        },
      ];
    } else {
      // Dr COGS, Cr Inventory Asset
      postingLines = [
        {
          accountId: cogsAccountId,
          debit: toAmountString(glAmount),
          memo: input.memo ?? 'Inventory removal',
        },
        {
          accountId: inventoryAccountId,
          credit: toAmountString(glAmount),
          memo: input.memo ?? 'Inventory removal',
        },
      ];
    }

    const entry = await postJournalEntry(tx, {
      date: input.date,
      description: input.memo ?? (qtyChange.greaterThan(0) ? 'Inventory receipt' : 'Inventory removal'),
      lines: postingLines,
      sourceRef: `item:${input.itemId}`,
    });

    // Update item quantities and average cost
    await tx.db
      .update(items)
      .set({
        quantityOnHand: newQty.toFixed(4),
        averageCost: newAvgCost.toFixed(4),
        updatedAt: new Date(),
      })
      .where(eq(items.id, input.itemId));

    await writeAudit(tx, {
      action: 'update',
      entityType: 'item',
      entityId: input.itemId,
      oldValues: {
        quantityOnHand: item.quantityOnHand,
        averageCost: item.averageCost,
      },
      newValues: {
        quantityOnHand: newQty.toFixed(4),
        averageCost: newAvgCost.toFixed(4),
        postedEntryId: entry.id,
      },
    });

    return {
      item: { id: input.itemId, quantityOnHand: newQty.toFixed(4), averageCost: newAvgCost.toFixed(4) },
      entry,
      glAmount: toAmountString(glAmount),
    };
  });
}

// ---------------------------------------------------------------------------
// recordCOGS — convenience helper called during sales (e.g. from invoices)
// ---------------------------------------------------------------------------

export interface RecordCOGSInput {
  itemId: string;
  quantity: string | number;
  date: Date;
  memo?: string | null;
}

export async function recordCOGS(ctx: ServiceContext, input: RecordCOGSInput) {
  const qty = Money.of(input.quantity);
  if (qty.lessThanOrEqualTo(0)) throw validation('quantity must be positive for COGS recording.');

  await assertNotFifoTracked(ctx, input.itemId);
  const item = await loadItem(ctx, input.itemId);
  const currentQty = Money.of(item.quantityOnHand ?? '0');
  const avgCost = Money.of(item.averageCost ?? '0');

  if (qty.greaterThan(currentQty)) {
    throw validation(
      `Cannot record COGS for ${qty.toFixed(4)} units; only ${currentQty.toFixed(4)} on hand.`,
    );
  }

  const cogsAmount = Money.round2(qty.times(avgCost));
  const newQty = currentQty.minus(qty);

  return inTransaction(ctx, async (tx) => {
    const inventoryAccountId = item.assetAccountId ?? (await accountIdByCode(tx, '1300'));
    const cogsAccountId = await accountIdByCode(tx, '5000');

    // Dr COGS, Cr Inventory Asset
    const entry = await postJournalEntry(tx, {
      date: input.date,
      description: input.memo ?? 'Cost of goods sold',
      lines: [
        {
          accountId: cogsAccountId,
          debit: toAmountString(cogsAmount),
          memo: input.memo ?? 'COGS',
        },
        {
          accountId: inventoryAccountId,
          credit: toAmountString(cogsAmount),
          memo: input.memo ?? 'COGS — inventory reduction',
        },
      ],
      sourceRef: `item:${input.itemId}`,
    });

    await tx.db
      .update(items)
      .set({
        quantityOnHand: newQty.toFixed(4),
        updatedAt: new Date(),
      })
      .where(eq(items.id, input.itemId));

    await writeAudit(tx, {
      action: 'update',
      entityType: 'item',
      entityId: input.itemId,
      oldValues: { quantityOnHand: item.quantityOnHand },
      newValues: { quantityOnHand: newQty.toFixed(4), postedEntryId: entry.id },
    });

    return {
      item: { id: input.itemId, quantityOnHand: newQty.toFixed(4), averageCost: avgCost.toFixed(4) },
      entry,
      cogsAmount: toAmountString(cogsAmount),
    };
  });
}

// ---------------------------------------------------------------------------
// inventoryValuation
// ---------------------------------------------------------------------------

export interface InventoryValuationRow {
  id: string;
  name: string;
  sku: string | null;
  quantityOnHand: string;
  /** For FIFO items this is the effective unit cost (layer value / layer qty). */
  averageCost: string;
  totalValue: string;
  costingMethod: 'fifo' | 'average';
}

export interface InventoryValuationResult {
  items: InventoryValuationRow[];
  grandTotal: string;
}

/**
 * Inventory valuation covering both costing methods so the grand total ties to
 * the GL inventory asset account:
 *   - FIFO-tracked items (those with inventoryLayers rows) are valued from
 *     their remaining layers: SUM(quantityRemaining * unitCost).
 *   - Average-cost items are valued at quantityOnHand * averageCost.
 * Only active, inventory-type items are included (services/bundles/non-inventory
 * items carry no stock value).
 */
export async function inventoryValuation(ctx: ServiceContext): Promise<InventoryValuationResult> {
  const rows = await ctx.db
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      quantityOnHand: items.quantityOnHand,
      averageCost: items.averageCost,
    })
    .from(items)
    .where(
      and(
        eq(items.companyId, ctx.companyId),
        eq(items.isActive, true),
        eq(items.type, 'inventory'),
      ),
    );

  // Aggregate remaining FIFO layers per item. Any item with layer rows is
  // FIFO-tracked (same detection assertNotFifoTracked uses).
  const layerAgg = await ctx.db
    .select({
      itemId: inventoryLayers.itemId,
      layerQty: sql<string>`COALESCE(SUM(${inventoryLayers.quantityRemaining}), 0)`,
      layerValue: sql<string>`COALESCE(SUM(${inventoryLayers.quantityRemaining} * ${inventoryLayers.unitCost}), 0)`,
    })
    .from(inventoryLayers)
    .where(eq(inventoryLayers.companyId, ctx.companyId))
    .groupBy(inventoryLayers.itemId);
  const fifoByItem = new Map(layerAgg.map((r) => [r.itemId, r]));

  let grandTotal = Money.zero();
  const valuationRows: InventoryValuationRow[] = rows.map((r) => {
    const fifo = fifoByItem.get(r.id);

    if (fifo) {
      const qty = Money.of(fifo.layerQty ?? '0');
      const total = Money.round2(Money.of(fifo.layerValue ?? '0'));
      const effectiveUnitCost = qty.isZero() ? Money.zero() : total.dividedBy(qty);
      grandTotal = grandTotal.plus(total);
      return {
        id: r.id,
        name: r.name,
        sku: r.sku ?? null,
        quantityOnHand: qty.toFixed(4),
        averageCost: effectiveUnitCost.toFixed(4),
        totalValue: toAmountString(total),
        costingMethod: 'fifo' as const,
      };
    }

    const qty = Money.of(r.quantityOnHand ?? '0');
    const avg = Money.of(r.averageCost ?? '0');
    const total = Money.round2(qty.times(avg));
    grandTotal = grandTotal.plus(total);
    return {
      id: r.id,
      name: r.name,
      sku: r.sku ?? null,
      quantityOnHand: qty.toFixed(4),
      averageCost: avg.toFixed(4),
      totalValue: toAmountString(total),
      costingMethod: 'average' as const,
    };
  });

  return {
    items: valuationRows,
    grandTotal: toAmountString(grandTotal),
  };
}

// ---------------------------------------------------------------------------
// lowStock
// ---------------------------------------------------------------------------

export async function lowStock(ctx: ServiceContext) {
  const rows = await ctx.db
    .select()
    .from(items)
    .where(and(eq(items.companyId, ctx.companyId), eq(items.isActive, true)));

  return rows.filter((r) => {
    if (r.reorderPoint == null) return false;
    const qty = Money.of(r.quantityOnHand ?? '0');
    const reorder = Money.of(r.reorderPoint);
    return qty.lessThanOrEqualTo(reorder);
  });
}
