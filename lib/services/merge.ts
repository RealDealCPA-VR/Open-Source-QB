/**
 * Merge duplicate customers and vendors — QuickBooks-parity "Merge" feature.
 *
 * Both merge functions:
 *  1. Verify both records exist and belong to the active company.
 *  2. Reject self-merges (fromId === toId).
 *  3. Reassign every related document from `from` to `to` inside a single
 *     database transaction so the operation is atomic.
 *  4. Deactivate the `from` record (soft-delete — isActive = false).
 *  5. Write a pair of audit_logs rows (one for the deactivation, one for the
 *     merge action).
 *
 * GL integrity note: no journal entries are touched. Existing entries already
 * reference the correct A/R / A/P accounts; only the customer/vendor FK on the
 * sub-ledger documents is updated. The GL and trial balance remain balanced.
 */
import { and, eq } from 'drizzle-orm';
import {
  customers,
  vendors,
  invoices,
  paymentsReceived,
  estimates,
  creditMemos,
  salesOrders,
  bills,
  billPayments,
  expenses,
  vendorCredits,
  purchaseOrders,
} from '@/lib/db/schema';
import { type ServiceContext, notFound, validation, inTransaction, writeAudit } from './_base';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MergeCustomersInput {
  /** The duplicate to fold away — will be deactivated. */
  fromId: string;
  /** The master record to keep. */
  toId: string;
}

export interface MergeVendorsInput {
  fromId: string;
  toId: string;
}

export interface MergeResult {
  reassigned: {
    invoices: number;
    paymentsReceived: number;
    estimates: number;
    creditMemos: number;
    salesOrders: number;
  } | {
    bills: number;
    billPayments: number;
    expenses: number;
    vendorCredits: number;
    purchaseOrders: number;
  };
  deactivatedId: string;
}

// ---------------------------------------------------------------------------
// mergeCustomers
// ---------------------------------------------------------------------------

/**
 * Merge `fromId` into `toId`. Reassigns all A/R sub-ledger documents and
 * deactivates the `from` customer. Runs inside a single transaction.
 */
export async function mergeCustomers(
  ctx: ServiceContext,
  { fromId, toId }: MergeCustomersInput,
): Promise<MergeResult> {
  if (fromId === toId) {
    throw validation('Cannot merge a customer with itself.');
  }

  // Verify both customers belong to this company before entering a transaction.
  const [fromRow] = await ctx.db
    .select({ id: customers.id, displayName: customers.displayName, isActive: customers.isActive })
    .from(customers)
    .where(and(eq(customers.id, fromId), eq(customers.companyId, ctx.companyId)));
  if (!fromRow) throw notFound(`Customer ${fromId}`);

  const [toRow] = await ctx.db
    .select({ id: customers.id, displayName: customers.displayName })
    .from(customers)
    .where(and(eq(customers.id, toId), eq(customers.companyId, ctx.companyId)));
  if (!toRow) throw notFound(`Customer ${toId}`);

  return inTransaction(ctx, async (tx) => {
    // Reassign every customer-linked table.
    const invRows = await tx.db
      .update(invoices)
      .set({ customerId: toId, updatedAt: new Date() })
      .where(and(eq(invoices.customerId, fromId), eq(invoices.companyId, tx.companyId)))
      .returning({ id: invoices.id });

    const pmtRows = await tx.db
      .update(paymentsReceived)
      .set({ customerId: toId })
      .where(and(eq(paymentsReceived.customerId, fromId), eq(paymentsReceived.companyId, tx.companyId)))
      .returning({ id: paymentsReceived.id });

    const estRows = await tx.db
      .update(estimates)
      .set({ customerId: toId, updatedAt: new Date() })
      .where(and(eq(estimates.customerId, fromId), eq(estimates.companyId, tx.companyId)))
      .returning({ id: estimates.id });

    const cmRows = await tx.db
      .update(creditMemos)
      .set({ customerId: toId })
      .where(and(eq(creditMemos.customerId, fromId), eq(creditMemos.companyId, tx.companyId)))
      .returning({ id: creditMemos.id });

    const soRows = await tx.db
      .update(salesOrders)
      .set({ customerId: toId })
      .where(and(eq(salesOrders.customerId, fromId), eq(salesOrders.companyId, tx.companyId)))
      .returning({ id: salesOrders.id });

    // Deactivate the from-customer.
    await tx.db
      .update(customers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(customers.id, fromId));

    // Audit: deactivation of the from-record.
    await writeAudit(tx, {
      action: 'delete',
      entityType: 'customer',
      entityId: fromId,
      oldValues: { isActive: fromRow.isActive, displayName: fromRow.displayName },
      newValues: { isActive: false, mergedInto: toId },
    });

    // Audit: the merge operation itself (recorded on the surviving record).
    await writeAudit(tx, {
      action: 'update',
      entityType: 'customer',
      entityId: toId,
      newValues: {
        mergedFrom: fromId,
        reassigned: {
          invoices: invRows.length,
          paymentsReceived: pmtRows.length,
          estimates: estRows.length,
          creditMemos: cmRows.length,
          salesOrders: soRows.length,
        },
      },
    });

    return {
      reassigned: {
        invoices: invRows.length,
        paymentsReceived: pmtRows.length,
        estimates: estRows.length,
        creditMemos: cmRows.length,
        salesOrders: soRows.length,
      },
      deactivatedId: fromId,
    };
  });
}

