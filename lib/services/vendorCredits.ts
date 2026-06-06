/**
 * Vendor Credits (A/P credits) service.
 *
 * A vendor credit records an amount that a vendor owes the company (e.g. returned goods,
 * negotiated discount after the fact). The posting pattern is the reverse of a bill:
 *
 *   Dr  Accounts Payable  2000      (total — reduces the A/P liability)
 *   Cr  <expense/asset account per line>   (line.amount)
 *
 * Application to a bill (applyToBill) reduces the bill's balanceDue and the credit's
 * unapplied balance.  No new GL entry is needed because the A/P balance was already
 * reduced when the credit was posted; the application is a bookkeeping memo only.
 *
 * Voiding calls voidJournalEntry and flips the document status to 'void'.
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import { accounts, bills, vendorCredits, vendorCreditLines, vendors } from '@/lib/db/schema';
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
// Input types
// ---------------------------------------------------------------------------

export interface VendorCreditLineInput {
  /** GL account to credit (typically an expense or asset account). */
  accountId: string;
  description?: string | null;
  /** The dollar amount for this line (must be > 0). */
  amount: string | number;
}

export interface CreateVendorCreditInput {
  vendorId: string;
  date: Date;
  memo?: string | null;
  lines: VendorCreditLineInput[];
}

