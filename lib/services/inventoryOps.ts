/**
 * Inventory operations — reorder reporting, physical count adjustments, and low-stock counts.
 *
 * GL impact for physical count adjustments:
 *   Shrinkage (countedQty < currentQty, delta < 0):
 *     Dr 5900 Inventory Shrinkage (expense)   |delta| * averageCost
 *     Cr 1300 Inventory Asset                 |delta| * averageCost
 *
 *   Overage (countedQty > currentQty, delta > 0):
 *     Dr 1300 Inventory Asset                 delta * averageCost
 *     Cr 5900 Inventory Shrinkage (expense)   delta * averageCost
 *
 * The adjustment account defaults to code '5900' (get-or-create).
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { accounts, items } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import {
  type ServiceContext,
  ServiceError,
  inTransaction,
  notFound,
  validation,
  writeAudit,
} from './_base';
import { assertNotFifoTracked } from './inventory';
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

/**
 * Get-or-create the Inventory Shrinkage expense account (code '5900').
 * If the company already has one, returns it; otherwise inserts a new row.
 */
async function ensureShrinkageAccount(ctx: ServiceContext): Promise<string> {
  const [existing] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, '5900')));
  if (existing) return existing.id;

  const [created] = await ctx.db
    .insert(accounts)
    .values({
      companyId: ctx.companyId,
      code: '5900',
      name: 'Inventory Shrinkage',
      type: 'expense',
      subtype: 'operating_expenses',
      balance: '0',
    })
    .returning();
  return created.id;
}

/** Load an inventory-type item scoped to the company. Throws NOT_FOUND. */
async function loadInventoryItem(ctx: ServiceContext, itemId: string) {
  const [row] = await ctx.db
    .select()
    .from(items)
    .where(and(eq(items.companyId, ctx.companyId), eq(items.id, itemId)));
  if (!row) throw notFound('Item');
  return row;
}

// ---------------------------------------------------------------------------
// reorderReport
// ---------------------------------------------------------------------------

export interface ReorderReportRow {
  id: string;
  name: string;
  sku: string | null;
  quantityOnHand: string;
  reorderPoint: string;
  averageCost: string;
  /** Suggested reorder quantity = reorderPoint * 2 - quantityOnHand (at least 1). */
  suggestedReorderQty: string;
}

export interface ReorderReportResult {
  rows: ReorderReportRow[];
  count: number;
}

/**
 * Returns all inventory-type items where quantityOnHand <= reorderPoint
 * (and reorderPoint is set), with a suggested reorder quantity.
 */
export async function reorderReport(ctx: ServiceContext): Promise<ReorderReportResult> {
  const rows = await ctx.db
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      quantityOnHand: items.quantityOnHand,
      reorderPoint: items.reorderPoint,
      averageCost: items.averageCost,
    })
    .from(items)
    .where(
      and(
        eq(items.companyId, ctx.companyId),
        eq(items.type, 'inventory'),
        eq(items.isActive, true),
        isNotNull(items.reorderPoint),
      ),
    );

  const reportRows: ReorderReportRow[] = rows
    .filter((r) => {
      if (r.reorderPoint == null) return false;
      const qty = Money.of(r.quantityOnHand ?? '0');
      const reorder = Money.of(r.reorderPoint);
      return qty.lessThanOrEqualTo(reorder);
    })
    .map((r) => {
      const qty = Money.of(r.quantityOnHand ?? '0');
      const reorder = Money.of(r.reorderPoint!);
      // Suggest: (reorderPoint * 2) - quantityOnHand, floor to 4dp, minimum 1
      const suggested = Money.abs(reorder.times(2).minus(qty));
      const suggestedQty = suggested.lessThan(1) ? Money.of(1) : suggested;
      return {
        id: r.id,
        name: r.name,
        sku: r.sku ?? null,
        quantityOnHand: qty.toFixed(4),
        reorderPoint: reorder.toFixed(4),
        averageCost: Money.of(r.averageCost ?? '0').toFixed(4),
        suggestedReorderQty: suggestedQty.toFixed(4),
      };
    });

  return { rows: reportRows, count: reportRows.length };
}

// ---------------------------------------------------------------------------
// lowStockCount
// ---------------------------------------------------------------------------

/** Returns the count of inventory items where quantityOnHand <= reorderPoint. */
export async function lowStockCount(ctx: ServiceContext): Promise<number> {
  const result = await reorderReport(ctx);
  return result.count;
}

// ---------------------------------------------------------------------------
// physicalCount
// ---------------------------------------------------------------------------

export interface PhysicalCountInput {
  itemId: string;
  /** The actual counted quantity from the physical inventory count. */
  countedQty: string | number;
  date: Date;
  /**
   * The GL account to use for the adjustment offset.
   * Defaults to get-or-create '5900' Inventory Shrinkage.
   */
  adjustmentAccountId?: string | null;
}

