/**
 * Invoices (A/R) service.
 *
 * Invoices are the primary revenue document. Every saved invoice posts a balanced
 * journal entry via `postJournalEntry`:
 *
 *   Dr  1200 Accounts Receivable      total (in BASE currency)
 *   Cr  <income account per line>     line.amount (in BASE currency)
 *   Cr  2200 Sales Tax Payable        taxAmount   (in BASE currency)
 *   Dr  4000 Sales Income (contra)    discount    (in BASE currency)
 *
 * For foreign-currency invoices the invoice itself stores amounts in the
 * transaction currency, but every GL posting line is multiplied by exchangeRate
 * so the ledger stays in base currency.
 *
 * Because total = subtotal - discount + taxAmount, the entry balances:
 *   Debits:  total + discount  (AR debit + discount debit contra)
 *   Credits: subtotal + taxAmount  (income credits + tax credit)
 *   And total + discount = (subtotal - discount + taxAmount) + discount = subtotal + taxAmount ✓
 *
 * Discount can be a flat dollar amount ('amount') or a percentage of the subtotal
 * ('percent'). The stored `discount` column always holds the resolved dollar amount.
 *
 * Voiding calls `voidJournalEntry` which reverses all balance deltas.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Money, toAmountString } from '@/lib/money';
import {
  accounts,
  customers,
  invoices,
  invoiceLines,
  items,
  taxRates,
} from '@/lib/db/schema';
import {
  type ServiceContext,
  ServiceError,
  inTransaction,
  notFound,
  validation,
  writeAudit,
} from './_base';
import { postJournalEntry, voidJournalEntry } from './posting';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvoiceLineInput {
  /** Optional product/service item; supplies incomeAccountId as fallback. */
  itemId?: string | null;
  /** Direct income account override; takes priority over item.incomeAccountId. */
  accountId?: string | null;
  description?: string | null;
  quantity: string | number;
  rate: string | number;
  /** Whether this line participates in tax calculation. Defaults true. */
  taxable?: boolean;
  /** Per-line tax rate override (UUID of a taxRates row). When set, this line is taxed at this
   *  rate instead of the invoice-level rate (supports mixed-jurisdiction invoices). */
  taxRateId?: string | null;
}

export interface CreateInvoiceInput {
  customerId: string;
  date: Date;
  dueDate?: Date | null;
  lines: InvoiceLineInput[];
  /** UUID of a taxRates row; if absent no tax is charged. */
  taxRateId?: string | null;
  /**
   * Discount value. Interpretation depends on discountType:
   *   'amount'  (default) — flat dollar subtracted from subtotal.
   *   'percent'           — percentage of subtotal (e.g. 10 = 10%).
   */
  discount?: string | number | null;
  /** Controls how `discount` is interpreted. Defaults to 'amount'. */
  discountType?: 'amount' | 'percent' | null;
  /** Optional retainage (holdback) percentage of the total, posted to Retainage Receivable (1250)
   *  and excluded from the immediately-due balance. Common in construction/contract billing. */
  retainagePercent?: string | number | null;
  memo?: string | null;
  /**
   * ISO 4217 currency code for the invoice (e.g. 'EUR', 'GBP').
   * Defaults to base currency (no conversion).
   */
  currency?: string | null;
  /**
   * Exchange rate: how many base-currency units equal 1 transaction-currency unit.
   * E.g. if base=USD and currency=EUR, exchangeRate=1.10 means 1 EUR = 1.10 USD.
   * Defaults to 1 (base currency).
   */
  exchangeRate?: string | number | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Look up an account id by code, scoped to the company. Throws NOT_FOUND. */
async function accountIdByCode(ctx: ServiceContext, code: string): Promise<string> {
  const [row] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, code)));
  if (!row) throw notFound(`Account with code ${code}`);
  return row.id;
}

/** Look up an account by code, creating it if missing (for accounts older companies may lack). */
async function getOrCreateAccountByCode(
  ctx: ServiceContext,
  code: string,
  def: { name: string; type: string; subtype: string },
): Promise<string> {
  const [row] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, code)));
  if (row) return row.id;
  const [created] = await ctx.db
    .insert(accounts)
    .values({ companyId: ctx.companyId, code, name: def.name, type: def.type as never, subtype: def.subtype as never })
    .returning();
  return created.id;
}

