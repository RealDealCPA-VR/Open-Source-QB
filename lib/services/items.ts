/**
 * Products & Services (items) service.
 *
 * Items are the catalogue entries used on invoice lines, bill lines, and
 * purchase orders. They carry optional links to income, expense, and
 * inventory-asset accounts so downstream documents can auto-fill the
 * correct GL account without the user having to think about it.
 *
 * Posting note: items themselves carry NO journal impact — they are master
 * data. The GL side is posted when an invoice, bill, or inventory-adjustment
 * document is created and calls postJournalEntry. This service only manages
 * the item record and validates the linked account references.
 */
import { and, asc, eq, ilike, ne } from 'drizzle-orm';
import { accounts, assemblyComponents, items } from '@/lib/db/schema';
import { type ServiceContext, notFound, validation, writeAudit } from './_base';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ItemType =
  | 'service' | 'inventory' | 'non_inventory' | 'bundle'
  | 'other_charge' | 'discount' | 'subtotal' | 'payment' | 'sales_tax';

export interface CreateItemInput {
  name: string;
  sku?: string | null;
  type?: ItemType;
  description?: string | null;
  /** Selling price shown on invoice lines. Decimal string or number. */
  salesPrice?: string | number | null;
  /** Purchase cost used on bill lines / purchase orders. */
  purchaseCost?: string | number | null;
  /** Revenue account credited when this item is sold. */
  incomeAccountId?: string | null;
  /** Expense / COGS account debited when this item is purchased or expensed. */
  expenseAccountId?: string | null;
  /** Inventory asset account (required for type=inventory). */
  assetAccountId?: string | null;
  taxable?: boolean;
  /** Unit of measure shown on line grids / printed docs (e.g. "hr", "box", "ea"). */
  unitOfMeasure?: string | null;
}

export interface UpdateItemInput {
  name?: string;
  sku?: string | null;
  type?: ItemType;
  description?: string | null;
  salesPrice?: string | number | null;
  purchaseCost?: string | number | null;
  incomeAccountId?: string | null;
  expenseAccountId?: string | null;
  assetAccountId?: string | null;
  taxable?: boolean;
  unitOfMeasure?: string | null;
  isActive?: boolean;
}

/** A bundle (group item) component, joined with the component item's details. */
export interface BundleComponent {
  componentItemId: string;
  /** BOM quantity per ONE bundle. */
  quantity: string;
  name: string;
  sku: string | null;
  type: ItemType;
  description: string | null;
  salesPrice: string | null;
  taxable: boolean;
  unitOfMeasure: string | null;
  incomeAccountId: string | null;
}

export interface ListItemsOpts {
  /** Include soft-deleted (inactive) items. Default: false. */
  includeInactive?: boolean;
  /** Filter by item type. */
  type?: ItemType;
  /** Case-insensitive name search substring. */
  search?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Verify that an account ID belongs to this company and (optionally) has the
 * expected account type. Throws NOT_FOUND or VALIDATION on failure.
 */
async function requireAccount(
  ctx: ServiceContext,
  accountId: string,
  label: string,
  expectedType?: string,
): Promise<void> {
  const [row] = await ctx.db
    .select({ id: accounts.id, type: accounts.type })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.companyId, ctx.companyId)));
  if (!row) throw notFound(`${label} account ${accountId}`);
  if (expectedType && row.type !== expectedType) {
    throw validation(
      `${label} account must be a "${expectedType}" account (got "${row.type}").`,
    );
  }
}

/**
 * Validate and resolve all account links in a CreateItemInput or UpdateItemInput.
 * Returns a cleaned-up object that is safe to spread into a DB insert/update.
 */
async function resolveAccountLinks(
  ctx: ServiceContext,
  input: Pick<
    CreateItemInput,
    'type' | 'incomeAccountId' | 'expenseAccountId' | 'assetAccountId'
  >,
): Promise<void> {
  if (input.incomeAccountId) {
    await requireAccount(ctx, input.incomeAccountId, 'Income', 'revenue');
  }
  if (input.expenseAccountId) {
    await requireAccount(ctx, input.expenseAccountId, 'Expense/COGS', 'expense');
  }
  if (input.assetAccountId) {
    await requireAccount(ctx, input.assetAccountId, 'Asset', 'asset');
  }

  // Inventory items should have an asset account so inventory tracking is
  // possible. We warn rather than hard-block so imports can proceed.
  if (input.type === 'inventory' && !input.assetAccountId) {
    // Allowed — caller may add it later via updateItem.
  }
}

