/**
 * Customer statements and 1099 vendor reports.
 *
 * customerStatement — chronological ledger for a customer combining invoices
 *   (charges) and payments received (credits) with a running balance.
 *
 * vendor1099Report — sums payments to 1099-flagged vendors for a calendar year.
 *   Combines bill payments (via bill_payment_applications) and direct expenses.
 *   Only vendors with total >= $600 are included as eligible.
 */
import { and, eq, gte, lt, ne, sql } from 'drizzle-orm';
import {
  bills,
  billPaymentApplications,
  billPayments,
  customers,
  expenses,
  invoices,
  paymentsReceived,
  vendors,
} from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import { notFound, type ServiceContext } from './_base';

// ---------------------------------------------------------------------------
// Customer Statement
// ---------------------------------------------------------------------------

export interface StatementLine {
  date: string;
  type: 'invoice' | 'payment';
  /** Invoice number (for invoices) or payment reference (for payments). */
  ref: string | null;
  /** Positive for invoices (charges); positive for payments (amount received). */
  amount: string;
  /** Running balance after this line (positive = customer owes). */
  runningBalance: string;
}

export interface CustomerStatement {
  customer: {
    id: string;
    displayName: string;
    companyName: string | null;
    email: string | null;
  };
  from: string | null;
  to: string | null;
  /** Balance before the first line in the period (sum of prior open items). */
  openingBalance: string;
  lines: StatementLine[];
  closingBalance: string;
}

export async function customerStatement(
  ctx: ServiceContext,
  customerId: string,
  range?: { from?: Date; to?: Date },
): Promise<CustomerStatement> {
  // Verify the customer belongs to this company.
  const [cust] = await ctx.db
    .select({
      id: customers.id,
      displayName: customers.displayName,
      companyName: customers.companyName,
      email: customers.email,
      companyId: customers.companyId,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, ctx.companyId)));

  if (!cust) throw notFound('Customer');

  // --- Opening balance: sum of all charges and credits BEFORE the range start ---
  // We compute it by fetching all pre-range activity (if a from date is given).
  let openingBalance = Money.zero();

  if (range?.from) {
    // Invoices before range start (non-void)
    const [priorInvoiceRow] = await ctx.db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS NUMERIC)), 0)`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.companyId, ctx.companyId),
          eq(invoices.customerId, customerId),
          ne(invoices.status, 'void'),
          lt(invoices.date, range.from),
        ),
      );

    // Payments before range start
    const [priorPaymentRow] = await ctx.db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${paymentsReceived.amount} AS NUMERIC)), 0)`,
      })
      .from(paymentsReceived)
      .where(
        and(
          eq(paymentsReceived.companyId, ctx.companyId),
          eq(paymentsReceived.customerId, customerId),
          lt(paymentsReceived.date, range.from),
        ),
      );

    const priorInvoices = Money.of(priorInvoiceRow?.total ?? '0');
    const priorPayments = Money.of(priorPaymentRow?.total ?? '0');
    openingBalance = priorInvoices.minus(priorPayments);
  }

  // --- In-range invoices ---
  const invoiceConds = [
    eq(invoices.companyId, ctx.companyId),
    eq(invoices.customerId, customerId),
    ne(invoices.status, 'void'),
  ];
  if (range?.from) invoiceConds.push(gte(invoices.date, range.from));
  if (range?.to) invoiceConds.push(lt(invoices.date, new Date(range.to.getTime() + 86_400_000)));

  const invoiceRows = await ctx.db
    .select({
      date: invoices.date,
      invoiceNumber: invoices.invoiceNumber,
      total: invoices.total,
    })
    .from(invoices)
    .where(and(...invoiceConds));

  // --- In-range payments received ---
  const paymentConds = [
    eq(paymentsReceived.companyId, ctx.companyId),
    eq(paymentsReceived.customerId, customerId),
  ];
  if (range?.from) paymentConds.push(gte(paymentsReceived.date, range.from));
  if (range?.to)
    paymentConds.push(lt(paymentsReceived.date, new Date(range.to.getTime() + 86_400_000)));

  const paymentRows = await ctx.db
    .select({
      date: paymentsReceived.date,
      reference: paymentsReceived.reference,
      amount: paymentsReceived.amount,
    })
    .from(paymentsReceived)
    .where(and(...paymentConds));

  // --- Merge and sort chronologically ---
  type RawLine =
    | { kind: 'invoice'; date: Date; ref: string; amount: string }
    | { kind: 'payment'; date: Date; ref: string | null; amount: string };

  const raw: RawLine[] = [
    ...invoiceRows.map((r) => ({
      kind: 'invoice' as const,
      date: r.date,
      ref: String(r.invoiceNumber),
      amount: r.total,
    })),
    ...paymentRows.map((r) => ({
      kind: 'payment' as const,
      date: r.date,
      ref: r.reference ?? null,
      amount: r.amount,
    })),
  ];

  raw.sort((a, b) => a.date.getTime() - b.date.getTime());

  // --- Compute running balance ---
  let running = openingBalance;
  const lines: StatementLine[] = raw.map((r) => {
    if (r.kind === 'invoice') {
      running = running.plus(Money.of(r.amount));
    } else {
      running = running.minus(Money.of(r.amount));
    }
    return {
      date: r.date.toISOString().slice(0, 10),
      type: r.kind,
      ref: r.ref,
      amount: toAmountString(r.amount),
      runningBalance: toAmountString(running),
    };
  });

  return {
    customer: {
      id: cust.id,
      displayName: cust.displayName,
      companyName: cust.companyName ?? null,
      email: cust.email ?? null,
    },
    from: range?.from?.toISOString().slice(0, 10) ?? null,
    to: range?.to?.toISOString().slice(0, 10) ?? null,
    openingBalance: toAmountString(openingBalance),
    lines,
    closingBalance: toAmountString(running),
  };
}

