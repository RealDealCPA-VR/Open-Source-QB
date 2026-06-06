/**
 * Payments Received (A/R) service.
 *
 * receivePayment:
 *   Dr  deposit account (bank or Undeposited Funds)   amount
 *   Cr  Accounts Receivable (1200)                    amount
 *
 * Then for each application, the invoice's amountPaid / balanceDue / status are updated.
 * The returned paymentsReceived row's `postedEntryId` links back to the journal entry.
 */
import { and, eq } from 'drizzle-orm';
import {
  accounts,
  customers,
  invoices,
  paymentsReceived,
  paymentApplications,
} from '@/lib/db/schema';
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

// ---- Types ------------------------------------------------------------------

export interface PaymentApplication {
  invoiceId: string;
  amountApplied: string | number;
}

export interface ReceivePaymentInput {
  customerId: string;
  date: Date;
  /** Payment method (cash|check|credit_card|ach|bank_transfer|other). */
  method: 'cash' | 'check' | 'credit_card' | 'ach' | 'bank_transfer' | 'other';
  reference?: string | null;
  /** Total payment amount received from the customer. */
  amount: string | number;
  /**
   * GL account where the funds land. Defaults to Undeposited Funds (code 1050).
   * Pass a checking account ID to deposit directly to the bank.
   */
  depositAccountId?: string | null;
  /**
   * Which open invoices this payment covers. Sum may be ≤ amount; any remainder
   * is recorded as `unapplied` on the payment.
   */
  applications: PaymentApplication[];
}

// ---- Helpers ----------------------------------------------------------------

/** Resolve the Undeposited Funds account id for the company (code 1050). */
async function getUndepositedFundsId(ctx: ServiceContext): Promise<string> {
  const [row] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, '1050')));
  if (!row) throw new ServiceError('NOT_FOUND', 'Undeposited Funds account (1050) not found.');
  return row.id;
}

/** Resolve the A/R account id for the company (code 1200). */
async function getArAccountId(ctx: ServiceContext): Promise<string> {
  const [row] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, '1200')));
  if (!row) throw new ServiceError('NOT_FOUND', 'Accounts Receivable account (1200) not found.');
  return row.id;
}

// ---- Public API -------------------------------------------------------------

/**
 * Record a payment received from a customer, post the GL entry, and apply the
 * payment to one or more open invoices.
 *
 * Posting:
 *   Dr  depositAccount    amount   (asset increases — cash/undeposited funds)
 *   Cr  A/R (1200)        amount   (asset decreases — customer owes less)
 */
