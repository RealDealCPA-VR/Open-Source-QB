/**
 * Credit Memos (A/R credits) service.
 *
 * A credit memo reduces what a customer owes. The posting pattern at creation:
 *
 *   Dr  <income account per line>  (line.accountId or '4000')   line.amount
 *   Cr  1200 Accounts Receivable                                 total
 *
 * A/R is credited immediately — AR balance drops. The unapplied field tracks
 * how much of the credit has not yet been applied to an invoice. Applying a
 * credit memo to an invoice does NOT post a new journal entry (the AR impact
 * already happened at creation); it only moves the credit from unapplied to
 * applied and reduces the invoice's balanceDue.
 *
 * Voiding calls voidJournalEntry to reverse the GL and flips status to void.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { accounts, creditMemos, creditMemoLines, customers, invoices } from '@/lib/db/schema';
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

export interface CreditMemoLineInput {
  description?: string | null;
  quantity: string | number;
  rate: string | number;
  /** Income account to debit (default: account with code '4000'). */
  accountId?: string | null;
}

export interface CreateCreditMemoInput {
  customerId: string;
  date: Date;
  lines: CreditMemoLineInput[];
  memo?: string | null;
}

export interface ApplyToInvoiceInput {
  creditMemoId: string;
  invoiceId: string;
  /** Amount to apply (must be <= unapplied and <= invoice.balanceDue). */
  amount: string | number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Look up an account id by COA code, scoped to the company. Throws NOT_FOUND. */
async function accountIdByCode(ctx: ServiceContext, code: string): Promise<string> {
  const [row] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, code)));
  if (!row) throw notFound(`Account with code ${code}`);
  return row.id;
}

/** Return the next memo number for the company (max + 1, 1 if none). */
async function nextMemoNumber(ctx: ServiceContext): Promise<number> {
  const [row] = await ctx.db
    .select({ max: sql<number>`COALESCE(MAX(${creditMemos.memoNumber}), 0)` })
    .from(creditMemos)
    .where(eq(creditMemos.companyId, ctx.companyId));
  return (row?.max ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// createCreditMemo
// ---------------------------------------------------------------------------

export async function createCreditMemo(ctx: ServiceContext, input: CreateCreditMemoInput) {
  // Validate lines
  if (!input.lines || input.lines.length === 0) {
    throw validation('A credit memo must have at least one line.');
  }

  // Verify customer belongs to company.
  const [customer] = await ctx.db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.companyId, ctx.companyId), eq(customers.id, input.customerId)));
  if (!customer) throw notFound('Customer');

  // Resolve standing accounts
  const arAccountId = await accountIdByCode(ctx, '1200');
  const defaultIncomeId = await accountIdByCode(ctx, '4000');

  // Compute per-line amounts
  type ComputedLine = {
    accountId: string;
    description: string | null;
    quantity: string;
    rate: string;
    amount: string;
    lineOrder: number;
  };

  let subtotal = Money.zero();
  const computedLines: ComputedLine[] = [];

  for (let i = 0; i < input.lines.length; i++) {
    const l = input.lines[i];
    const qty = Money.of(l.quantity);
    const rate = Money.of(l.rate);
    if (qty.lessThanOrEqualTo(0)) throw validation(`Line ${i + 1}: quantity must be positive.`);
    if (rate.lessThan(0)) throw validation(`Line ${i + 1}: rate cannot be negative.`);

    const amount = Money.round2(Money.mul(qty, rate));

    // Resolve income account: explicit accountId > default 4000
    let resolvedAccountId = defaultIncomeId;
    if (l.accountId) {
      const [acctRow] = await ctx.db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.id, l.accountId)));
      if (!acctRow) throw notFound(`Account ${l.accountId} (line ${i + 1})`);
      resolvedAccountId = acctRow.id;
    }

    subtotal = subtotal.plus(amount);
    computedLines.push({
      accountId: resolvedAccountId,
      description: l.description ?? null,
      quantity: toAmountString(qty),
      rate: toAmountString(rate),
      amount: toAmountString(amount),
      lineOrder: i,
    });
  }

  const total = Money.round2(subtotal);
  if (total.lessThanOrEqualTo(0)) {
    throw validation('Credit memo total must be greater than zero.');
  }

  return inTransaction(ctx, async (tx) => {
    const memoNumber = await nextMemoNumber(tx);

    // 1) Insert credit memo header
    const [memo] = await tx.db
      .insert(creditMemos)
      .values({
        companyId: tx.companyId,
        customerId: input.customerId,
        memoNumber,
        date: input.date,
        status: 'open',
        subtotal: toAmountString(subtotal),
        taxAmount: '0.00',
        total: toAmountString(total),
        unapplied: toAmountString(total),
        memo: input.memo ?? null,
      })
      .returning();

    // 2) Insert credit memo lines
    await tx.db.insert(creditMemoLines).values(
      computedLines.map((cl) => ({
        creditMemoId: memo.id,
        accountId: cl.accountId,
        description: cl.description,
        quantity: cl.quantity,
        rate: cl.rate,
        amount: cl.amount,
        lineOrder: cl.lineOrder,
      })),
    );

    // 3) Build and post GL entry:
    //    Dr each income account for line amounts (sum per account)
    //    Cr 1200 A/R for total
    //
    // Balance check:
    //   Total debits = sum of line amounts = total
    //   Total credits = A/R credit = total  ✓

    const incomeDebits = new Map<string, ReturnType<typeof Money.zero>>();
    for (const cl of computedLines) {
      const prev = incomeDebits.get(cl.accountId) ?? Money.zero();
      incomeDebits.set(cl.accountId, prev.plus(Money.of(cl.amount)));
    }

    const postingLines: Array<{
      accountId: string;
      debit?: string;
      credit?: string;
      memo?: string;
    }> = [];

    // Debit each income account
    for (const [acctId, amount] of incomeDebits) {
      postingLines.push({
        accountId: acctId,
        debit: toAmountString(amount),
        memo: `Credit Memo #${memoNumber} — income reversal`,
      });
    }

    // Credit A/R
    postingLines.push({
      accountId: arAccountId,
      credit: toAmountString(total),
      memo: `Credit Memo #${memoNumber}`,
    });

    const entry = await postJournalEntry(tx, {
      date: input.date,
      description: `Credit Memo #${memoNumber}`,
      reference: String(memoNumber),
      sourceRef: `credit_memo:${memo.id}`,
      lines: postingLines,
    });

    // 4) Stamp postedEntryId
    const [updated] = await tx.db
      .update(creditMemos)
      .set({ postedEntryId: entry.id })
      .where(eq(creditMemos.id, memo.id))
      .returning();

    // 5) Audit
    await writeAudit(tx, {
      action: 'create',
      entityType: 'credit_memo',
      entityId: memo.id,
      newValues: {
        memoNumber,
        customerId: input.customerId,
        total: toAmountString(total),
        postedEntryId: entry.id,
      },
    });

    return { ...updated, lines: computedLines };
  });
}