// ---------------------------------------------------------------------------
// 1099 Vendor Report
// ---------------------------------------------------------------------------

export interface Vendor1099Row {
  vendorId: string;
  vendorName: string;
  taxId: string | null;
  /** Total payments in the calendar year, formatted as decimal string. */
  total: string;
}

const THRESHOLD_1099 = Money.of('600');

/**
 * Aggregate vendor payments for a calendar year (Jan 1 – Dec 31).
 * Sources:
 *   1. Bill payments applied to bills that belong to an is_1099 vendor.
 *   2. Direct expenses linked to an is_1099 vendor.
 * Only vendors with total >= $600 are returned.
 */
export async function vendor1099Report(
  ctx: ServiceContext,
  { year }: { year: number },
): Promise<Vendor1099Row[]> {
  const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);
  const yearEnd = new Date(`${year + 1}-01-01T00:00:00.000Z`);

  // --- Bill payments applied to vendors that are is_1099 ---
  // Join: bill_payment_applications -> bill_payments (date filter) -> bills (vendorId) -> vendors (is1099)
  const billPaymentRows = await ctx.db
    .select({
      vendorId: vendors.id,
      vendorName: vendors.displayName,
      taxId: vendors.taxId,
      amountApplied: billPaymentApplications.amountApplied,
    })
    .from(billPaymentApplications)
    .innerJoin(billPayments, eq(billPaymentApplications.billPaymentId, billPayments.id))
    .innerJoin(bills, eq(billPaymentApplications.billId, bills.id))
    .innerJoin(vendors, eq(bills.vendorId, vendors.id))
    .where(
      and(
        eq(billPayments.companyId, ctx.companyId),
        eq(vendors.is1099, true),
        gte(billPayments.date, yearStart),
        lt(billPayments.date, yearEnd),
      ),
    );

  // --- Direct expenses linked to a 1099 vendor ---
  const expenseRows = await ctx.db
    .select({
      vendorId: vendors.id,
      vendorName: vendors.displayName,
      taxId: vendors.taxId,
      total: expenses.total,
    })
    .from(expenses)
    .innerJoin(vendors, eq(expenses.vendorId, vendors.id))
    .where(
      and(
        eq(expenses.companyId, ctx.companyId),
        eq(vendors.is1099, true),
        gte(expenses.date, yearStart),
        lt(expenses.date, yearEnd),
      ),
    );

  // --- Aggregate per vendor ---
  const totals = new Map<
    string,
    { vendorName: string; taxId: string | null; total: ReturnType<typeof Money.zero> }
  >();

  function accumulate(vendorId: string, vendorName: string, taxId: string | null, amount: string) {
    if (!totals.has(vendorId)) {
      totals.set(vendorId, { vendorName, taxId, total: Money.zero() });
    }
    totals.get(vendorId)!.total = totals.get(vendorId)!.total.plus(Money.of(amount));
  }

  for (const r of billPaymentRows) {
    accumulate(r.vendorId, r.vendorName, r.taxId ?? null, r.amountApplied);
  }
  for (const r of expenseRows) {
    accumulate(r.vendorId, r.vendorName, r.taxId ?? null, r.total);
  }

  // --- Filter to >= $600 ---
  const result: Vendor1099Row[] = [];
  for (const [vendorId, { vendorName, taxId, total }] of totals) {
    if (total.greaterThanOrEqualTo(THRESHOLD_1099)) {
      result.push({
        vendorId,
        vendorName,
        taxId,
        total: toAmountString(total),
      });
    }
  }

  // Sort descending by total
  result.sort((a, b) => Money.of(b.total).comparedTo(Money.of(a.total)));

  return result;
}