export async function receivePayment(ctx: ServiceContext, input: ReceivePaymentInput) {
  // --- Validate customer belongs to this company ---
  const [customer] = await ctx.db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.id, input.customerId), eq(customers.companyId, ctx.companyId)));
  if (!customer) throw notFound('Customer');

  // --- Validate amount ---
  const totalAmount = Money.of(input.amount);
  if (!totalAmount.greaterThan(0)) throw validation('Payment amount must be greater than zero.');

  // --- Validate and sum applications ---
  let sumApplied = Money.zero();
  for (const app of input.applications) {
    const applied = Money.of(app.amountApplied);
    if (!applied.greaterThan(0)) throw validation('Each applied amount must be greater than zero.');
    sumApplied = sumApplied.plus(applied);
  }
  if (sumApplied.greaterThan(totalAmount)) {
    throw validation(
      `Sum of applications (${toAmountString(sumApplied)}) exceeds payment amount (${toAmountString(totalAmount)}).`,
    );
  }

  // --- Verify all referenced invoices belong to this company and customer ---
  const invoiceIds = input.applications.map((a) => a.invoiceId);
  const invoiceRows =
    invoiceIds.length > 0
      ? await ctx.db
          .select({
            id: invoices.id,
            customerId: invoices.customerId,
            balanceDue: invoices.balanceDue,
            amountPaid: invoices.amountPaid,
            status: invoices.status,
          })
          .from(invoices)
          .where(and(eq(invoices.companyId, ctx.companyId)))
      : [];

  const invoiceById = new Map(invoiceRows.map((r) => [r.id, r]));
  for (const app of input.applications) {
    const inv = invoiceById.get(app.invoiceId);
    if (!inv) throw notFound(`Invoice ${app.invoiceId}`);
    if (inv.customerId !== input.customerId) {
      throw validation(`Invoice ${app.invoiceId} does not belong to the specified customer.`);
    }
    if (inv.status === 'void') {
      throw validation(`Invoice ${app.invoiceId} is voided and cannot receive payments.`);
    }
  }

  // --- Resolve deposit account (default: Undeposited Funds) ---
  const depositAccountId =
    input.depositAccountId ?? (await getUndepositedFundsId(ctx));

  // Confirm the deposit account is actually in this company.
  const [depAcct] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, depositAccountId), eq(accounts.companyId, ctx.companyId)));
  if (!depAcct) throw notFound('Deposit account');

  const arAccountId = await getArAccountId(ctx);
  const amountStr = toAmountString(totalAmount);
  const unapplied = Money.sub(totalAmount, sumApplied);

  // --- Everything below runs atomically ---
  return inTransaction(ctx, async (tx) => {
    // 1. Post the GL entry: Dr deposit account / Cr A/R
    const entry = await postJournalEntry(tx, {
      date: input.date,
      description: `Payment received from customer`,
      reference: input.reference ?? null,
      sourceRef: `customer:${input.customerId}`,
      lines: [
        { accountId: depositAccountId, debit: amountStr, memo: 'Payment received' },
        { accountId: arAccountId, credit: amountStr, memo: 'A/R reduction' },
      ],
    });

    // 2. Insert the paymentsReceived record
    const [payment] = await tx.db
      .insert(paymentsReceived)
      .values({
        companyId: tx.companyId,
        customerId: input.customerId,
        date: input.date,
        method: input.method,
        reference: input.reference ?? null,
        amount: amountStr,
        unapplied: toAmountString(unapplied),
        depositAccountId,
        postedEntryId: entry.id,
      })
      .returning();

    // 3. Insert payment applications and update invoices
    for (const app of input.applications) {
      const applied = Money.of(app.amountApplied);
      const appliedStr = toAmountString(applied);

      // Insert application row
      await tx.db.insert(paymentApplications).values({
        paymentId: payment.id,
        invoiceId: app.invoiceId,
        amountApplied: appliedStr,
      });

      // Update invoice: increment amountPaid, decrement balanceDue, update status
      const inv = invoiceById.get(app.invoiceId)!;
      const newAmountPaid = Money.add(inv.amountPaid, applied);
      const newBalanceDue = Money.sub(inv.balanceDue, applied);
      // Clamp to zero in case of overpayment rounding edge
      const clampedBalanceDue = newBalanceDue.lessThan(0) ? Money.zero() : newBalanceDue;
      const newStatus = clampedBalanceDue.isZero() ? 'paid' : 'partial';

      await tx.db
        .update(invoices)
        .set({
          amountPaid: toAmountString(newAmountPaid),
          balanceDue: toAmountString(clampedBalanceDue),
          status: newStatus as 'paid' | 'partial',
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, app.invoiceId));
    }

    // 4. Audit log
    await writeAudit(tx, {
      action: 'create',
      entityType: 'payment_received',
      entityId: payment.id,
      newValues: {
        customerId: input.customerId,
        amount: amountStr,
        method: input.method,
        applications: input.applications,
        postedEntryId: entry.id,
      },
    });

    return { payment, entry };
  });
}

/** List all payments received for the company, newest first. */
export async function listPayments(
  ctx: ServiceContext,
  opts?: { customerId?: string; limit?: number; offset?: number },
) {
  // Build conditions
  const rows = await ctx.db
    .select()
    .from(paymentsReceived)
    .where(
      opts?.customerId
        ? and(
            eq(paymentsReceived.companyId, ctx.companyId),
            eq(paymentsReceived.customerId, opts.customerId),
          )
        : eq(paymentsReceived.companyId, ctx.companyId),
    )
    .limit(opts?.limit ?? 100)
    .offset(opts?.offset ?? 0);
  return rows;
}

/** Fetch a single payment (and its applications) by id. Throws NOT_FOUND if missing. */
export async function getPayment(ctx: ServiceContext, id: string) {
  const [payment] = await ctx.db
    .select()
    .from(paymentsReceived)
    .where(and(eq(paymentsReceived.id, id), eq(paymentsReceived.companyId, ctx.companyId)));
  if (!payment) throw notFound('Payment');

  const applications = await ctx.db
    .select()
    .from(paymentApplications)
    .where(eq(paymentApplications.paymentId, id));

  return { ...payment, applications };
}