// ---------------------------------------------------------------------------
// listCreditMemos
// ---------------------------------------------------------------------------

export async function listCreditMemos(
  ctx: ServiceContext,
  opts?: { customerId?: string; status?: string },
) {
  const rows = await ctx.db
    .select()
    .from(creditMemos)
    .where(eq(creditMemos.companyId, ctx.companyId))
    .orderBy(creditMemos.memoNumber);

  return rows.filter((r) => {
    if (opts?.customerId && r.customerId !== opts.customerId) return false;
    if (opts?.status && r.status !== opts.status) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// getCreditMemo (with lines)
// ---------------------------------------------------------------------------

export async function getCreditMemo(ctx: ServiceContext, id: string) {
  const [memo] = await ctx.db
    .select()
    .from(creditMemos)
    .where(and(eq(creditMemos.companyId, ctx.companyId), eq(creditMemos.id, id)));
  if (!memo) throw notFound('Credit memo');

  const lines = await ctx.db
    .select()
    .from(creditMemoLines)
    .where(eq(creditMemoLines.creditMemoId, id))
    .orderBy(asc(creditMemoLines.lineOrder));

  return { ...memo, lines };
}

// ---------------------------------------------------------------------------
// applyToInvoice
// ---------------------------------------------------------------------------

/**
 * Apply a credit memo to an open invoice.
 * No new GL entry is created — the AR impact already happened when the memo was posted.
 * We simply transfer `amount` from the memo's unapplied to the invoice's amountPaid,
 * adjusting balanceDue and status on both documents.
 */
export async function applyToInvoice(ctx: ServiceContext, input: ApplyToInvoiceInput) {
  const amount = Money.round2(input.amount);
  if (!amount.greaterThan(0)) {
    throw validation('Apply amount must be greater than zero.');
  }

  // Load and validate the credit memo
  const [memo] = await ctx.db
    .select()
    .from(creditMemos)
    .where(and(eq(creditMemos.companyId, ctx.companyId), eq(creditMemos.id, input.creditMemoId)));
  if (!memo) throw notFound('Credit memo');
  if (memo.status === 'void') {
    throw new ServiceError('CONFLICT', 'Cannot apply a voided credit memo.');
  }

  const unapplied = Money.of(memo.unapplied);
  if (amount.greaterThan(unapplied)) {
    throw validation(
      `Apply amount ${toAmountString(amount)} exceeds credit memo unapplied balance ${toAmountString(unapplied)}.`,
    );
  }

  // Load and validate the invoice
  const [invoice] = await ctx.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.companyId, ctx.companyId), eq(invoices.id, input.invoiceId)));
  if (!invoice) throw notFound('Invoice');
  if (invoice.status === 'void') {
    throw new ServiceError('CONFLICT', 'Cannot apply credit to a voided invoice.');
  }
  if (invoice.customerId !== memo.customerId) {
    throw new ServiceError(
      'VALIDATION',
      'Credit memo and invoice must belong to the same customer.',
    );
  }

  const balanceDue = Money.of(invoice.balanceDue);
  if (amount.greaterThan(balanceDue)) {
    throw validation(
      `Apply amount ${toAmountString(amount)} exceeds invoice balance due ${toAmountString(balanceDue)}.`,
    );
  }

  return inTransaction(ctx, async (tx) => {
    // Update invoice
    const newAmountPaid = Money.round2(Money.of(invoice.amountPaid).plus(amount));
    const newBalance = Money.round2(Money.of(invoice.total).minus(newAmountPaid));
    const newInvStatus = newBalance.lessThanOrEqualTo(0)
      ? 'paid'
      : newAmountPaid.greaterThan(0)
        ? 'partial'
        : 'open';

    const [updatedInvoice] = await tx.db
      .update(invoices)
      .set({
        amountPaid: toAmountString(newAmountPaid),
        balanceDue: toAmountString(Money.abs(newBalance)),
        status: newInvStatus as never,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, invoice.id))
      .returning();

    // Update credit memo
    const newUnapplied = Money.round2(unapplied.minus(amount));
    const newMemoStatus = newUnapplied.isZero() ? 'paid' : 'open';

    const [updatedMemo] = await tx.db
      .update(creditMemos)
      .set({
        unapplied: toAmountString(newUnapplied),
        status: newMemoStatus as never,
      })
      .where(eq(creditMemos.id, memo.id))
      .returning();

    await writeAudit(tx, {
      action: 'update',
      entityType: 'credit_memo',
      entityId: memo.id,
      oldValues: { unapplied: toAmountString(unapplied), status: memo.status },
      newValues: {
        unapplied: toAmountString(newUnapplied),
        status: newMemoStatus,
        appliedToInvoice: invoice.id,
        amountApplied: toAmountString(amount),
      },
    });

    return { creditMemo: updatedMemo, invoice: updatedInvoice };
  });
}

