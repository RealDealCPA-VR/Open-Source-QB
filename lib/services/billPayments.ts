/**
 * Bill Payments (A/P) service — Pay Bills workflow.
 *
 * A bill payment settles one or more open bills for a vendor. The GL impact is:
 *   Dr  Accounts Payable  (2000)  [reduce liability]
 *   Cr  Payment Account          [reduce asset, e.g. Checking 1000]
 *
 * All GL writes go through postJournalEntry; the returned entry.id is stored on
 * billPayments.postedEntryId so every payment is traceable to its journal entry.
 *
 * Multi-tenant safety: every query is scoped by ctx.companyId.
 * Money: all arithmetic uses Money/toAmountString — never JS floats.
 */
import { and, eq } from 'drizzle-orm';
import { Money, toAmountString } from '@/lib/money';
import {
  accounts,
  bills,
  billPayments,
  billPaymentApplications,
  vendors,
} from '@/lib/db/schema';
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
// Types
// ---------------------------------------------------------------------------

export type PaymentMethod = 'cash' | 'check' | 'credit_card' | 'ach' | 'bank_transfer' | 'other';

export interface BillApplication {
  billId: string;
  /** Amount to apply from this payment toward that bill (decimal string). */
  amountApplied: string | number;
}

export interface PayBillsInput {
  vendorId: string;
  date: Date;
  method: PaymentMethod;
  reference?: string | null;
  /** GL account that funds come from — e.g. Checking (1000), Credit Card (2100). */
  paymentAccountId: string;
  applications: BillApplication[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the A/P account (code '2000') for a company. */
async function resolveApAccount(ctx: ServiceContext): Promise<string> {
  const [apRow] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, '2000')));
  if (!apRow) {
    throw new ServiceError(
      'NOT_FOUND',
      'Accounts Payable account (code 2000) not found. Seed the default chart of accounts first.',
    );
  }
  return apRow.id;
}

/** Map a bills.status-style string back to a docStatus value. */
function deriveBillStatus(
  total: string | number,
  amountPaid: string | number,
): 'open' | 'partial' | 'paid' {
  const balance = Money.sub(total, amountPaid);
  if (balance.lessThanOrEqualTo(0)) return 'paid';
  if (Money.of(amountPaid).greaterThan(0)) return 'partial';
  return 'open';
}

// ---------------------------------------------------------------------------
// payBills
// ---------------------------------------------------------------------------

/**
 * Pay one or more open bills for a vendor in a single payment.
 *
 * Steps (all inside one transaction):
 *  1. Validate vendor belongs to company.
 *  2. Validate payment account belongs to company.
 *  3. Validate each bill: belongs to company + same vendor + has remaining balance.
 *  4. Validate amountApplied <= bill.balanceDue for each bill.
 *  5. Compute total = sum(applications[].amountApplied).
 *  6. Post GL: Dr A/P (total), Cr paymentAccountId (total).
 *  7. Insert billPayments row.
 *  8. Insert billPaymentApplications rows.
 *  9. Update each bill's amountPaid / balanceDue / status.
 * 10. Write audit log.
 */