/**
 * Type-specific rules for the QB-parity item types.
 *  - subtotal: pure UI helper (computed from preceding lines) — must not carry
 *    prices or account links, they would never be used and only confuse.
 *  - payment: reduces the invoice balance (Dr Undeposited Funds / Cr A/R) —
 *    income/expense/asset accounts do not apply.
 *  - discount / sales_tax / other_charge: allowed to carry a salesPrice (the
 *    default amount/rate) and an income/discount account.
 */
function validateTypeRules(
  type: ItemType,
  input: Pick<
    CreateItemInput,
    'salesPrice' | 'purchaseCost' | 'incomeAccountId' | 'expenseAccountId' | 'assetAccountId'
  >,
): void {
  if (type === 'subtotal') {
    if (input.salesPrice != null || input.purchaseCost != null) {
      throw validation('Subtotal items cannot have a sales price or purchase cost — the amount is computed from the preceding lines.');
    }
    if (input.incomeAccountId || input.expenseAccountId || input.assetAccountId) {
      throw validation('Subtotal items are non-posting and cannot link to accounts.');
    }
  }
  if (type === 'payment') {
    if (input.incomeAccountId || input.expenseAccountId || input.assetAccountId) {
      throw validation('Payment items post Dr Undeposited Funds / Cr Accounts Receivable automatically and cannot link to accounts.');
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Return all items for the company, with optional filtering. */
export async function listItems(ctx: ServiceContext, opts: ListItemsOpts = {}) {
  const conditions = [eq(items.companyId, ctx.companyId)];

  if (!opts.includeInactive) {
    conditions.push(eq(items.isActive, true));
  }
  if (opts.type) {
    conditions.push(eq(items.type, opts.type));
  }
  if (opts.search?.trim()) {
    conditions.push(ilike(items.name, `%${opts.search.trim()}%`));
  }

  return ctx.db
    .select()
    .from(items)
    .where(and(...conditions))
    .orderBy(asc(items.name));
}

/** Fetch a single item by ID. Throws NOT_FOUND if missing or belongs to another company. */
export async function getItem(ctx: ServiceContext, id: string) {
  const [row] = await ctx.db
    .select()
    .from(items)
    .where(and(eq(items.id, id), eq(items.companyId, ctx.companyId)));
  if (!row) throw notFound('Item');
  return row;
}

/**
 * Create a new item (product or service). Validates:
 *  - name is non-empty
 *  - name is unique within the company
 *  - linked account IDs exist, belong to this company, and have the expected type
 */
export async function createItem(ctx: ServiceContext, input: CreateItemInput) {
  // ── Validate name ────────────────────────────────────────────────────────
  const name = input.name?.trim();
  if (!name) throw validation('Item name is required.');

  // Enforce unique name per company (case-sensitive match on stored value).
  const [dup] = await ctx.db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.companyId, ctx.companyId), eq(items.name, name)));
  if (dup) throw validation(`An item named "${name}" already exists.`);

  // ── Validate type rules + account links ──────────────────────────────────
  validateTypeRules((input.type ?? 'service') as ItemType, input);
  await resolveAccountLinks(ctx, input);

  // ── Insert ───────────────────────────────────────────────────────────────
  const [row] = await ctx.db
    .insert(items)
    .values({
      companyId: ctx.companyId,
      name,
      sku: input.sku?.trim() ?? null,
      type: (input.type ?? 'service') as ItemType,
      description: input.description?.trim() ?? null,
      salesPrice: input.salesPrice != null ? String(input.salesPrice) : null,
      purchaseCost: input.purchaseCost != null ? String(input.purchaseCost) : null,
      incomeAccountId: input.incomeAccountId ?? null,
      expenseAccountId: input.expenseAccountId ?? null,
      assetAccountId: input.assetAccountId ?? null,
      taxable: input.taxable ?? true,
      unitOfMeasure: input.unitOfMeasure?.trim() || null,
    })
    .returning();

  await writeAudit(ctx, {
    action: 'create',
    entityType: 'item',
    entityId: row.id,
    newValues: row,
  });

  return row;
}

/**
 * Patch an existing item. Only supplied fields are changed. Validates name
 * uniqueness (if being changed) and account-link types.
 */
