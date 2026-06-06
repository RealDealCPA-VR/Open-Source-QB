/**
 * Assemblies / Bill of Materials service.
 *
 * An "assembly" is an inventory item whose stock is built from component items.
 * QuickBooks Desktop calls these "Assembly Items".
 *
 * --- GL treatment for buildAssembly / unbuildAssembly ---
 *
 * Both sides of the transaction live in account 1300 (Inventory Asset):
 *   - Component items DECREASE in value  (their qty * averageCost moves out)
 *   - Assembly item   INCREASES in value (receives that same total cost)
 *
 * Net impact on account 1300 = $0.  A Dr 1300 / Cr 1300 journal entry would be
 * a zero-net wash that adds noise to the GL without changing any balance.
 * Therefore we skip GL posting entirely for assembly builds and instead update
 * item-level quantities and averageCost directly — consistent with how
 * QuickBooks handles assembly builds when the BOM only moves inventory between
 * items on the same asset account.
 *
 * If your chart of accounts uses SEPARATE asset accounts per item, you would
 * need per-account postings; this service intentionally keeps it simple and
 * mirrors the common single-account approach.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { assemblyComponents, items } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import {
  type ServiceContext,
  inTransaction,
  notFound,
  validation,
  writeAudit,
} from './_base';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BomComponent {
  componentItemId: string;
  quantity: string | number;
}

export interface BomRow {
  id: string;
  componentItemId: string;
  componentName: string;
  componentSku: string | null;
  quantity: string;
}

export interface BuildInput {
  assemblyItemId: string;
  /** Number of finished assemblies to build (must be > 0). */
  quantity: string | number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function loadItem(ctx: ServiceContext, itemId: string) {
  const [row] = await ctx.db
    .select()
    .from(items)
    .where(and(eq(items.companyId, ctx.companyId), eq(items.id, itemId)));
  if (!row) throw notFound('Item');
  return row;
}

// ---------------------------------------------------------------------------
// setBom — replace the entire BOM for an assembly item
// ---------------------------------------------------------------------------

/**
 * Replace the bill of materials for an assembly item.
 *
 * Rules:
 *   - assemblyItemId must belong to ctx.companyId.
 *   - Every componentItemId must belong to ctx.companyId.
 *   - A component cannot be the assembly itself (self-reference).
 *   - Duplicate componentItemIds in the input are rejected.
 *   - All quantities must be > 0.
 */