export async function payBills(ctx: ServiceContext, input: PayBillsInput) {
  // ── basic input validation ───────────────────────────────────────────────
  if (!input.applications || input.applications.length === 0) {
    throw validation('At least one bill application is required.');
  }

  // ── vendor ownership check ───────────────────────────────────────────────
  const [vendor] = await ctx.db
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.id, input.vendorId), eq(vendors.companyId, ctx.companyId)));
  if (!vendor) throw notFound('Vendor');

  // ── payment account ownership check ─────────────────────────────────────
  const [payAcct] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(eq(accounts.id, input.paymentAccountId), eq(accounts.companyId, ctx.companyId)),
    );
  if (!payAcct) throw notFound('Payment account');

  // ── A/P account ─────────────────────────────────────────────────────────
  const apAccountId = await resolveApAccount(ctx);

  // ── validate each bill + accumulate total ────────────────────────────────
  let total = Money.zero();
  const billRows: Array<{
    id: string;
    total: string;
    amountPaid: string;
    balanceDue: string;
    applied: string; // from this payment
  }> = [];

  for (const app of input.applications) {
    const applied = Money.of(app.amountApplied);
    if (applied.lessThanOrEqualTo(0)) {
      throw validation(`amountApplied must be positive for bill ${app.billId}.`);
    }

    const [bill] = await ctx.db
      .select({
        id: bills.id,
        vendorId: bills.vendorId,
        total: bills.total,
        amountPaid: bills.amountPaid,
        balanceDue: bills.balanceDue,
        status: bills.status,
      })
      .from(bills)
      .where(and(eq(bills.id, app.billId), eq(bills.companyId, ctx.companyId)));

    if (!bill) throw notFound(`Bill ${app.billId}`);

    if (bill.vendorId !== input.vendorId) {
      throw validation(`Bill ${app.billId} does not belong to the specified vendor.`);
    }
    if (bill.status === 'void') {
      throw new ServiceError('VALIDATION', `Bill ${app.billId} is void and cannot be paid.`);
    }
    if (bill.status === 'paid') {
      throw new ServiceError('CONFLICT', `Bill ${app.billId} is already fully paid.`);
    }

    const balance = Money.of(bill.balanceDue);
    if (applied.greaterThan(balance)) {
      throw validation(
        `Amount applied (${toAmountString(applied)}) exceeds balance due ` +
          `(${toAmountString(balance)}) on bill ${app.billId}.`,
      );
    }

    total = total.plus(applied);
    billRows.push({
      id: bill.id,
      total: bill.total,
      amountPaid: bill.amountPaid,
      balanceDue: bill.balanceDue,
      applied: toAmountString(applied),
    });
  }

  if (total.isZero()) {
    throw validation('Total payment amount must be greater than zero.');
  }

  const totalStr = toAmountString(total);

  // ── all good — run inside one transaction ────────────────────────────────
  return inTransaction(ctx, async (tx) => {
    // 1. Post the journal entry
    //    Dr A/P (reduces liability — debit a credit-normal account)
    //    Cr Payment Account (reduces asset)
    const entry = await postJournalEntry(tx, {
      date: input.date,
      description: `Bill payment — ${vendor.id}`,
      reference: input.reference ?? null,
      sourceRef: `vendor:${input.vendorId}`,
      lines: [
        {
          accountId: apAccountId,
          debit: totalStr,
          memo: `A/P payment to vendor ${input.vendorId}`,
        },
        {
          accountId: input.paymentAccountId,
          credit: totalStr,
          memo: `Bill payment — ref: ${input.reference ?? 'n/a'}`,
        },
      ],
    });

    // 2. Insert billPayments header
    const [payment] = await tx.db
      .insert(billPayments)
      .values({
        companyId: tx.companyId,
        vendorId: input.vendorId,
        date: input.date,
        method: input.method,
        reference: input.reference ?? null,
        amount: totalStr,
        paymentAccountId: input.paymentAccountId,
        postedEntryId: entry.id,
      })
      .returning();

    // 3. Insert applications + update each bill
    for (const row of billRows) {
      // Insert the application link
      await tx.db.insert(billPaymentApplications).values({
        billPaymentId: payment.id,
        billId: row.id,
        amountApplied: row.applied,
      });

      // Update the bill: amountPaid += applied, balanceDue -= applied, status
      const newAmountPaid = toAmountString(Money.add(row.amountPaid, row.applied));
      const newBalanceDue = toAmountString(Money.sub(row.total, newAmountPaid));
      const newStatus = deriveBillStatus(row.total, newAmountPaid);

      await tx.db
        .update(bills)
        .set({
          amountPaid: newAmountPaid,
          balanceDue: newBalanceDue,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(bills.id, row.id));
    }

    // 4. Audit log
    await writeAudit(tx, {
      action: 'create',
      entityType: 'bill_payment',
      entityId: payment.id,
      newValues: {
        vendorId: input.vendorId,
        amount: totalStr,
        method: input.method,
        reference: input.reference,
        postedEntryId: entry.id,
        applications: billRows.map((r) => ({ billId: r.id, amountApplied: r.applied })),
      },
    });

    return payment;
  });
}

// ---------------------------------------------------------------------------
// listBillPayments
// ---------------------------------------------------------------------------

export interface ListBillPaymentsOptions {
  vendorId?: string;
  /** Max rows; defaults to 100. */
  limit?: number;
  offset?: number;
}

/**
 * List bill payments for the company, optionally filtered by vendor.
 * Returns payments newest-first (by date desc, then createdAt desc).
 */
export async function listBillPayments(
  ctx: ServiceContext,
  opts?: ListBillPaymentsOptions,
) {
  const conditions = [eq(billPayments.companyId, ctx.companyId)];
  if (opts?.vendorId) {
    conditions.push(eq(billPayments.vendorId, opts.vendorId));
  }

  const rows = await ctx.db
    .select()
    .from(billPayments)
    .where(and(...conditions))
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0)
    .orderBy(billPayments.date, billPayments.createdAt);

  return rows;
}