// ---------------------------------------------------------------------------
// mergeVendors
// ---------------------------------------------------------------------------

/**
 * Merge `fromId` into `toId`. Reassigns all A/P sub-ledger documents and
 * deactivates the `from` vendor. Runs inside a single transaction.
 */
export async function mergeVendors(
  ctx: ServiceContext,
  { fromId, toId }: MergeVendorsInput,
): Promise<MergeResult> {
  if (fromId === toId) {
    throw validation('Cannot merge a vendor with itself.');
  }

  const [fromRow] = await ctx.db
    .select({ id: vendors.id, displayName: vendors.displayName, isActive: vendors.isActive })
    .from(vendors)
    .where(and(eq(vendors.id, fromId), eq(vendors.companyId, ctx.companyId)));
  if (!fromRow) throw notFound(`Vendor ${fromId}`);

  const [toRow] = await ctx.db
    .select({ id: vendors.id, displayName: vendors.displayName })
    .from(vendors)
    .where(and(eq(vendors.id, toId), eq(vendors.companyId, ctx.companyId)));
  if (!toRow) throw notFound(`Vendor ${toId}`);

  return inTransaction(ctx, async (tx) => {
    const billRows = await tx.db
      .update(bills)
      .set({ vendorId: toId, updatedAt: new Date() })
      .where(and(eq(bills.vendorId, fromId), eq(bills.companyId, tx.companyId)))
      .returning({ id: bills.id });

    const bpRows = await tx.db
      .update(billPayments)
      .set({ vendorId: toId })
      .where(and(eq(billPayments.vendorId, fromId), eq(billPayments.companyId, tx.companyId)))
      .returning({ id: billPayments.id });

    const expRows = await tx.db
      .update(expenses)
      .set({ vendorId: toId })
      .where(and(eq(expenses.vendorId, fromId), eq(expenses.companyId, tx.companyId)))
      .returning({ id: expenses.id });

    const vcRows = await tx.db
      .update(vendorCredits)
      .set({ vendorId: toId })
      .where(and(eq(vendorCredits.vendorId, fromId), eq(vendorCredits.companyId, tx.companyId)))
      .returning({ id: vendorCredits.id });

    const poRows = await tx.db
      .update(purchaseOrders)
      .set({ vendorId: toId })
      .where(and(eq(purchaseOrders.vendorId, fromId), eq(purchaseOrders.companyId, tx.companyId)))
      .returning({ id: purchaseOrders.id });

    // Deactivate the from-vendor.
    await tx.db
      .update(vendors)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(vendors.id, fromId));

    await writeAudit(tx, {
      action: 'delete',
      entityType: 'vendor',
      entityId: fromId,
      oldValues: { isActive: fromRow.isActive, displayName: fromRow.displayName },
      newValues: { isActive: false, mergedInto: toId },
    });

    await writeAudit(tx, {
      action: 'update',
      entityType: 'vendor',
      entityId: toId,
      newValues: {
        mergedFrom: fromId,
        reassigned: {
          bills: billRows.length,
          billPayments: bpRows.length,
          expenses: expRows.length,
          vendorCredits: vcRows.length,
          purchaseOrders: poRows.length,
        },
      },
    });

    return {
      reassigned: {
        bills: billRows.length,
        billPayments: bpRows.length,
        expenses: expRows.length,
        vendorCredits: vcRows.length,
        purchaseOrders: poRows.length,
      },
      deactivatedId: fromId,
    };
  });
}