export interface ApplyToBillInput {
  vendorCreditId: string;
  billId: string;
  /** Amount to apply (must be <= credit.unapplied and <= bill.balanceDue). */
  amount: string | number;
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

// ---------------------------------------------------------------------------
// createVendorCredit
// ---------------------------------------------------------------------------

export async function createVendorCredit(ctx: ServiceContext, input: CreateVendorCreditInput) {
  // Verify vendor belongs to this company.
  const [vendor] = await ctx.db
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.id, input.vendorId), eq(vendors.companyId, ctx.companyId)));
  if (!vendor) throw notFound('Vendor');

  // Validate lines.
  if (!input.lines || input.lines.length === 0) {
    throw validation('A vendor credit must have at least one line.');
  }

  let total = Money.zero();
  for (const [i, line] of input.lines.entries()) {
    const amt = Money.of(line.amount);
    if (!amt.greaterThan(0)) {
      throw validation(`Line ${i + 1}: amount must be greater than zero.`);
    }
    total = total.plus(amt);
  }
  const totalStr = toAmountString(total);

  // Resolve A/P before opening the transaction.
  const apAccountId = await resolveApAccount(ctx);

  return inTransaction(ctx, async (tx) => {
    // 1) Insert the vendor credit header.
    const [credit] = await tx.db
      .insert(vendorCredits)
      .values({
        companyId: tx.companyId,
        vendorId: input.vendorId,
        date: input.date,
        memo: input.memo ?? null,
        status: 'open',
        total: totalStr,
        unapplied: totalStr,
      })
      .returning();

    // 2) Insert lines.
    await tx.db.insert(vendorCreditLines).values(
      input.lines.map((line, idx) => ({
        vendorCreditId: credit.id,
        accountId: line.accountId,
        description: line.description ?? null,
        amount: toAmountString(line.amount),
        lineOrder: idx,
      })),
    );

    // 3) Build and post the GL entry.
    //
    //   Dr  2000 Accounts Payable   total   (reduces A/P liability — Dr on liability = decrease)
    //   Cr  <expense account>       each line amount
    //
    // Debits == Credits because sum(line amounts) = total.

    const postingLines = [
      // Debit A/P to reduce the liability.
      {
        accountId: apAccountId,
        debit: totalStr,
        memo: `Vendor credit ${credit.id}`,
      },
      // Credit each expense/asset account for its line amount.
      ...input.lines.map((line) => ({
        accountId: line.accountId,
        credit: toAmountString(line.amount),
        memo: line.description ?? null,
      })),
    ];

    const entry = await postJournalEntry(tx, {
      date: input.date,
      description: `Vendor Credit — ${vendor.id}`,
      sourceRef: `vendor_credit:${credit.id}`,
      lines: postingLines,
    });

    // 4) Stamp postedEntryId.
    const [updated] = await tx.db
      .update(vendorCredits)
      .set({ postedEntryId: entry.id })
      .where(eq(vendorCredits.id, credit.id))
      .returning();

    await writeAudit(tx, {
      action: 'create',
      entityType: 'vendor_credit',
      entityId: credit.id,
      newValues: { ...updated, linesCount: input.lines.length, total: totalStr },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// listVendorCredits
// ---------------------------------------------------------------------------

export async function listVendorCredits(
  ctx: ServiceContext,
  opts?: { vendorId?: string; status?: string },
) {
  const conditions = [eq(vendorCredits.companyId, ctx.companyId)];
  if (opts?.vendorId) conditions.push(eq(vendorCredits.vendorId, opts.vendorId));
  if (opts?.status) conditions.push(eq(vendorCredits.status, opts.status as never));

  return ctx.db
    .select()
    .from(vendorCredits)
    .where(and(...conditions))
    .orderBy(desc(vendorCredits.date), asc(vendorCredits.createdAt));
}

// ---------------------------------------------------------------------------
// getVendorCredit (with lines)
// ---------------------------------------------------------------------------

export async function getVendorCredit(ctx: ServiceContext, id: string) {
  const [credit] = await ctx.db
    .select()
    .from(vendorCredits)
    .where(and(eq(vendorCredits.id, id), eq(vendorCredits.companyId, ctx.companyId)));
  if (!credit) throw notFound('Vendor credit');

  const lines = await ctx.db
    .select()
    .from(vendorCreditLines)
    .where(eq(vendorCreditLines.vendorCreditId, id))
    .orderBy(asc(vendorCreditLines.lineOrder));

  return { ...credit, lines };
}

// ---------------------------------------------------------------------------
// applyToBill
// ---------------------------------------------------------------------------

/**
 * Apply a vendor credit to an open bill.
 *
 * This does NOT post a new GL entry — the credit already reduced A/P when it
 * was created.  Here we just track the application so reporting shows the
 * bill is reduced and the credit is consumed.
 */
export async function applyToBill(ctx: ServiceContext, input: ApplyToBillInput) {
  const applyAmount = Money.round2(input.amount);

  if (!applyAmount.greaterThan(0)) {
    throw validation('Apply amount must be greater than zero.');
  }

  // Load the vendor credit (scoped to company).
  const [credit] = await ctx.db
    .select()
    .from(vendorCredits)
    .where(and(eq(vendorCredits.id, input.vendorCreditId), eq(vendorCredits.companyId, ctx.companyId)));
  if (!credit) throw notFound('Vendor credit');

  if (credit.status === 'void') {
    throw new ServiceError('CONFLICT', 'Cannot apply a voided vendor credit.');
  }

  const unapplied = Money.of(credit.unapplied);
  if (applyAmount.greaterThan(unapplied)) {
    throw validation(
      `Apply amount ${toAmountString(applyAmount)} exceeds the credit's unapplied balance ${toAmountString(unapplied)}.`,
    );
  }

  // Load the bill (scoped to company).
  const [bill] = await ctx.db
    .select()
    .from(bills)
    .where(and(eq(bills.id, input.billId), eq(bills.companyId, ctx.companyId)));
  if (!bill) throw notFound('Bill');

  if (bill.status === 'void') {
    throw new ServiceError('CONFLICT', 'Cannot apply a credit to a voided bill.');
  }

  const balanceDue = Money.of(bill.balanceDue);
  if (applyAmount.greaterThan(balanceDue)) {
    throw validation(
      `Apply amount ${toAmountString(applyAmount)} exceeds the bill's balance due ${toAmountString(balanceDue)}.`,
    );
  }

  // Verify the credit and bill belong to the same vendor.
  if (credit.vendorId !== bill.vendorId) {
    throw validation('Vendor credit and bill must belong to the same vendor.');
  }

  return inTransaction(ctx, async (tx) => {
    // Update credit's unapplied balance.
    const newUnapplied = unapplied.minus(applyAmount);
    const newCreditStatus = newUnapplied.isZero() ? 'closed' : 'partial';

    const [updatedCredit] = await tx.db
      .update(vendorCredits)
      .set({
        unapplied: toAmountString(newUnapplied),
        status: newCreditStatus as never,
      })
      .where(eq(vendorCredits.id, input.vendorCreditId))
      .returning();

    // Update bill's amountPaid and balanceDue.
    const newAmountPaid = Money.round2(Money.of(bill.amountPaid).plus(applyAmount));
    const newBalanceDue = Money.round2(balanceDue.minus(applyAmount));
    const newBillStatus = newBalanceDue.isZero()
      ? 'paid'
      : newAmountPaid.greaterThan(0)
        ? 'partial'
        : 'open';

    const [updatedBill] = await tx.db
      .update(bills)
      .set({
        amountPaid: toAmountString(newAmountPaid),
        balanceDue: toAmountString(newBalanceDue),
        status: newBillStatus as never,
        updatedAt: new Date(),
      })
      .where(eq(bills.id, input.billId))
      .returning();

    await writeAudit(tx, {
      action: 'update',
      entityType: 'vendor_credit',
      entityId: input.vendorCreditId,
      newValues: {
        action: 'applied_to_bill',
        billId: input.billId,
        amount: toAmountString(applyAmount),
        newUnapplied: toAmountString(newUnapplied),
      },
    });

    return { credit: updatedCredit, bill: updatedBill };
  });
}

// ---------------------------------------------------------------------------
// voidVendorCredit
// ---------------------------------------------------------------------------

export async function voidVendorCredit(ctx: ServiceContext, id: string) {
  const [credit] = await ctx.db
    .select()
    .from(vendorCredits)
    .where(and(eq(vendorCredits.id, id), eq(vendorCredits.companyId, ctx.companyId)));
  if (!credit) throw notFound('Vendor credit');

  if (credit.status === 'void') {
    // Idempotent.
    return credit;
  }

  // Block voiding if the credit has been partially or fully applied.
  const appliedAmount = Money.of(credit.total).minus(Money.of(credit.unapplied));
  if (appliedAmount.greaterThan(0)) {
    throw new ServiceError(
      'CONFLICT',
      'Cannot void a vendor credit that has been applied to a bill. Unapply first.',
    );
  }

  return inTransaction(ctx, async (tx) => {
    // Reverse the GL entry.
    if (credit.postedEntryId) {
      await voidJournalEntry(tx, credit.postedEntryId);
    }

    const [updated] = await tx.db
      .update(vendorCredits)
      .set({ status: 'void', unapplied: '0.00' })
      .where(eq(vendorCredits.id, id))
      .returning();

    await writeAudit(tx, {
      action: 'void',
      entityType: 'vendor_credit',
      entityId: id,
      oldValues: { status: credit.status },
      newValues: { status: 'void' },
    });

    return updated;
  });
}
