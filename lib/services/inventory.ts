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
import { and, eq } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { items, accounts } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import {
  type ServiceContext,
  ServiceError,
  inTransaction,
  notFound,
  validation,
  writeAudit,
} from './_base';
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
  averageCost: string;
  totalValue: string;
}

export interface InventoryValuationResult {
  items: InventoryValuationRow[];
  grandTotal: string;
}

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
    .where(and(eq(items.companyId, ctx.companyId), eq(items.isActive, true)));

  let grandTotal = Money.zero();
  const valuationRows: InventoryValuationRow[] = rows.map((r) => {
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
