/**
 * Extended financial reports — aging schedules, cash flow (indirect), and
 * customer/vendor summary views. None of these touch the GL; they are pure
 * read-only projections over the invoices, bills, and journal_entry_lines tables.
 *
 * Do NOT import or call anything from reports.ts here — we compose at call-site
 * where both namespaces are needed (e.g. cashFlow reuses profitAndLoss directly).
 */
import { and, eq, gt, inArray, lte, ne, sql } from 'drizzle-orm';
import { accounts, bills, customers, invoices, journalEntries, journalEntryLines, vendors } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import { profitAndLoss } from '@/lib/services/reports';
import type { ServiceContext } from './_base';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface AgingBucket {
  /** The entity (customer or vendor) id. */
  id: string;
  name: string;
  /** Current — not yet due as of asOf. */
  current: string;
  /** 1-30 days past due. */
  days1_30: string;
  /** 31-60 days past due. */
  days31_60: string;
  /** 61-90 days past due. */
  days61_90: string;
  /** 91+ days past due. */
  days91plus: string;
  /** Sum of all buckets. */
  total: string;
}

export interface AgingReport {
  asOf: string;
  rows: AgingBucket[];
  totals: Omit<AgingBucket, 'id' | 'name'>;
}

// ---------------------------------------------------------------------------
// Internal bucket helper
// ---------------------------------------------------------------------------

/** Classify a document (invoice / bill) into an aging bucket.
 *  daysPastDue = (asOf - dueDate) in whole days; negative means not yet due.
 */
function agingKey(daysPastDue: number): BucketKey {
  if (daysPastDue <= 0) return 'current';
  if (daysPastDue <= 30) return 'days1_30';
  if (daysPastDue <= 60) return 'days31_60';
  if (daysPastDue <= 90) return 'days61_90';
  return 'days91plus';
}

/** The five mutable aging bucket keys (excluding id/name/total). */
type BucketKey = 'current' | 'days1_30' | 'days31_60' | 'days61_90' | 'days91plus';

type BucketAccum = Record<BucketKey, ReturnType<typeof Money.zero>>;

/** Blank per-entity bucket accumulator. */
function blankBuckets(): BucketAccum {
  return {
    current: Money.zero(),
    days1_30: Money.zero(),
    days31_60: Money.zero(),
    days61_90: Money.zero(),
    days91plus: Money.zero(),
  };
}