export async function setBom(
  ctx: ServiceContext,
  assemblyItemId: string,
  components: BomComponent[],
): Promise<BomRow[]> {
  // Validate the assembly item belongs to this company
  await loadItem(ctx, assemblyItemId);

  if (!components || components.length === 0) {
    // Empty BOM — clear it
    return inTransaction(ctx, async (tx) => {
      await tx.db
        .delete(assemblyComponents)
        .where(
          and(
            eq(assemblyComponents.companyId, tx.companyId),
            eq(assemblyComponents.assemblyItemId, assemblyItemId),
          ),
        );
      await writeAudit(tx, {
        action: 'update',
        entityType: 'assembly_bom',
        entityId: assemblyItemId,
        newValues: { components: [] },
      });
      return [];
    });
  }

  // Validate no self-reference
  for (const c of components) {
    if (c.componentItemId === assemblyItemId) {
      throw validation('An assembly item cannot be a component of itself.');
    }
  }

  // Validate no duplicate component IDs
  const componentIds = components.map((c) => c.componentItemId);
  const unique = new Set(componentIds);
  if (unique.size !== componentIds.length) {
    throw validation('Duplicate component items in BOM are not allowed.');
  }

  // Validate all quantities > 0
  for (const c of components) {
    const qty = Money.of(c.quantity);
    if (!qty.greaterThan(0)) {
      throw validation(`Component quantity must be greater than zero (got ${c.quantity}).`);
    }
  }

  // Validate all component items belong to this company
  const componentRows = await ctx.db
    .select({ id: items.id, name: items.name, sku: items.sku })
    .from(items)
    .where(and(eq(items.companyId, ctx.companyId), inArray(items.id, componentIds)));

  const componentMap = new Map(componentRows.map((r) => [r.id, r]));
  for (const c of components) {
    if (!componentMap.has(c.componentItemId)) {
      throw notFound(`Component item ${c.componentItemId}`);
    }
  }

  return inTransaction(ctx, async (tx) => {
    // Delete old BOM rows for this assembly
    await tx.db
      .delete(assemblyComponents)
      .where(
        and(
          eq(assemblyComponents.companyId, tx.companyId),
          eq(assemblyComponents.assemblyItemId, assemblyItemId),
        ),
      );

    // Insert new BOM rows
    const inserted = await tx.db
      .insert(assemblyComponents)
      .values(
        components.map((c) => ({
          companyId: tx.companyId,
          assemblyItemId,
          componentItemId: c.componentItemId,
          quantity: Money.of(c.quantity).toFixed(4),
        })),
      )
      .returning();

    await writeAudit(tx, {
      action: 'update',
      entityType: 'assembly_bom',
      entityId: assemblyItemId,
      newValues: { components: components.map((c) => ({ ...c, quantity: Money.of(c.quantity).toFixed(4) })) },
    });

    return inserted.map((row) => {
      const comp = componentMap.get(row.componentItemId)!;
      return {
        id: row.id,
        componentItemId: row.componentItemId,
        componentName: comp.name,
        componentSku: comp.sku ?? null,
        quantity: row.quantity,
      };
    });
  });
}

// ---------------------------------------------------------------------------
// getBom — fetch the current BOM
// ---------------------------------------------------------------------------

export async function getBom(ctx: ServiceContext, assemblyItemId: string): Promise<BomRow[]> {
  // Ensure assembly belongs to company
  await loadItem(ctx, assemblyItemId);

  const rows = await ctx.db
    .select({
      id: assemblyComponents.id,
      componentItemId: assemblyComponents.componentItemId,
      quantity: assemblyComponents.quantity,
      componentName: items.name,
      componentSku: items.sku,
    })
    .from(assemblyComponents)
    .innerJoin(items, eq(assemblyComponents.componentItemId, items.id))
    .where(
      and(
        eq(assemblyComponents.companyId, ctx.companyId),
        eq(assemblyComponents.assemblyItemId, assemblyItemId),
      ),
    );

  return rows.map((r) => ({
    id: r.id,
    componentItemId: r.componentItemId,
    componentName: r.componentName,
    componentSku: r.componentSku ?? null,
    quantity: r.quantity,
  }));
}

// ---------------------------------------------------------------------------
// buildAssembly — consume components, produce finished assemblies
// ---------------------------------------------------------------------------

/**
 * Build `quantity` units of the assembly.
 *
 * For each BOM component:
 *   - Requires quantityOnHand >= quantity * componentQty
 *   - Reduces component quantityOnHand by quantity * componentQty
 *   - Adds component cost (componentQty * averageCost) to the running total
 *
 * Updates assembly item:
 *   - Increases quantityOnHand by `quantity`
 *   - Sets averageCost = totalComponentCost / quantity  (weighted into existing stock)
 *
 * GL: No journal entry is posted. Both sides are account 1300 (Inventory Asset),
 * so the net GL impact is $0.  Moving the cost between items is captured in the
 * item-level averageCost and quantityOnHand fields, which drive the inventory
 * valuation report. An audit log entry documents the build for traceability.
 */
