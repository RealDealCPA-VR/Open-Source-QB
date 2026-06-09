/**
 * Bills (Accounts Payable) service.
 *
 * A Bill records an obligation to pay a vendor for goods or services received.
 * The posting pattern is the A/P mirror of an Invoice:
 *
 *   Dr  <expense / asset account>   (one line per bill line)
 *   Cr  Accounts Payable  2000      (consolidated total)
 *
 * Item lines (QB "Items tab"): a line may reference an item instead of a GL
 * account. For inventory-type items the debit is routed to the item's inventory
 * asset account (item.assetAccountId ?? code 1300) — Dr Inventory / Cr A/P — and
 * stock is received in the SAME transaction:
 *   - FIFO-tracked items (any inventoryLayers rows) get a new cost layer.
 *   - average-cost items get a weighted-average cost update.
 * The bill's own journal entry already carries the inventory debit, so the stock
 * side only updates quantityOnHand/averageCost/layers (no second GL posting —
 * calling fifo.receiveStock here would double-post Dr Inventory).
 * Non-inventory items route to line.accountId ?? item.expenseAccountId.
 *
 * All GL mutations go through `postJournalEntry`; `voidBill` delegates to
 * `voidJournalEntry`, reverses any stock received, and flips the status to 'void'.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { accounts, bills, billLines, inventoryLayers, items, vendors } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import { postJournalEntry, voidJournalEntry } from '@/lib/services/posting';
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

export interface BillLineInput {
  /** GL account to debit (expense or asset). Required unless itemId is set. */
  accountId?: string | null;
  /** Item being purchased; routes the debit and (for inventory items) receives stock. */
  itemId?: string | null;
  description?: string | null;
  /** Units purchased. Required (> 0) for item lines; informational otherwise. */
  quantity?: string | number | null;
  /** Per-unit cost for item lines. Provide unitCost or amount (or both). */
  unitCost?: string | number | null;
  /** The dollar amount for this line (must be > 0). Defaults to quantity * unitCost for item lines. */
  amount?: string | number | null;
  /** Class/department dimension — carried onto the GL debit line for P&L-by-class. */
  classId?: string | null;
  /** Billable customer (+ optional job) — makes the line available for invoice passthrough. */
  customerId?: string | null;
  jobId?: string | null;
}

export interface CreateBillInput {
  vendorId: string;
  billNumber?: string | null;
  date: Date;
  dueDate?: Date | null;
  memo?: string | null;
  classId?: string | null;
  lines: BillLineInput[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the Accounts Payable account (code '2000') for this company. */
async function resolveApAccount(ctx: ServiceContext): Promise<string> {
  const [row] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, '2000')));
  if (!row) {
    throw new ServiceError(
      'NOT_FOUND',
      'Accounts Payable account (code 2000) not found. Ensure the default chart of accounts is seeded.',
    );
  }
  return row.id;
}

/** Resolve an account id by code, scoped to the company. Throws NOT_FOUND. */
async function accountIdByCode(ctx: ServiceContext, code: string): Promise<string> {
  const [row] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, code)));
  if (!row) throw notFound(`Account with code ${code}`);
  return row.id;
}

/** True when the item has ever had FIFO cost layers (mirrors inventory.assertNotFifoTracked). */
async function isFifoTracked(ctx: ServiceContext, itemId: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: inventoryLayers.id })
    .from(inventoryLayers)
    .where(
      and(eq(inventoryLayers.companyId, ctx.companyId), eq(inventoryLayers.itemId, itemId)),
    )
    .limit(1);
  return Boolean(row);
}

// ---------------------------------------------------------------------------
// createBill
// ---------------------------------------------------------------------------