export interface PhysicalCountResult {
  itemId: string;
  previousQty: string;
  countedQty: string;
  delta: string;
  glAmount: string;
  /** The journal entry posted for the adjustment, or null if delta was 0. */
  journalEntryId: string | null;
  adjustmentAccountId: string | null;
  updatedQty: string;
}

/**
 * Record a physical inventory count adjustment.
 *
 * delta = countedQty - currentQty
 *   - delta < 0 (shrinkage): Dr adjustmentAccount, Cr Inventory Asset
 *   - delta > 0 (overage):   Dr Inventory Asset, Cr adjustmentAccount
 *   - delta = 0: no GL posted, qty unchanged
 */
export async function physicalCount(
  ctx: ServiceContext,
  input: PhysicalCountInput,
): Promise<PhysicalCountResult> {
  const counted = Money.of(input.countedQty);
  if (counted.isNegative()) {
    throw validation('countedQty cannot be negative.');
  }

  const item = await loadInventoryItem(ctx, input.itemId);

  // Defense-in-depth: the API route already guards via assertPhysicalCountable,
  // but protect direct programmatic callers too. Physical counts are an
  // average-cost operation on stock-tracked items only.
  if (item.type !== 'inventory') {
    throw validation(
      `Physical counts can only be recorded for inventory-type items; "${item.name}" is type "${item.type}".`,
    );
  }
  await assertNotFifoTracked(ctx, item.id);

  const currentQty = Money.of(item.quantityOnHand ?? '0');
  const avgCost = Money.of(item.averageCost ?? '0');

  const delta = counted.minus(currentQty);
  const absDelta = delta.abs();

  // No change — update qty to match counted (no-op if equal) and return early
  if (delta.isZero()) {
    return {
      itemId: item.id,
      previousQty: currentQty.toFixed(4),
      countedQty: counted.toFixed(4),
      delta: '0.0000',
      glAmount: '0.00',
      journalEntryId: null,
      adjustmentAccountId: null,
      updatedQty: currentQty.toFixed(4),
    };
  }

  const glAmount = Money.round2(absDelta.times(avgCost));

  return inTransaction(ctx, async (tx) => {
    // Resolve the inventory asset account
    const inventoryAccountId = item.assetAccountId ?? (await accountIdByCode(tx, '1300'));

    // Resolve or create the adjustment account
    let adjustmentAccountId: string;
    if (input.adjustmentAccountId) {
      // Verify it belongs to this company
      const [adj] = await tx.db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.companyId, tx.companyId),
            eq(accounts.id, input.adjustmentAccountId),
          ),
        );
      if (!adj) throw notFound(`Adjustment account ${input.adjustmentAccountId}`);
      adjustmentAccountId = adj.id;
    } else {
      adjustmentAccountId = await ensureShrinkageAccount(tx);
    }

    // Build posting lines
    const amountStr = toAmountString(glAmount);
    const isShrinkage = delta.isNegative();

    const postingLines = isShrinkage
      ? [
          // Shrinkage: Dr Adjustment (Shrinkage expense), Cr Inventory
          {
            accountId: adjustmentAccountId,
            debit: amountStr,
            memo: `Physical count shrinkage — item ${item.name}`,
          },
          {
            accountId: inventoryAccountId,
            credit: amountStr,
            memo: `Physical count shrinkage — item ${item.name}`,
          },
        ]
      : [
          // Overage: Dr Inventory, Cr Adjustment (Shrinkage reversed)
          {
            accountId: inventoryAccountId,
            debit: amountStr,
            memo: `Physical count overage — item ${item.name}`,
          },
          {
            accountId: adjustmentAccountId,
            credit: amountStr,
            memo: `Physical count overage — item ${item.name}`,
          },
        ];

    const entry = await postJournalEntry(tx, {
      date: input.date,
      description: `Physical inventory count adjustment — ${item.name}`,
      lines: postingLines,
      sourceRef: `item:${input.itemId}`,
    });

    // Update the item's quantityOnHand to the counted qty
    await tx.db
      .update(items)
      .set({
        quantityOnHand: counted.toFixed(4),
        updatedAt: new Date(),
      })
      .where(eq(items.id, input.itemId));

    await writeAudit(tx, {
      action: 'update',
      entityType: 'item',
      entityId: input.itemId,
      oldValues: { quantityOnHand: item.quantityOnHand },
      newValues: {
        quantityOnHand: counted.toFixed(4),
        physicalCountDate: input.date.toISOString(),
        postedEntryId: entry.id,
      },
    });

    return {
      itemId: item.id,
      previousQty: currentQty.toFixed(4),
      countedQty: counted.toFixed(4),
      delta: delta.toFixed(4),
      glAmount: toAmountString(glAmount),
      journalEntryId: entry.id,
      adjustmentAccountId,
      updatedQty: counted.toFixed(4),
    };
  });
}