export async function buildAssembly(
  ctx: ServiceContext,
  input: BuildInput,
): Promise<{
  assemblyItemId: string;
  quantityBuilt: string;
  totalCost: string;
  newAssemblyQty: string;
  newAssemblyAvgCost: string;
}> {
  const buildQty = Money.of(input.quantity);
  if (!buildQty.greaterThan(0)) {
    throw validation('Build quantity must be greater than zero.');
  }

  const assembly = await loadItem(ctx, input.assemblyItemId);
  const bom = await getBom(ctx, input.assemblyItemId);

  if (bom.length === 0) {
    throw validation('Assembly has no bill of materials. Add components before building.');
  }

  // Load all component items with a single query
  const componentIds = bom.map((b) => b.componentItemId);
  const componentRows = await ctx.db
    .select()
    .from(items)
    .where(and(eq(items.companyId, ctx.companyId), inArray(items.id, componentIds)));
  const componentMap = new Map(componentRows.map((r) => [r.id, r]));

  // Validate sufficient stock for all components
  let totalCost = Money.zero();
  for (const bomLine of bom) {
    const comp = componentMap.get(bomLine.componentItemId);
    if (!comp) throw notFound(`Component item ${bomLine.componentItemId}`);

    const required = buildQty.times(Money.of(bomLine.quantity));
    const onHand = Money.of(comp.quantityOnHand ?? '0');

    if (onHand.lessThan(required)) {
      throw validation(
        `Insufficient stock for component "${comp.name}": need ${required.toFixed(4)}, have ${onHand.toFixed(4)}.`,
      );
    }

    // Accumulate cost: componentQtyPerUnit * buildQty * averageCost
    const compCost = required.times(Money.of(comp.averageCost ?? '0'));
    totalCost = totalCost.plus(compCost);
  }

  return inTransaction(ctx, async (tx) => {
    // Reduce each component's quantityOnHand
    for (const bomLine of bom) {
      const comp = componentMap.get(bomLine.componentItemId)!;
      const consumed = buildQty.times(Money.of(bomLine.quantity));
      const newQty = Money.of(comp.quantityOnHand ?? '0').minus(consumed);

      await tx.db
        .update(items)
        .set({ quantityOnHand: newQty.toFixed(4), updatedAt: new Date() })
        .where(eq(items.id, comp.id));

      await writeAudit(tx, {
        action: 'update',
        entityType: 'item',
        entityId: comp.id,
        oldValues: { quantityOnHand: comp.quantityOnHand },
        newValues: {
          quantityOnHand: newQty.toFixed(4),
          reason: `assembly_build:${input.assemblyItemId}`,
        },
      });
    }

    // Increase assembly quantityOnHand and recalculate weighted averageCost
    const existingQty = Money.of(assembly.quantityOnHand ?? '0');
    const existingAvgCost = Money.of(assembly.averageCost ?? '0');
    const existingValue = existingQty.times(existingAvgCost);
    const newAssemblyQty = existingQty.plus(buildQty);
    const newAssemblyAvgCost = newAssemblyQty.isZero()
      ? Money.zero()
      : existingValue.plus(totalCost).dividedBy(newAssemblyQty);

    await tx.db
      .update(items)
      .set({
        quantityOnHand: newAssemblyQty.toFixed(4),
        averageCost: newAssemblyAvgCost.toFixed(4),
        updatedAt: new Date(),
      })
      .where(eq(items.id, input.assemblyItemId));

    await writeAudit(tx, {
      action: 'update',
      entityType: 'item',
      entityId: input.assemblyItemId,
      oldValues: {
        quantityOnHand: assembly.quantityOnHand,
        averageCost: assembly.averageCost,
      },
      newValues: {
        quantityOnHand: newAssemblyQty.toFixed(4),
        averageCost: newAssemblyAvgCost.toFixed(4),
        quantityBuilt: buildQty.toFixed(4),
        totalComponentCost: toAmountString(totalCost),
      },
    });

    return {
      assemblyItemId: input.assemblyItemId,
      quantityBuilt: buildQty.toFixed(4),
      totalCost: toAmountString(totalCost),
      newAssemblyQty: newAssemblyQty.toFixed(4),
      newAssemblyAvgCost: newAssemblyAvgCost.toFixed(4),
    };
  });
}