export async function createBill(ctx: ServiceContext, input: CreateBillInput) {
  // --- Validate vendor belongs to this company ---
  const [vendor] = await ctx.db
    .select({ id: vendors.id, name: vendors.displayName })
    .from(vendors)
    .where(and(eq(vendors.id, input.vendorId), eq(vendors.companyId, ctx.companyId)));
  if (!vendor) throw notFound('Vendor');

  // --- Validate lines ---
  if (!input.lines || input.lines.length === 0) {
    throw validation('A bill must have at least one line.');
  }

  // Pre-load referenced items (debit routing + inventory typing).
  const itemIds = [
    ...new Set(input.lines.filter((l) => l.itemId).map((l) => l.itemId as string)),
  ];
  const itemMap = new Map<
    string,
    {
      type: string;
      name: string;
      assetAccountId: string | null;
      expenseAccountId: string | null;
    }
  >();
  if (itemIds.length > 0) {
    const itemRows = await ctx.db
      .select({
        id: items.id,
        type: items.type,
        name: items.name,
        assetAccountId: items.assetAccountId,
        expenseAccountId: items.expenseAccountId,
      })
      .from(items)
      .where(and(eq(items.companyId, ctx.companyId), inArray(items.id, itemIds)));
    for (const r of itemRows) itemMap.set(r.id, r);
    for (const id of itemIds) {
      if (!itemMap.has(id)) throw notFound(`Item ${id}`);
    }
  }

  // Resolve each line to { debit account, amount, qty, unitCost } using Money (no JS floats).
  type ResolvedLine = {
    itemId: string | null;
    accountId: string;
    description: string | null;
    quantity: string; // 4dp
    amount: string; // 2dp
    /** Per-unit cost (4dp Decimal) — only set for inventory item lines. */
    unitCost: ReturnType<typeof Money.zero> | null;
    isInventory: boolean;
    classId: string | null;
    customerId: string | null;
    jobId: string | null;
  };
  const resolvedLines: ResolvedLine[] = [];
  let total = Money.zero();

  // Lazily resolved 1300 fallback (only needed when an inventory item lacks assetAccountId).
  let defaultInventoryAcctId: string | null = null;

  for (const [i, line] of input.lines.entries()) {
    if (line.itemId) {
      const item = itemMap.get(line.itemId)!;
      const qty = Money.of(line.quantity ?? 0);
      if (qty.lessThanOrEqualTo(0)) {
        throw validation(`Line ${i + 1}: quantity must be greater than zero for item lines.`);
      }
      if (line.unitCost == null && line.amount == null) {
        throw validation(`Line ${i + 1}: provide a unit cost or an amount for item lines.`);
      }

      // amount = explicit amount, else qty * unitCost; unitCost = explicit, else amount / qty.
      const amount =
        line.amount != null
          ? Money.round2(line.amount)
          : Money.round2(qty.times(Money.of(line.unitCost!)));
      if (!amount.greaterThan(0)) {
        throw validation(`Line ${i + 1}: amount must be greater than zero.`);
      }
      const unitCost =
        line.unitCost != null ? Money.of(line.unitCost) : amount.dividedBy(qty);
      if (unitCost.isNegative()) {
        throw validation(`Line ${i + 1}: unit cost cannot be negative.`);
      }

      const isInventory = item.type === 'inventory';
      let accountId: string;
      if (isInventory) {
        // Dr Inventory Asset (item account or 1300 fallback) / Cr A/P.
        if (item.assetAccountId) {
          accountId = item.assetAccountId;
        } else {
          defaultInventoryAcctId ??= await accountIdByCode(ctx, '1300');
          accountId = defaultInventoryAcctId;
        }
      } else {
        const routed = line.accountId ?? item.expenseAccountId;
        if (!routed) {
          throw validation(
            `Line ${i + 1}: item "${item.name}" has no expense account — set one on the item or pass an accountId.`,
          );
        }
        accountId = routed;
      }

      resolvedLines.push({
        itemId: line.itemId,
        accountId,
        description: line.description ?? item.name,
        quantity: qty.toFixed(4),
        amount: toAmountString(amount),
        unitCost: isInventory ? unitCost : null,
        isInventory,
        classId: line.classId ?? input.classId ?? null,
        customerId: line.customerId ?? null,
        jobId: line.jobId ?? null,
      });
      total = total.plus(amount);
    } else {
      if (!line.accountId) {
        throw validation(`Line ${i + 1}: select an account or an item.`);
      }
      const amt = Money.of(line.amount ?? 0);
      if (!amt.greaterThan(0)) {
        throw validation(`Line ${i + 1}: amount must be greater than zero.`);
      }
      resolvedLines.push({
        itemId: null,
        accountId: line.accountId,
        description: line.description ?? null,
        quantity: line.quantity != null ? toAmountString(line.quantity) : '1.0000',
        amount: toAmountString(amt),
        unitCost: null,
        isInventory: false,
        classId: line.classId ?? input.classId ?? null,
        customerId: line.customerId ?? null,
        jobId: line.jobId ?? null,
      });
      total = total.plus(amt);
    }
  }
  const totalStr = toAmountString(total);

  // Resolve A/P account before opening the transaction (read-only; no need to hold a tx lock).
  const apAccountId = await resolveApAccount(ctx);

  return inTransaction(ctx, async (tx) => {
    // --- Insert the bill header ---
    const [bill] = await tx.db
      .insert(bills)
      .values({
        companyId: tx.companyId,
        vendorId: input.vendorId,
        billNumber: input.billNumber ?? null,
        date: input.date,
        dueDate: input.dueDate ?? null,
        memo: input.memo ?? null,
        status: 'open',
        classId: input.classId ?? null,
        total: totalStr,
        amountPaid: '0.00',
        amountCredited: '0.00',
        balanceDue: totalStr,
      })
      .returning();

    // --- Insert bill lines ---
    await tx.db.insert(billLines).values(
      resolvedLines.map((line, idx) => ({
        billId: bill.id,
        accountId: line.accountId,
        itemId: line.itemId,
        description: line.description,
        quantity: line.quantity,
        amount: line.amount,
        classId: line.classId,
        customerId: line.customerId,
        jobId: line.jobId,
        lineOrder: idx,
      })),
    );

    // --- Build posting lines ---
    // Dr each expense/asset account for its line amount; Cr A/P for the total.
    const postingLines = [
      // Debit lines (one per bill line)
      ...resolvedLines.map((line) => ({
        accountId: line.accountId,
        debit: line.amount,
        memo: line.description,
        classId: line.classId,
      })),
      // Credit line — Accounts Payable
      {
        accountId: apAccountId,
        credit: totalStr,
        memo: `Bill ${input.billNumber ?? bill.id} — ${vendor.name}`,
      },
    ];

    // --- Post to the GL ---
    const entry = await postJournalEntry(tx, {
      date: input.date,
      description: `Bill ${input.billNumber ? `#${input.billNumber}` : bill.id}`,
      reference: input.billNumber ?? null,
      sourceRef: `bill:${bill.id}`,
      lines: postingLines,
    });

    // --- Store the journal entry reference on the bill ---
    const [updated] = await tx.db
      .update(bills)
      .set({ postedEntryId: entry.id, updatedAt: new Date() })
      .where(eq(bills.id, bill.id))
      .returning();

    // --- Receive stock for inventory item lines (same transaction) ---
    // The bill's journal entry above already debited the inventory asset account,
    // so this step only moves the quantity/cost subledger:
    //   FIFO-tracked items  → new cost layer at the line's unit cost.
    //   average-cost items  → weighted-average cost update.
    for (const line of resolvedLines) {
      if (!line.isInventory || !line.itemId || !line.unitCost) continue;

      // Reload inside the tx so multiple lines for the same item compound correctly.
      const [item] = await tx.db
        .select()
        .from(items)
        .where(and(eq(items.companyId, tx.companyId), eq(items.id, line.itemId)));
      if (!item) throw notFound(`Item ${line.itemId}`);

      const qty = Money.of(line.quantity);
      const currentQty = Money.of(item.quantityOnHand ?? '0');
      const newQty = currentQty.plus(qty);

      if (await isFifoTracked(tx, line.itemId)) {
        await tx.db.insert(inventoryLayers).values({
          companyId: tx.companyId,
          itemId: line.itemId,
          date: input.date,
          quantityRemaining: qty.toFixed(4),
          unitCost: line.unitCost.toFixed(4),
        });
        await tx.db
          .update(items)
          .set({ quantityOnHand: newQty.toFixed(4), updatedAt: new Date() })
          .where(eq(items.id, line.itemId));
      } else {
        const currentAvg = Money.of(item.averageCost ?? '0');
        const newAvg = newQty.isZero()
          ? line.unitCost
          : currentQty.times(currentAvg).plus(qty.times(line.unitCost)).dividedBy(newQty);
        await tx.db
          .update(items)
          .set({
            quantityOnHand: newQty.toFixed(4),
            averageCost: newAvg.toFixed(4),
            updatedAt: new Date(),
          })
          .where(eq(items.id, line.itemId));
      }

      await writeAudit(tx, {
        action: 'update',
        entityType: 'item',
        entityId: line.itemId,
        oldValues: {
          quantityOnHand: item.quantityOnHand,
          averageCost: item.averageCost,
        },
        newValues: {
          quantityOnHand: newQty.toFixed(4),
          unitCost: line.unitCost.toFixed(4),
          reason: `bill_receipt:${bill.id}`,
        },
      });
    }

    await writeAudit(tx, {
      action: 'create',
      entityType: 'bill',
      entityId: bill.id,
      newValues: { ...updated, linesCount: input.lines.length, total: totalStr },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// listBills
// ---------------------------------------------------------------------------

export async function listBills(
  ctx: ServiceContext,
  opts?: { vendorId?: string; status?: string },
) {
  const conditions = [eq(bills.companyId, ctx.companyId)];
  if (opts?.vendorId) conditions.push(eq(bills.vendorId, opts.vendorId));
  if (opts?.status) conditions.push(eq(bills.status, opts.status as never));

  return ctx.db
    .select()
    .from(bills)
    .where(and(...conditions))
    .orderBy(desc(bills.date), asc(bills.createdAt));
}

// ---------------------------------------------------------------------------
// getBill (header + lines)
// ---------------------------------------------------------------------------

export async function getBill(ctx: ServiceContext, id: string) {
  const [bill] = await ctx.db
    .select()
    .from(bills)
    .where(and(eq(bills.id, id), eq(bills.companyId, ctx.companyId)));
  if (!bill) throw notFound('Bill');

  const lines = await ctx.db
    .select()
    .from(billLines)
    .where(eq(billLines.billId, id))
    .orderBy(asc(billLines.lineOrder));

  return { ...bill, lines };
}

// ---------------------------------------------------------------------------
// voidBill
// ---------------------------------------------------------------------------

export async function voidBill(ctx: ServiceContext, id: string) {
  // Fetch the bill and verify company ownership.
  const [bill] = await ctx.db
    .select()
    .from(bills)
    .where(and(eq(bills.id, id), eq(bills.companyId, ctx.companyId)));
  if (!bill) throw notFound('Bill');

  if (bill.status === 'void') {
    // Idempotent — already voided.
    return bill;
  }

  if (bill.amountPaid && Money.gt(bill.amountPaid, 0)) {
    throw new ServiceError(
      'CONFLICT',
      'Cannot void a bill that has payments applied. Unapply payments first.',
    );
  }

  if (bill.amountCredited && Money.gt(bill.amountCredited, 0)) {
    throw new ServiceError(
      'CONFLICT',
      'Cannot void a bill that has vendor credits applied. Unapply vendor credits first.',
    );
  }

  return inTransaction(ctx, async (tx) => {
    // Reverse the GL entry.
    if (bill.postedEntryId) {
      await voidJournalEntry(tx, bill.postedEntryId);
    }

    // Reverse any stock received via inventory item lines. The JE void above
    // already restored the GL (Dr A/P / Cr Inventory at the bill's cost); this
    // step pulls the quantity/cost back out of the subledger.
    const lines = await tx.db
      .select()
      .from(billLines)
      .where(eq(billLines.billId, id))
      .orderBy(asc(billLines.lineOrder));

    for (const line of lines) {
      if (!line.itemId) continue;
      const [item] = await tx.db
        .select()
        .from(items)
        .where(and(eq(items.companyId, tx.companyId), eq(items.id, line.itemId)));
      if (!item || item.type !== 'inventory') continue;

      const qty = Money.of(line.quantity);
      if (qty.lessThanOrEqualTo(0)) continue;
      const unitCost = Money.of(line.amount).dividedBy(qty);

      const currentQty = Money.of(item.quantityOnHand ?? '0');
      if (currentQty.lessThan(qty)) {
        throw new ServiceError(
          'CONFLICT',
          `Cannot void this bill: only ${currentQty.toFixed(4)} of "${item.name}" remain on hand (the received stock has already been consumed).`,
        );
      }
      const newQty = currentQty.minus(qty);

      if (await isFifoTracked(tx, line.itemId)) {
        // Remove the received quantity from layers — prefer layers at this bill's
        // unit cost (the ones this bill created), newest first, then fall back to
        // FIFO (oldest-first) for any remainder.
        const layers = await tx.db
          .select()
          .from(inventoryLayers)
          .where(
            and(
              eq(inventoryLayers.companyId, tx.companyId),
              eq(inventoryLayers.itemId, line.itemId),
            ),
          )
          .orderBy(asc(inventoryLayers.date), asc(inventoryLayers.createdAt));
        const available = layers.filter((l) => Money.of(l.quantityRemaining).greaterThan(0));
        const costKey = unitCost.toFixed(4);
        const ordered = [
          ...available.filter((l) => Money.of(l.unitCost).toFixed(4) === costKey).reverse(),
          ...available.filter((l) => Money.of(l.unitCost).toFixed(4) !== costKey),
        ];

        let remaining = qty;
        for (const layer of ordered) {
          if (remaining.lessThanOrEqualTo(0)) break;
          const layerQty = Money.of(layer.quantityRemaining);
          const take = remaining.lessThanOrEqualTo(layerQty) ? remaining : layerQty;
          await tx.db
            .update(inventoryLayers)
            .set({ quantityRemaining: layerQty.minus(take).toFixed(4) })
            .where(eq(inventoryLayers.id, layer.id));
          remaining = remaining.minus(take);
        }
        if (remaining.greaterThan(0)) {
          throw new ServiceError(
            'CONFLICT',
            `Cannot void this bill: FIFO layers for "${item.name}" no longer hold the received quantity.`,
          );
        }
        await tx.db
          .update(items)
          .set({ quantityOnHand: newQty.toFixed(4), updatedAt: new Date() })
          .where(eq(items.id, line.itemId));
      } else {
        // Reverse the weighted-average receipt: back the line's value out of the pool.
        const currentAvg = Money.of(item.averageCost ?? '0');
        const remainingValue = currentQty.times(currentAvg).minus(qty.times(unitCost));
        const newAvg = newQty.isZero()
          ? Money.zero()
          : remainingValue.lessThan(0)
            ? Money.zero()
            : remainingValue.dividedBy(newQty);
        await tx.db
          .update(items)
          .set({
            quantityOnHand: newQty.toFixed(4),
            averageCost: newAvg.toFixed(4),
            updatedAt: new Date(),
          })
          .where(eq(items.id, line.itemId));
      }

      await writeAudit(tx, {
        action: 'update',
        entityType: 'item',
        entityId: line.itemId,
        oldValues: {
          quantityOnHand: item.quantityOnHand,
          averageCost: item.averageCost,
        },
        newValues: {
          quantityOnHand: newQty.toFixed(4),
          reason: `bill_void:${id}`,
        },
      });
    }

    // Flip bill status to void and zero balanceDue.
    const [updated] = await tx.db
      .update(bills)
      .set({ status: 'void', balanceDue: '0.00', updatedAt: new Date() })
      .where(eq(bills.id, id))
      .returning();

    await writeAudit(tx, {
      action: 'void',
      entityType: 'bill',
      entityId: id,
      oldValues: { status: bill.status },
      newValues: { status: 'void' },
    });

    return updated;
  });
}