function ms_to_days(ms: number): number {
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// A/R Aging
// ---------------------------------------------------------------------------

/**
 * Accounts-Receivable aging by customer.
 * Only invoices with balanceDue > 0 and status not void/paid are included.
 * Uses the invoice's dueDate (or date if dueDate is null) relative to asOf.
 */
export async function arAging(ctx: ServiceContext, asOf?: Date): Promise<AgingReport> {
  const cutoff = asOf ?? new Date();

  // Fetch open invoices with balanceDue > 0, joined to customer name.
  const rows = await ctx.db
    .select({
      invoiceId: invoices.id,
      customerId: invoices.customerId,
      customerName: customers.displayName,
      balanceDue: invoices.balanceDue,
      dueDate: invoices.dueDate,
      date: invoices.date,
    })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(
      and(
        eq(invoices.companyId, ctx.companyId),
        ne(invoices.status, 'void'),
        ne(invoices.status, 'paid'),
        // balanceDue > 0 using sql literal (decimal column)
        sql`CAST(${invoices.balanceDue} AS NUMERIC) > 0`,
      ),
    );

  // Accumulate per customer.
  const byCustomer = new Map<string, { name: string; buckets: BucketAccum }>();

  for (const row of rows) {
    const effectiveDue = row.dueDate ?? row.date;
    const daysPastDue = ms_to_days(cutoff.getTime() - effectiveDue.getTime());
    const key = agingKey(daysPastDue);
    const amount = Money.of(row.balanceDue);

    if (!byCustomer.has(row.customerId)) {
      byCustomer.set(row.customerId, { name: row.customerName, buckets: blankBuckets() });
    }
    byCustomer.get(row.customerId)!.buckets[key] = byCustomer.get(row.customerId)!.buckets[key].plus(amount);
  }

  return buildAgingReport(byCustomer, cutoff);
}

// ---------------------------------------------------------------------------
// A/P Aging
// ---------------------------------------------------------------------------

/**
 * Accounts-Payable aging by vendor.
 * Only bills with balanceDue > 0 and status not void/paid are included.
 */
export async function apAging(ctx: ServiceContext, asOf?: Date): Promise<AgingReport> {
  const cutoff = asOf ?? new Date();

  const rows = await ctx.db
    .select({
      billId: bills.id,
      vendorId: bills.vendorId,
      vendorName: vendors.displayName,
      balanceDue: bills.balanceDue,
      dueDate: bills.dueDate,
      date: bills.date,
    })
    .from(bills)
    .innerJoin(vendors, eq(bills.vendorId, vendors.id))
    .where(
      and(
        eq(bills.companyId, ctx.companyId),
        ne(bills.status, 'void'),
        ne(bills.status, 'paid'),
        sql`CAST(${bills.balanceDue} AS NUMERIC) > 0`,
      ),
    );

  const byVendor = new Map<string, { name: string; buckets: BucketAccum }>();

  for (const row of rows) {
    const effectiveDue = row.dueDate ?? row.date;
    const daysPastDue = ms_to_days(cutoff.getTime() - effectiveDue.getTime());
    const key = agingKey(daysPastDue);
    const amount = Money.of(row.balanceDue);

    if (!byVendor.has(row.vendorId)) {
      byVendor.set(row.vendorId, { name: row.vendorName, buckets: blankBuckets() });
    }
    byVendor.get(row.vendorId)!.buckets[key] = byVendor.get(row.vendorId)!.buckets[key].plus(amount);
  }

  return buildAgingReport(byVendor, cutoff);
}

/** Convert the accumulated per-entity map into a sorted AgingReport. */
function buildAgingReport(
  byEntity: Map<string, { name: string; buckets: BucketAccum }>,
  cutoff: Date,
): AgingReport {
  const grandTotals = blankBuckets();
  const agingRows: AgingBucket[] = [];

  for (const [id, { name, buckets }] of byEntity) {
    const rowTotal = Object.values(buckets).reduce((sum, b) => sum.plus(b), Money.zero());
    if (rowTotal.isZero()) continue; // skip zero-balance rows

    // Accumulate into grand totals.
    for (const k of Object.keys(buckets) as BucketKey[]) {
      grandTotals[k] = grandTotals[k].plus(buckets[k]);
    }

    agingRows.push({
      id,
      name,
      current: toAmountString(buckets.current),
      days1_30: toAmountString(buckets.days1_30),
      days31_60: toAmountString(buckets.days31_60),
      days61_90: toAmountString(buckets.days61_90),
      days91plus: toAmountString(buckets.days91plus),
      total: toAmountString(rowTotal),
    });
  }

  // Sort descending by total for the most-at-risk entities first.
  agingRows.sort((a, b) => Money.of(b.total).comparedTo(Money.of(a.total)));

  const grandTotal = Object.values(grandTotals).reduce((sum, b) => sum.plus(b), Money.zero());

  return {
    asOf: cutoff.toISOString(),
    rows: agingRows,
    totals: {
      current: toAmountString(grandTotals.current),
      days1_30: toAmountString(grandTotals.days1_30),
      days31_60: toAmountString(grandTotals.days31_60),
      days61_90: toAmountString(grandTotals.days61_90),
      days91plus: toAmountString(grandTotals.days91plus),
      total: toAmountString(grandTotal),
    },
  };
}

// ---------------------------------------------------------------------------
// Cash Flow (indirect method)
// ---------------------------------------------------------------------------

export interface CashFlowReport {
  from?: string;
  to?: string;
  /** Operating activities: net income adjusted for working-capital changes. */
  operating: {
    netIncome: string;
    changeInAR: string;      // increase in AR is a use of cash (negative)
    changeInAP: string;      // increase in AP is a source of cash (positive)
    changeInInventory: string; // increase in inventory is a use of cash (negative)
    total: string;
  };
  /**
   * Investing & financing are best-effort from the journal (no dedicated
   * fixed-asset or equity-draw tables yet). We sum posted debits/credits on
   * asset accounts coded 1500 (Fixed Assets) and equity accounts (3xxx).
   */
  investing: {
    netFixedAssetActivity: string;
    total: string;
  };
  financing: {
    netEquityActivity: string;
    total: string;
  };
  /** Operating + Investing + Financing. */
  netCashChange: string;
}

/**
 * Simple indirect-method cash-flow statement.
 *
 * Operating:
 *   Net income (P&L for the period)
 *   + Decrease in A/R  (or - Increase)   [change in account code 1200 balance]
 *   + Increase in A/P  (or - Decrease)   [change in account code 2000 balance]
 *   + Decrease in Inventory (or - Increase) [change in account code 1300 balance]
 *
 * Investing:
 *   Net change in Fixed Assets (code 1500) from posted entries in the period.
 *
 * Financing:
 *   Net change in Equity accounts (type=equity) from posted entries in the period.
 */
export async function cashFlow(
  ctx: ServiceContext,
  range?: { from?: Date; to?: Date },
): Promise<CashFlowReport> {
  // --- Net income from P&L ---
  const pl = await profitAndLoss(ctx, range);
  const netIncome = Money.of(pl.netIncome);

  // --- Balance-change helper ---
  // Compute the net debit/credit movement on an account (by code) over the period.
  // Returns the natural-balance change (positive = increase for debit-normal accounts).
  async function balanceChangeByCode(
    accountCode: string,
    accountType: 'asset' | 'liability' | 'equity',
  ): Promise<ReturnType<typeof Money.zero>> {
    const DEBIT_NORMAL = new Set(['asset', 'expense']);

    // Identify the account id.
    const [acctRow] = await ctx.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, accountCode)));
    if (!acctRow) return Money.zero(); // account not in COA — report zero

    const conds = [
      eq(journalEntries.companyId, ctx.companyId),
      eq(journalEntries.status, 'posted'),
      eq(journalEntryLines.accountId, acctRow.id),
    ];
    if (range?.from) conds.push(sql`${journalEntries.date} >= ${range.from}`);
    if (range?.to) conds.push(lte(journalEntries.date, range.to));

    const [result] = await ctx.db
      .select({
        totalDebit: sql<string>`COALESCE(SUM(CAST(${journalEntryLines.debit} AS NUMERIC)), 0)`,
        totalCredit: sql<string>`COALESCE(SUM(CAST(${journalEntryLines.credit} AS NUMERIC)), 0)`,
      })
      .from(journalEntryLines)
      .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
      .where(and(...conds));

    if (!result) return Money.zero();

    const d = Money.of(result.totalDebit);
    const c = Money.of(result.totalCredit);
    // Natural balance change: debit-normal accounts increase on debit, decrease on credit.
    return DEBIT_NORMAL.has(accountType) ? d.minus(c) : c.minus(d);
  }

  // --- Working capital changes ---
  // For A/R (asset): increase in AR = less cash collected => subtract from operating cash.
  const changeInAR = await balanceChangeByCode('1200', 'asset');   // positive => AR grew => use of cash
  // For A/P (liability): increase in AP = deferred payment => source of cash.
  const changeInAP = await balanceChangeByCode('2000', 'liability'); // positive => AP grew => source
  // For Inventory (asset): increase in inventory = use of cash.
  const changeInInventory = await balanceChangeByCode('1300', 'asset');

  // Operating total = net income - changeInAR + changeInAP - changeInInventory
  const operatingTotal = netIncome
    .minus(changeInAR)
    .plus(changeInAP)
    .minus(changeInInventory);

  // --- Investing: fixed asset activity (code 1500) ---
  const fixedAssetChange = await balanceChangeByCode('1500', 'asset');
  // A net increase in fixed assets is a cash outflow from investing.
  const investingTotal = fixedAssetChange.negated();

  // --- Financing: equity activity (all equity accounts) ---
  // Query equity accounts for the company.
  const equityAccts = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.type, 'equity')));

  let equityNetChange = Money.zero();
  if (equityAccts.length > 0) {
    const equityIds = equityAccts.map((a) => a.id);
    const conds = [
      eq(journalEntries.companyId, ctx.companyId),
      eq(journalEntries.status, 'posted'),
      inArray(journalEntryLines.accountId, equityIds),
    ];
    if (range?.from) conds.push(sql`${journalEntries.date} >= ${range.from}`);
    if (range?.to) conds.push(lte(journalEntries.date, range.to));

    const [result] = await ctx.db
      .select({
        totalDebit: sql<string>`COALESCE(SUM(CAST(${journalEntryLines.debit} AS NUMERIC)), 0)`,
        totalCredit: sql<string>`COALESCE(SUM(CAST(${journalEntryLines.credit} AS NUMERIC)), 0)`,
      })
      .from(journalEntryLines)
      .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
      .where(and(...conds));

    if (result) {
      // Equity is credit-normal: net increase = credit - debit
      equityNetChange = Money.of(result.totalCredit).minus(Money.of(result.totalDebit));
    }
  }

  const financingTotal = equityNetChange;
  const netCashChange = operatingTotal.plus(investingTotal).plus(financingTotal);

  return {
    from: range?.from?.toISOString(),
    to: range?.to?.toISOString(),
    operating: {
      netIncome: toAmountString(netIncome),
      changeInAR: toAmountString(changeInAR.negated()), // sign: negative = AR grew (cash used)
      changeInAP: toAmountString(changeInAP),           // sign: positive = AP grew (cash source)
      changeInInventory: toAmountString(changeInInventory.negated()), // negative = inv grew (cash used)
      total: toAmountString(operatingTotal),
    },
    investing: {
      netFixedAssetActivity: toAmountString(investingTotal),
      total: toAmountString(investingTotal),
    },
    financing: {
      netEquityActivity: toAmountString(financingTotal),
      total: toAmountString(financingTotal),
    },
    netCashChange: toAmountString(netCashChange),
  };
}