export async function updateItem(ctx: ServiceContext, id: string, patch: UpdateItemInput) {
  const before = await getItem(ctx, id);

  // ── Name validation ──────────────────────────────────────────────────────
  let newName = before.name;
  if (patch.name !== undefined) {
    newName = patch.name.trim();
    if (!newName) throw validation('Item name cannot be empty.');
    if (newName !== before.name) {
      const [dup] = await ctx.db
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.companyId, ctx.companyId),
            eq(items.name, newName),
            ne(items.id, id),
          ),
        );
      if (dup) throw validation(`An item named "${newName}" already exists.`);
    }
  }

  // ── Type rules (validated against the EFFECTIVE post-patch values) ──────
  const effectiveType = (patch.type ?? before.type) as ItemType;
  validateTypeRules(effectiveType, {
    salesPrice: patch.salesPrice !== undefined ? patch.salesPrice : before.salesPrice,
    purchaseCost: patch.purchaseCost !== undefined ? patch.purchaseCost : before.purchaseCost,
    incomeAccountId:
      patch.incomeAccountId !== undefined ? patch.incomeAccountId : before.incomeAccountId,
    expenseAccountId:
      patch.expenseAccountId !== undefined ? patch.expenseAccountId : before.expenseAccountId,
    assetAccountId:
      patch.assetAccountId !== undefined ? patch.assetAccountId : before.assetAccountId,
  });

  // ── Account link validation (only for fields being patched) ─────────────
  await resolveAccountLinks(ctx, {
    type: patch.type ?? before.type,
    incomeAccountId:
      patch.incomeAccountId !== undefined ? patch.incomeAccountId : undefined,
    expenseAccountId:
      patch.expenseAccountId !== undefined ? patch.expenseAccountId : undefined,
    assetAccountId:
      patch.assetAccountId !== undefined ? patch.assetAccountId : undefined,
  });

  // ── Update ───────────────────────────────────────────────────────────────
  const [row] = await ctx.db
    .update(items)
    .set({
      name: newName,
      sku: patch.sku !== undefined ? (patch.sku?.trim() ?? null) : before.sku,
      type: (patch.type ?? before.type) as ItemType,
      description:
        patch.description !== undefined
          ? (patch.description?.trim() ?? null)
          : before.description,
      salesPrice:
        patch.salesPrice !== undefined
          ? patch.salesPrice != null
            ? String(patch.salesPrice)
            : null
          : before.salesPrice,
      purchaseCost:
        patch.purchaseCost !== undefined
          ? patch.purchaseCost != null
            ? String(patch.purchaseCost)
            : null
          : before.purchaseCost,
      incomeAccountId:
        patch.incomeAccountId !== undefined
          ? patch.incomeAccountId
          : before.incomeAccountId,
      expenseAccountId:
        patch.expenseAccountId !== undefined
          ? patch.expenseAccountId
          : before.expenseAccountId,
      assetAccountId:
        patch.assetAccountId !== undefined ? patch.assetAccountId : before.assetAccountId,
      taxable: patch.taxable !== undefined ? patch.taxable : before.taxable,
      unitOfMeasure:
        patch.unitOfMeasure !== undefined
          ? (patch.unitOfMeasure?.trim() || null)
          : before.unitOfMeasure,
      isActive: patch.isActive !== undefined ? patch.isActive : before.isActive,
      updatedAt: new Date(),
    })
    .where(eq(items.id, id))
    .returning();

  await writeAudit(ctx, {
    action: 'update',
    entityType: 'item',
    entityId: id,
    oldValues: before,
    newValues: row,
  });

  return row;
}

/**
 * Soft-delete an item. Deactivated items are hidden from normal lists but
 * remain on historical documents. Hard delete is intentionally not exposed.
 */
export async function deactivateItem(ctx: ServiceContext, id: string) {
  return updateItem(ctx, id, { isActive: false });
}

/**
 * Return the components of a bundle (group) item, joined with each component
 * item's sales details so callers (the invoice form) can expand the bundle
 * into individual lines. Reuses the assemblyComponents BOM rows — the
 * assemblies service manages those rows; bundles simply read them.
 *
 * Returns [] when the bundle has no BOM yet (the caller keeps a plain line).
 */
export async function getBundleComponents(
  ctx: ServiceContext,
  bundleItemId: string,
): Promise<BundleComponent[]> {
  // Validate the bundle item belongs to this company (any type is tolerated so
  // assemblies can reuse this too, but the primary caller passes type=bundle).
  await getItem(ctx, bundleItemId);

  const rows = await ctx.db
    .select({
      componentItemId: assemblyComponents.componentItemId,
      quantity: assemblyComponents.quantity,
      name: items.name,
      sku: items.sku,
      type: items.type,
      description: items.description,
      salesPrice: items.salesPrice,
      taxable: items.taxable,
      unitOfMeasure: items.unitOfMeasure,
      incomeAccountId: items.incomeAccountId,
    })
    .from(assemblyComponents)
    .innerJoin(items, eq(items.id, assemblyComponents.componentItemId))
    .where(
      and(
        eq(assemblyComponents.companyId, ctx.companyId),
        eq(assemblyComponents.assemblyItemId, bundleItemId),
      ),
    )
    .orderBy(asc(items.name));

  return rows as BundleComponent[];
}