/** Return the next invoice number for the company (max + 1, 1 if none). */
async function nextInvoiceNumber(ctx: ServiceContext): Promise<number> {
  const [row] = await ctx.db
    .select({ max: sql<number>`COALESCE(MAX(${invoices.invoiceNumber}), 0)` })
    .from(invoices)
    .where(eq(invoices.companyId, ctx.companyId));
  return (row?.max ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// createInvoice
// ---------------------------------------------------------------------------

export async function createInvoice(ctx: ServiceContext, input: CreateInvoiceInput) {
  // --- Validate inputs ---
  if (!input.lines || input.lines.length === 0) {
    throw validation('An invoice must have at least one line.');
  }

  // Validate exchange rate.
  const exchangeRate = Money.round2(input.exchangeRate ?? 1);
  if (exchangeRate.lessThanOrEqualTo(0)) throw validation('Exchange rate must be positive.');

  // Verify customer belongs to company; also load creditLimit for the credit check.
  const [customer] = await ctx.db
    .select({ id: customers.id, creditLimit: customers.creditLimit })
    .from(customers)
    .where(and(eq(customers.companyId, ctx.companyId), eq(customers.id, input.customerId)));
  if (!customer) throw notFound('Customer');

  // Load tax rate if provided.
  let taxRateDecimal = Money.zero();
  if (input.taxRateId) {
    const [taxRow] = await ctx.db
      .select({ rate: taxRates.rate })
      .from(taxRates)
      .where(and(eq(taxRates.companyId, ctx.companyId), eq(taxRates.id, input.taxRateId)));
    if (!taxRow) throw notFound('Tax rate');
    taxRateDecimal = Money.of(taxRow.rate);
  }

  // Resolve fallback account ids (from COA defaults).
  const arAccountId = await accountIdByCode(ctx, '1200');    // A/R
  const defaultIncomeId = await accountIdByCode(ctx, '4000'); // Sales Income (fallback + discount contra)
  const taxPayableId = await accountIdByCode(ctx, '2200');   // Sales Tax Payable

  // Resolve (or create) the Retainage Receivable account if this invoice uses retainage.
  const usesRetainage = input.retainagePercent != null && Money.of(input.retainagePercent).greaterThan(0);
  const retainageAcctId = usesRetainage
    ? await getOrCreateAccountByCode(ctx, '1250', {
        name: 'Retainage Receivable',
        type: 'asset',
        subtype: 'accounts_receivable',
      })
    : null;

  // Pre-load item income account ids for lines that reference an item.
  const itemIds = input.lines
    .filter((l) => l.itemId)
    .map((l) => l.itemId as string);
  const itemMap = new Map<string, string | null>();
  if (itemIds.length > 0) {
    const itemRows = await ctx.db
      .select({ id: items.id, incomeAccountId: items.incomeAccountId })
      .from(items)
      .where(and(eq(items.companyId, ctx.companyId), sql`${items.id} = ANY(${itemIds})`));
    for (const r of itemRows) itemMap.set(r.id, r.incomeAccountId);
  }

  // Pre-load any per-line tax-rate overrides into a rate map.
  const lineTaxRateIds = [...new Set(input.lines.map((l) => l.taxRateId).filter(Boolean) as string[])];
  const lineTaxRateMap = new Map<string, ReturnType<typeof Money.zero>>();
  if (lineTaxRateIds.length > 0) {
    const rateRows = await ctx.db
      .select({ id: taxRates.id, rate: taxRates.rate })
      .from(taxRates)
      .where(and(eq(taxRates.companyId, ctx.companyId), inArray(taxRates.id, lineTaxRateIds)));
    for (const r of rateRows) lineTaxRateMap.set(r.id, Money.of(r.rate));
    for (const id of lineTaxRateIds) {
      if (!lineTaxRateMap.has(id)) throw notFound(`Tax rate ${id}`);
    }
  }
  // Accumulates tax from lines that carry their own rate (kept separate from the invoice-level rate).
  let perLineTax = Money.zero();

  // --- Compute per-line amounts and subtotal ---
  type ComputedLine = {
    itemId: string | null;
    accountId: string;         // resolved income account id
    description: string | null;
    quantity: string;
    rate: string;
    amount: string;            // quantity * rate, 2dp (in transaction currency)
    taxable: boolean;
    taxRateId: string | null;
    lineOrder: number;
  };

  let subtotal = Money.zero();
  let taxableSubtotal = Money.zero();
  const computedLines: ComputedLine[] = [];

  for (let i = 0; i < input.lines.length; i++) {
    const l = input.lines[i];
    const qty = Money.of(l.quantity);
    const rate = Money.of(l.rate);
    if (qty.lessThanOrEqualTo(0)) throw validation(`Line ${i + 1}: quantity must be positive.`);
    if (rate.lessThan(0)) throw validation(`Line ${i + 1}: rate cannot be negative.`);

    const amount = Money.round2(Money.mul(qty, rate));

    // Resolve income account: explicit accountId > item.incomeAccountId > 4000
    let resolvedAccountId = defaultIncomeId;
    if (l.accountId) {
      // Verify it belongs to this company.
      const [acctRow] = await ctx.db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.id, l.accountId)));
      if (!acctRow) throw notFound(`Account ${l.accountId} (line ${i + 1})`);
      resolvedAccountId = acctRow.id;
    } else if (l.itemId) {
      const itemIncomeId = itemMap.get(l.itemId) ?? null;
      if (itemIncomeId) resolvedAccountId = itemIncomeId;
    }

    const taxable = l.taxable !== false; // default true
    subtotal = subtotal.plus(amount);
    if (taxable) {
      if (l.taxRateId) {
        // Per-line rate: tax this line directly, keep it out of the invoice-level taxable base.
        perLineTax = perLineTax.plus(Money.round2(Money.mul(amount, lineTaxRateMap.get(l.taxRateId)!)));
      } else {
        taxableSubtotal = taxableSubtotal.plus(amount);
      }
    }

    computedLines.push({
      itemId: l.itemId ?? null,
      accountId: resolvedAccountId,
      description: l.description ?? null,
      quantity: toAmountString(qty),
      rate: toAmountString(rate),
      amount: toAmountString(amount),
      taxable,
      taxRateId: l.taxRateId ?? null,
      lineOrder: i,
    });
  }

  // --- Resolve discount (flat or percent of subtotal) ---
  const discountType: 'amount' | 'percent' = input.discountType === 'percent' ? 'percent' : 'amount';
  let discountRaw = Money.round2(input.discount ?? 0);
  if (discountRaw.lessThan(0)) throw validation('Discount cannot be negative.');
  let discount: ReturnType<typeof Money.zero>;
  if (discountType === 'percent') {
    // Interpret discountRaw as a percentage value, e.g. 10 means 10%.
    if (discountRaw.greaterThan(100)) throw validation('Percent discount cannot exceed 100%.');
    discount = Money.round2(Money.mul(subtotal, Money.div(discountRaw, 100)));
  } else {
    discount = discountRaw;
  }

  // taxAmount = (invoice-rate base * rate) + sum of per-line-rate taxes
  const taxAmount = Money.round2(Money.mul(taxableSubtotal, taxRateDecimal)).plus(perLineTax);
  // total = subtotal - discount + taxAmount  (all in transaction currency)
  const total = Money.round2(subtotal.minus(discount).plus(taxAmount));

  if (total.lessThan(0)) {
    throw validation('Invoice total cannot be negative — discount exceeds subtotal + tax.');
  }

  // --- Retainage (holdback): a % of the total is posted to Retainage Receivable and excluded
  //     from the immediately-due balance (billed/released later). ---
  const retainagePct = usesRetainage ? Money.round2(input.retainagePercent!) : Money.zero();
  if (retainagePct.greaterThan(100)) throw validation('Retainage percent cannot exceed 100%.');
  const retainageAmount = usesRetainage
    ? Money.round2(Money.mul(total, Money.div(retainagePct, 100)))
    : Money.zero();
  const dueNow = Money.round2(total.minus(retainageAmount));

  // --- Credit limit check ---
  if (customer.creditLimit != null) {
    const creditLimit = Money.of(customer.creditLimit);
    if (creditLimit.greaterThan(0)) {
      // Sum balanceDue on all open/partial invoices for this customer.
      const openInvoiceRows = await ctx.db
        .select({ balanceDue: invoices.balanceDue })
        .from(invoices)
        .where(
          and(
            eq(invoices.companyId, ctx.companyId),
            eq(invoices.customerId, input.customerId),
            inArray(invoices.status, ['open', 'partial']),
          ),
        );
      const outstandingBalance = openInvoiceRows.reduce(
        (sum, row) => sum.plus(Money.of(row.balanceDue)),
        Money.zero(),
      );
      if (outstandingBalance.plus(total).greaterThan(creditLimit)) {
        throw new ServiceError('VALIDATION', 'Credit limit exceeded');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Persist everything in a single transaction.
  // ---------------------------------------------------------------------------
  return inTransaction(ctx, async (tx) => {
    const invoiceNumber = await nextInvoiceNumber(tx);

    // Resolve currency fields.
    const currency = input.currency ?? null;
    // exchangeRate was computed above (defaults to 1).
    const exchangeRateStr = toAmountString(exchangeRate);

    // 1) Insert invoice header.
    //    subtotal / discount / taxAmount / total / balanceDue are stored in TRANSACTION currency.
    const [invoice] = await tx.db
      .insert(invoices)
      .values({
        companyId: tx.companyId,
        customerId: input.customerId,
        invoiceNumber,
        date: input.date,
        dueDate: input.dueDate ?? null,
        status: 'open',
        taxRateId: input.taxRateId ?? null,
        currency,
        exchangeRate: exchangeRateStr,
        discountType,
        subtotal: toAmountString(subtotal),
        discount: toAmountString(discount),
        taxAmount: toAmountString(taxAmount),
        total: toAmountString(total),
        amountPaid: '0.00',
        balanceDue: toAmountString(dueNow),
        retainagePercent: usesRetainage ? retainagePct.toFixed(2) : null,
        retainageAmount: toAmountString(retainageAmount),
        memo: input.memo ?? null,
        // postedEntryId filled below after posting
      })
      .returning();

    // 2) Insert invoice lines.
    await tx.db.insert(invoiceLines).values(
      computedLines.map((cl) => ({
        invoiceId: invoice.id,
        itemId: cl.itemId,
        accountId: cl.accountId,
        description: cl.description,
        quantity: cl.quantity,
        rate: cl.rate,
        amount: cl.amount,
        taxable: cl.taxable,
        taxRateId: cl.taxRateId,
        lineOrder: cl.lineOrder,
      })),
    );

    // 3) Build and post the journal entry.
    //
    // All GL amounts are in BASE currency = transaction-currency amount * exchangeRate.
    //
    // The scheme is designed so debits == credits:
    //   Dr 1200 A/R              = total * fx
    //   Cr <income accounts>     = subtotal * fx   (gross line amounts)
    //   Cr 2200 Tax Payable      = taxAmount * fx  (0 if no tax)
    //   Dr 4000 Sales contra     = discount * fx   (0 if no discount)
    //
    //   Debit  total*fx + discount*fx  = (subtotal - discount + taxAmount)*fx + discount*fx
    //                                  = (subtotal + taxAmount)*fx
    //   Total credits: subtotal*fx + taxAmount*fx  ✓

    /** Convert transaction-currency amount to base currency, rounded to 2dp. */
    function toBase(txAmount: ReturnType<typeof Money.zero>): string {
      return toAmountString(Money.round2(Money.mul(txAmount, exchangeRate)));
    }

    // Aggregate per income account (multiple lines may share an account).
    const incomeCredits = new Map<string, ReturnType<typeof Money.zero>>();
    for (const cl of computedLines) {
      const prev = incomeCredits.get(cl.accountId) ?? Money.zero();
      incomeCredits.set(cl.accountId, prev.plus(Money.of(cl.amount)));
    }

    const postingLines: Array<{
      accountId: string;
      debit?: string;
      credit?: string;
      memo?: string;
    }> = [];

    // Debit A/R for the amount due now; debit Retainage Receivable for any held-back portion.
    // (AR debit + retainage debit == total, so the entry still balances.)
    postingLines.push({
      accountId: arAccountId,
      debit: toBase(dueNow),
      memo: `Invoice #${invoiceNumber}`,
    });
    if (retainageAmount.greaterThan(0) && retainageAcctId) {
      postingLines.push({
        accountId: retainageAcctId,
        debit: toBase(retainageAmount),
        memo: `Invoice #${invoiceNumber} — retainage`,
      });
    }

    // Credit each income account for the gross line amount (in BASE currency).
    for (const [acctId, amount] of incomeCredits) {
      postingLines.push({
        accountId: acctId,
        credit: toBase(amount),
        memo: `Invoice #${invoiceNumber} — income`,
      });
    }

    // Credit Sales Tax Payable (only if there is tax) — in BASE currency.
    if (taxAmount.greaterThan(0)) {
      postingLines.push({
        accountId: taxPayableId,
        credit: toBase(taxAmount),
        memo: `Invoice #${invoiceNumber} — sales tax`,
      });
    }

    // Debit contra (discount reduces income) — only if discount > 0 — in BASE currency.
    if (discount.greaterThan(0)) {
      postingLines.push({
        accountId: defaultIncomeId,
        debit: toBase(discount),
        memo: `Invoice #${invoiceNumber} — discount`,
      });
    }

    const entry = await postJournalEntry(tx, {
      date: input.date,
      description: `Invoice #${invoiceNumber}`,
      reference: String(invoiceNumber),
      sourceRef: `invoice:${invoice.id}`,
      lines: postingLines,
    });

    // 4) Stamp postedEntryId on the invoice.
    const [updated] = await tx.db
      .update(invoices)
      .set({ postedEntryId: entry.id, updatedAt: new Date() })
      .where(eq(invoices.id, invoice.id))
      .returning();

    // 5) Audit trail.
    await writeAudit(tx, {
      action: 'create',
      entityType: 'invoice',
      entityId: invoice.id,
      newValues: {
        invoiceNumber,
        customerId: input.customerId,
        total: toAmountString(total),
        postedEntryId: entry.id,
      },
    });

    return { ...updated, lines: computedLines };
  });
}

// ---------------------------------------------------------------------------
// listInvoices
// ---------------------------------------------------------------------------

export async function listInvoices(
  ctx: ServiceContext,
  opts?: { customerId?: string; status?: string },
) {
  let query = ctx.db
    .select()
    .from(invoices)
    .where(eq(invoices.companyId, ctx.companyId));

  // Drizzle doesn't support dynamic .where chaining easily without sql helper;
  // build a records-based filter instead.
  const rows = await query.orderBy(invoices.invoiceNumber);
  return rows.filter((r) => {
    if (opts?.customerId && r.customerId !== opts.customerId) return false;
    if (opts?.status && r.status !== opts.status) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// getInvoice (with lines)
// ---------------------------------------------------------------------------

export async function getInvoice(ctx: ServiceContext, id: string) {
  const [invoice] = await ctx.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.companyId, ctx.companyId), eq(invoices.id, id)));
  if (!invoice) throw notFound('Invoice');

  const lines = await ctx.db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, id))
    .orderBy(invoiceLines.lineOrder);

  return { ...invoice, lines };
}

