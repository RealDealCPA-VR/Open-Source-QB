/**
 * Customer statements and 1099 vendor reports.
 *
 * customerStatement — chronological "balance forward" ledger for a customer
 *   combining invoices (charges) and payments received (credits) with a
 *   running balance.
 *
 * openItemStatement — QB "Open Item" statement format: each unpaid/partially
 *   paid invoice as of a date, with days past due, per-invoice aging bucket,
 *   and an aging summary footer (Current / 1-30 / 31-60 / 61-90 / 90+).
 *
 * batchStatements — month-end batch run: generates a statement (either format)
 *   for every active customer that has something to report.
 *
 * vendor1099Report — sums payments to 1099-flagged vendors for a calendar year.
 *   Combines bill payments (via bill_payment_applications) and direct expenses.
 *   Only vendors with total >= $600 are included as eligible.
 */
import { and, asc, eq, gt, gte, inArray, isNull, lt, ne, not, or, sql } from 'drizzle-orm';
import {
  accounts,
  bills,
  billPaymentApplications,
  billPayments,
  creditMemos,
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
  type: 'invoice' | 'payment' | 'credit_memo';
  /** Invoice number (invoices), payment reference (payments), or memo number (credit memos). */
  ref: string | null;
  /** Positive for invoices (charges); positive for payments/credit memos (credits). */
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

    // Credit memos before range start (non-void) — they credit A/R at creation,
    // so they reduce what the customer owes just like payments.
    const [priorCreditMemoRow] = await ctx.db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${creditMemos.total} AS NUMERIC)), 0)`,
      })
      .from(creditMemos)
      .where(
        and(
          eq(creditMemos.companyId, ctx.companyId),
          eq(creditMemos.customerId, customerId),
          ne(creditMemos.status, 'void'),
          lt(creditMemos.date, range.from),
        ),
      );

    const priorInvoices = Money.of(priorInvoiceRow?.total ?? '0');
    const priorPayments = Money.of(priorPaymentRow?.total ?? '0');
    const priorCreditMemos = Money.of(priorCreditMemoRow?.total ?? '0');
    openingBalance = priorInvoices.minus(priorPayments).minus(priorCreditMemos);
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

  // --- In-range credit memos ---
  // A credit memo credits A/R in the GL at creation (not at application), so the
  // statement shows its FULL total dated at creation — this keeps it double-count-free
  // because applying a memo to an invoice posts nothing.
  const creditMemoConds = [
    eq(creditMemos.companyId, ctx.companyId),
    eq(creditMemos.customerId, customerId),
    ne(creditMemos.status, 'void'),
  ];
  if (range?.from) creditMemoConds.push(gte(creditMemos.date, range.from));
  if (range?.to)
    creditMemoConds.push(lt(creditMemos.date, new Date(range.to.getTime() + 86_400_000)));

  const creditMemoRows = await ctx.db
    .select({
      date: creditMemos.date,
      memoNumber: creditMemos.memoNumber,
      total: creditMemos.total,
    })
    .from(creditMemos)
    .where(and(...creditMemoConds));

  // --- Merge and sort chronologically ---
  type RawLine =
    | { kind: 'invoice'; date: Date; ref: string; amount: string }
    | { kind: 'payment'; date: Date; ref: string | null; amount: string }
    | { kind: 'credit_memo'; date: Date; ref: string; amount: string };

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
    ...creditMemoRows.map((r) => ({
      kind: 'credit_memo' as const,
      date: r.date,
      ref: String(r.memoNumber),
      amount: r.total,
    })),
  ];

  raw.sort((a, b) => a.date.getTime() - b.date.getTime());

  // --- Compute running balance ---
  let running = openingBalance;
  const lines: StatementLine[] = raw.map((r) => {
    if (r.kind === 'invoice') {
      running = running.plus(Money.of(r.amount));
    } else {
      // Payments and credit memos both reduce what the customer owes.
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
// Open-Item Statement (QB "Open Item" format)
// ---------------------------------------------------------------------------

export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export interface OpenItemLine {
  invoiceId: string;
  /** ISO invoice date (YYYY-MM-DD). */
  date: string;
  invoiceNumber: number;
  /** ISO due date; falls back to the invoice date when no due date was set. */
  dueDate: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
  /** Whole days past due as of the statement date (0 when not yet due). */
  daysPastDue: number;
  agingBucket: AgingBucket;
}

export interface AgingSummary {
  current: string;
  days1_30: string;
  days31_60: string;
  days61_90: string;
  days90Plus: string;
}

export interface OpenItemStatement {
  customer: {
    id: string;
    displayName: string;
    companyName: string | null;
    email: string | null;
  };
  /** Statement date (ISO). */
  asOf: string;
  lines: OpenItemLine[];
  aging: AgingSummary;
  totalDue: string;
}

const DAY_MS = 86_400_000;

function bucketFor(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0) return 'current';
  if (daysPastDue <= 30) return '1-30';
  if (daysPastDue <= 60) return '31-60';
  if (daysPastDue <= 90) return '61-90';
  return '90+';
}

/**
 * Open-item statement: every invoice that still carries a balance as of `asOf`
 * (dated on/before it), with per-invoice aging and an aging summary footer.
 * Uses the invoice's CURRENT balanceDue (matches the A/R aging report).
 */
export async function openItemStatement(
  ctx: ServiceContext,
  customerId: string,
  asOf: Date = new Date(),
): Promise<OpenItemStatement> {
  const [cust] = await ctx.db
    .select({
      id: customers.id,
      displayName: customers.displayName,
      companyName: customers.companyName,
      email: customers.email,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.companyId, ctx.companyId)));
  if (!cust) throw notFound('Customer');

  // Invoices dated on/before asOf (end of day) that still carry a balance.
  const asOfEnd = new Date(asOf.getTime() + DAY_MS);
  const rows = await ctx.db
    .select({
      id: invoices.id,
      date: invoices.date,
      dueDate: invoices.dueDate,
      invoiceNumber: invoices.invoiceNumber,
      total: invoices.total,
      amountPaid: invoices.amountPaid,
      balanceDue: invoices.balanceDue,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.companyId, ctx.companyId),
        eq(invoices.customerId, customerId),
        inArray(invoices.status, ['open', 'partial', 'overdue']),
        gt(sql`CAST(${invoices.balanceDue} AS NUMERIC)`, 0),
        lt(invoices.date, asOfEnd),
      ),
    )
    .orderBy(asc(invoices.date), asc(invoices.invoiceNumber));

  const bucketTotals: Record<AgingBucket, ReturnType<typeof Money.zero>> = {
    current: Money.zero(),
    '1-30': Money.zero(),
    '31-60': Money.zero(),
    '61-90': Money.zero(),
    '90+': Money.zero(),
  };
  let totalDue = Money.zero();

  const lines: OpenItemLine[] = rows.map((r) => {
    const effDue = r.dueDate ?? r.date;
    const daysPastDue = Math.max(0, Math.floor((asOf.getTime() - effDue.getTime()) / DAY_MS));
    const bucket = bucketFor(daysPastDue);
    const bal = Money.of(r.balanceDue);
    bucketTotals[bucket] = bucketTotals[bucket].plus(bal);
    totalDue = totalDue.plus(bal);
    return {
      invoiceId: r.id,
      date: r.date.toISOString().slice(0, 10),
      invoiceNumber: r.invoiceNumber,
      dueDate: effDue.toISOString().slice(0, 10),
      total: toAmountString(r.total),
      amountPaid: toAmountString(r.amountPaid),
      balanceDue: toAmountString(bal),
      daysPastDue,
      agingBucket: bucket,
    };
  });

  return {
    customer: {
      id: cust.id,
      displayName: cust.displayName,
      companyName: cust.companyName ?? null,
      email: cust.email ?? null,
    },
    asOf: asOf.toISOString().slice(0, 10),
    lines,
    aging: {
      current: toAmountString(bucketTotals.current),
      days1_30: toAmountString(bucketTotals['1-30']),
      days31_60: toAmountString(bucketTotals['31-60']),
      days61_90: toAmountString(bucketTotals['61-90']),
      days90Plus: toAmountString(bucketTotals['90+']),
    },
    totalDue: toAmountString(totalDue),
  };
}

// ---------------------------------------------------------------------------
// Batch statement generation (all customers with balances)
// ---------------------------------------------------------------------------

export type StatementFormat = 'balance_forward' | 'open_item';

export type BatchStatementEntry =
  | { customerId: string; displayName: string; format: 'balance_forward'; statement: CustomerStatement }
  | { customerId: string; displayName: string; format: 'open_item'; statement: OpenItemStatement };

/**
 * Generate statements for EVERY active customer that has something to report:
 *   - open_item:        customers with at least one open invoice as of `asOf`.
 *   - balance_forward:  customers whose closing balance for the range ≠ 0
 *                       OR with any activity lines in the range.
 */
export async function batchStatements(
  ctx: ServiceContext,
  opts: {
    format: StatementFormat;
    /** balance_forward range (both optional, like customerStatement). */
    from?: Date;
    to?: Date;
    /** open_item statement date; defaults to today. */
    asOf?: Date;
  },
): Promise<BatchStatementEntry[]> {
  const custRows = await ctx.db
    .select({ id: customers.id, displayName: customers.displayName })
    .from(customers)
    .where(and(eq(customers.companyId, ctx.companyId), eq(customers.isActive, true)))
    .orderBy(asc(customers.displayName));

  const out: BatchStatementEntry[] = [];
  for (const c of custRows) {
    if (opts.format === 'open_item') {
      const stmt = await openItemStatement(ctx, c.id, opts.asOf ?? new Date());
      if (stmt.lines.length === 0) continue;
      out.push({ customerId: c.id, displayName: c.displayName, format: 'open_item', statement: stmt });
    } else {
      const stmt = await customerStatement(ctx, c.id, { from: opts.from, to: opts.to });
      const hasBalance = !Money.isZero(stmt.closingBalance);
      if (!hasBalance && stmt.lines.length === 0) continue;
      out.push({
        customerId: c.id,
        displayName: c.displayName,
        format: 'balance_forward',
        statement: stmt,
      });
    }
  }
  return out;
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
 *
 * Card-settled payments are EXCLUDED (both by payment method 'credit_card' and
 * by funding account being a credit-card liability): those amounts are reportable
 * on the card processor's 1099-K, not the payer's 1099-NEC — matching QB Desktop.
 *
 * Only vendors with total >= $600 are returned.
 */
export async function vendor1099Report(
  ctx: ServiceContext,
  { year }: { year: number },
): Promise<Vendor1099Row[]> {
  const yearStart = new Date(`${year}-01-01T00:00:00.000Z`);
  const yearEnd = new Date(`${year + 1}-01-01T00:00:00.000Z`);

  // Funding account is NOT a credit-card liability (null-safe for left joins —
  // a payment with no/unknown funding account is treated as non-card).
  const fundingAccountNotCreditCard = or(
    isNull(accounts.id),
    not(and(eq(accounts.type, 'liability'), eq(accounts.subtype, 'credit_card'))!),
  );

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
    .leftJoin(accounts, eq(billPayments.paymentAccountId, accounts.id))
    .where(
      and(
        eq(billPayments.companyId, ctx.companyId),
        eq(vendors.is1099, true),
        gte(billPayments.date, yearStart),
        lt(billPayments.date, yearEnd),
        // Exclude card-settled payments (1099-K territory, not 1099-NEC box 1).
        ne(billPayments.method, 'credit_card'),
        fundingAccountNotCreditCard,
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
    .leftJoin(accounts, eq(expenses.paymentAccountId, accounts.id))
    .where(
      and(
        eq(expenses.companyId, ctx.companyId),
        eq(vendors.is1099, true),
        gte(expenses.date, yearStart),
        lt(expenses.date, yearEnd),
        // Same card-settled exclusion as bill payments.
        ne(expenses.method, 'credit_card'),
        fundingAccountNotCreditCard,
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