// ---------------------------------------------------------------------------
// Sales by Customer
// ---------------------------------------------------------------------------

export interface SalesByCustomerRow {
  customerId: string;
  customerName: string;
  /** Sum of invoice totals (not balanceDue) for the period. */
  totalSales: string;
  /** Count of invoices. */
  invoiceCount: number;
}

/**
 * Total invoiced amount per customer for the given date range.
 * Voided invoices are excluded.
 */
export async function salesByCustomer(
  ctx: ServiceContext,
  range?: { from?: Date; to?: Date },
): Promise<SalesByCustomerRow[]> {
  // Build conditions array.
  const conds = [
    eq(invoices.companyId, ctx.companyId),
    ne(invoices.status, 'void'),
  ];
  if (range?.from) conds.push(sql`${invoices.date} >= ${range.from}`);
  if (range?.to) conds.push(lte(invoices.date, range.to));

  const rows = await ctx.db
    .select({
      customerId: invoices.customerId,
      customerName: customers.displayName,
      totalSales: sql<string>`COALESCE(SUM(CAST(${invoices.total} AS NUMERIC)), 0)`,
      invoiceCount: sql<number>`COUNT(${invoices.id})`,
    })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(and(...conds))
    .groupBy(invoices.customerId, customers.displayName)
    .orderBy(sql`SUM(CAST(${invoices.total} AS NUMERIC)) DESC`);

  return rows.map((r) => ({
    customerId: r.customerId,
    customerName: r.customerName,
    totalSales: toAmountString(r.totalSales),
    invoiceCount: Number(r.invoiceCount),
  }));
}