// ---------------------------------------------------------------------------
// voidInvoice
// ---------------------------------------------------------------------------

export async function voidInvoice(ctx: ServiceContext, id: string) {
  // Load invoice scoped to company.
  const [invoice] = await ctx.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.companyId, ctx.companyId), eq(invoices.id, id)));
  if (!invoice) throw notFound('Invoice');

  if (invoice.status === 'void') {
    throw new ServiceError('CONFLICT', 'Invoice is already voided.');
  }

  if (invoice.amountPaid && Money.gt(invoice.amountPaid, 0)) {
    throw new ServiceError(
      'CONFLICT',
      'Cannot void an invoice that has payments applied. Unapply payments first.',
    );
  }

  return inTransaction(ctx, async (tx) => {
    // Reverse the GL entry.
    if (invoice.postedEntryId) {
      await voidJournalEntry(tx, invoice.postedEntryId);
    }

    // Mark invoice void.
    const [updated] = await tx.db
      .update(invoices)
      .set({ status: 'void', balanceDue: '0.00', updatedAt: new Date() })
      .where(eq(invoices.id, id))
      .returning();

    await writeAudit(tx, {
      action: 'void',
      entityType: 'invoice',
      entityId: id,
      oldValues: { status: invoice.status },
      newValues: { status: 'void' },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// markPaidAmount — used by the payments service when applying/unapplying
// ---------------------------------------------------------------------------

/**
 * Update amountPaid and recompute balanceDue. Called by the payments service;
 * does NOT touch the GL (the payment service posts its own entry).
 *
 * @param amountPaidDelta  Positive = adding payment, negative = unapplying.
 */
export async function markPaidAmount(
  ctx: ServiceContext,
  invoiceId: string,
  amountPaidDelta: string | number,
) {
  const [invoice] = await ctx.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.companyId, ctx.companyId), eq(invoices.id, invoiceId)));
  if (!invoice) throw notFound('Invoice');
  if (invoice.status === 'void') {
    throw new ServiceError('CONFLICT', 'Cannot apply payment to a voided invoice.');
  }

  const newAmountPaid = Money.round2(Money.of(invoice.amountPaid).plus(Money.of(amountPaidDelta)));
  if (newAmountPaid.lessThan(0)) {
    throw validation('Payment amount would make amountPaid negative.');
  }

  const newBalance = Money.round2(Money.of(invoice.total).minus(newAmountPaid));
  const newStatus = newBalance.lessThanOrEqualTo(0)
    ? 'paid'
    : newAmountPaid.greaterThan(0)
      ? 'partial'
      : 'open';

  const [updated] = await ctx.db
    .update(invoices)
    .set({
      amountPaid: toAmountString(newAmountPaid),
      balanceDue: toAmountString(Money.abs(newBalance)), // guard against tiny negative rounding
      status: newStatus as never,
      updatedAt: new Date(),
    })
    .where(eq(invoices.id, invoiceId))
    .returning();

  return updated;
}