// ---------------------------------------------------------------------------
// voidCreditMemo
// ---------------------------------------------------------------------------

export async function voidCreditMemo(ctx: ServiceContext, id: string) {
  const [memo] = await ctx.db
    .select()
    .from(creditMemos)
    .where(and(eq(creditMemos.companyId, ctx.companyId), eq(creditMemos.id, id)));
  if (!memo) throw notFound('Credit memo');

  if (memo.status === 'void') {
    return memo; // idempotent
  }

  // Block void if credit has been partially applied
  const applied = Money.round2(Money.of(memo.total).minus(Money.of(memo.unapplied)));
  if (applied.greaterThan(0)) {
    throw new ServiceError(
      'CONFLICT',
      'Cannot void a credit memo with applied amounts. Unapply first.',
    );
  }

  return inTransaction(ctx, async (tx) => {
    if (memo.postedEntryId) {
      await voidJournalEntry(tx, memo.postedEntryId);
    }

    const [updated] = await tx.db
      .update(creditMemos)
      .set({ status: 'void', unapplied: '0.00' })
      .where(eq(creditMemos.id, id))
      .returning();

    await writeAudit(tx, {
      action: 'void',
      entityType: 'credit_memo',
      entityId: id,
      oldValues: { status: memo.status },
      newValues: { status: 'void' },
    });

    return updated;
  });
}