// ---------------------------------------------------------------------------
// Expenses by Vendor
// ---------------------------------------------------------------------------

export interface ExpensesByVendorRow {
  vendorId: string;
  vendorName: string;
  /** Sum of bill totals for the period. */
  totalExpenses: string;
  /** Count of bills. */
  billCount: number;
}

/**
 * Total billed amount per vendor for the given date range.
 * Voided bills are excluded.
 */
export async function expensesByVendor(
  ctx: ServiceContext,
  range?: { from?: Date; to?: Date },
): Promise<ExpensesByVendorRow[]> {
  const conds = [
    eq(bills.companyId, ctx.companyId),
    ne(bills.status, 'void'),
  ];
  if (range?.from) conds.push(sql`${bills.date} >= ${range.from}`);
  if (range?.to) conds.push(lte(bills.date, range.to));

  const rows = await ctx.db
    .select({
      vendorId: bills.vendorId,
      vendorName: vendors.displayName,
      totalExpenses: sql<string>`COALESCE(SUM(CAST(${bills.total} AS NUMERIC)), 0)`,
      billCount: sql<number>`COUNT(${bills.id})`,
    })
    .from(bills)
    .innerJoin(vendors, eq(bills.vendorId, vendors.id))
    .where(and(...conds))
    .groupBy(bills.vendorId, vendors.displayName)
    .orderBy(sql`SUM(CAST(${bills.total} AS NUMERIC)) DESC`);

  return rows.map((r) => ({
    vendorId: r.vendorId,
    vendorName: r.vendorName,
    totalExpenses: toAmountString(r.totalExpenses),
    billCount: Number(r.billCount),
  }));
}