// ---------------------------------------------------------------------------
// unbuildAssembly — reverse a build: restore component qty, reduce assembly qty
// ---------------------------------------------------------------------------

/**
 * Unbuild `quantity` finished assemblies back into their components.
 *
 * The assembly's averageCost is used to distribute cost back to components
 * proportionally (each component gets back qty * assemblyAvgCost * componentFraction).
 * In practice, for the GL this is still all account 1300 — no GL posting needed.
 *
 * Component averageCost is NOT adjusted on return; quantity is simply restored.
 * (This mirrors QuickBooks' behavior where unbuilds restore qty at the component's
 * current average cost, without recalculating component averageCost.)
 */
export async function unbuildAssembly(
  ctx: ServiceContext,
  input: BuildInput,
): Promise<{
  assemblyItemId: string;
  quantityUnbuilt: string;
  newAssemblyQty: string;
}> {
  const unbuildQty = Money.of(input.quantity);
  if (!unbuildQty.greaterThan(0)) {
    throw validation('Unbuild quantity must be greater than zero.');
  }

  const assembly = await loadItem(ctx, input.assemblyItemId);
  const currentAssemblyQty = Money.of(assembly.quantityOnHand ?? '0');

  if (unbuildQty.greaterThan(currentAssemblyQty)) {
    throw validation(
      `Cannot unbuild ${unbuildQty.toFixed(4)} units; only ${currentAssemblyQty.toFixed(4)} on hand.`,
    );
  }

  const bom = await getBom(ctx, input.assemblyItemId);
  if (bom.length === 0) {
    throw validation('Assembly has no bill of materials.');
  }

  const componentIds = bom.map((b) => b.componentItemId);
  const componentRows = await ctx.db
    .select()
    .from(items)
    .where(and(eq(items.companyId, ctx.companyId), inArray(items.id, componentIds)));
  const componentMap = new Map(componentRows.map((r) => [r.id, r]));

  return inTransaction(ctx, async (tx) => {
    // Restore each component's quantityOnHand
    for (const bomLine of bom) {
      const comp = componentMap.get(bomLine.componentItemId);
      if (!comp) throw notFound(`Component item ${bomLine.componentItemId}`);

      const returned = unbuildQty.times(Money.of(bomLine.quantity));
      const newQty = Money.of(comp.quantityOnHand ?? '0').plus(returned);

      await tx.db
        .update(items)
        .set({ quantityOnHand: newQty.toFixed(4), updatedAt: new Date() })
        .where(eq(items.id, comp.id));

      await writeAudit(tx, {
        action: 'update',
        entityType: 'item',
        entityId: comp.id,
        oldValues: { quantityOnHand: comp.quantityOnHand },
        newValues: {
          quantityOnHand: newQty.toFixed(4),
          reason: `assembly_unbuild:${input.assemblyItemId}`,
        },
      });
    }

    // Reduce assembly quantityOnHand (averageCost stays the same)
    const newAssemblyQty = currentAssemblyQty.minus(unbuildQty);

    await tx.db
      .update(items)
      .set({
        quantityOnHand: newAssemblyQty.toFixed(4),
        updatedAt: new Date(),
      })
      .where(eq(items.id, input.assemblyItemId));

    await writeAudit(tx, {
      action: 'update',
      entityType: 'item',
      entityId: input.assemblyItemId,
      oldValues: { quantityOnHand: assembly.quantityOnHand },
      newValues: {
        quantityOnHand: newAssemblyQty.toFixed(4),
        quantityUnbuilt: unbuildQty.toFixed(4),
      },
    });

    return {
      assemblyItemId: input.assemblyItemId,
      quantityUnbuilt: unbuildQty.toFixed(4),
      newAssemblyQty: newAssemblyQty.toFixed(4),
    };
  });
}
