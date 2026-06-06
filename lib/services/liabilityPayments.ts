/**
 * Liability payment workflows — the core QuickBooks "Pay Sales Tax" and
 * "Pay Payroll Liabilities" flows.
 *
 * All GL impact is routed through postJournalEntry (the only writer of balances).
 * Balances of 2200 / 2300 are derived from posted journal entries, not cached
 * columns, so they remain accurate even after void/adjustment entries.
 */
import { and, eq, sql } from 'drizzle-orm';
import { accounts, journalEntries, journalEntryLines } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import { type ServiceContext, validation } from './_base';
import { postJournalEntry } from './posting';

// ── COA codes fixed by the project spec ─────────────────────────────────────
const CODE_SALES_TAX_PAYABLE = '2200';
const CODE_PAYROLL_LIABILITIES = '2300';

// ── helpers ──────────────────────────────────────────────────────────────────

/** Resolve an account ID by code for this company. Throws VALIDATION when missing. */
async function accountIdByCode(ctx: ServiceContext, code: string): Promise<string> {
  const [row] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, code)));
  if (!row) {
    throw validation(`Required account ${code} not found in this company's chart of accounts.`);
  }
  return row.id;
}

/**
 * Compute the current credit-normal balance of an account from the posted GL.
 * Liability accounts are credit-normal: credit balance = amount owed.
 * Returns a string (2dp) representing the natural (credit) balance.
 * A positive result means the company owes that amount.
 */
async function creditBalance(ctx: ServiceContext, accountId: string): Promise<string> {
  const [row] = await ctx.db
    .select({
      totalDebit: sql<string>`COALESCE(SUM(${journalEntryLines.debit}), 0)`,
      totalCredit: sql<string>`COALESCE(SUM(${journalEntryLines.credit}), 0)`,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .where(
      and(
        eq(journalEntries.companyId, ctx.companyId),
        eq(journalEntries.status, 'posted'),
        eq(journalEntryLines.accountId, accountId),
      ),
    );

  if (!row) return '0.00';
  // Credit-normal: natural balance = credit - debit
  const net = Money.sub(row.totalCredit, row.totalDebit);
  return toAmountString(net);
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface PaySalesTaxInput {
  /** Amount to remit to the tax agency. Must be > 0. */
  amount: number | string;
  /** Payment date. */
  date: Date;
  /** Bank / cash account used to make the payment (Cr side for asset). */
  paymentAccountId: string;
  /** Optional: tax agency id for traceability (stored in journal description). */
  agencyId?: string | null;
  /** Optional memo on the journal entry. */
  memo?: string | null;
}

/**
 * Pay sales tax:
 *   Dr 2200 Sales Tax Payable  <amount>
 *   Cr <paymentAccountId>      <amount>
 *
 * Reduces the Sales Tax Payable liability and drains the bank account.
 */
export async function paySalesTax(ctx: ServiceContext, input: PaySalesTaxInput) {
  const amt = Money.of(input.amount);
  if (!amt.greaterThan(0)) {
    throw validation('Payment amount must be greater than zero.');
  }

  const salesTaxAccountId = await accountIdByCode(ctx, CODE_SALES_TAX_PAYABLE);
  const amtStr = toAmountString(amt);
  const description = input.memo?.trim()
    ? input.memo.trim()
    : `Pay Sales Tax${input.agencyId ? ` (agency: ${input.agencyId})` : ''}`;

  return postJournalEntry(ctx, {
    date: input.date,
    description,
    sourceRef: input.agencyId ? `tax_agency:${input.agencyId}` : undefined,
    lines: [
      { accountId: salesTaxAccountId, debit: amtStr },
      { accountId: input.paymentAccountId, credit: amtStr },
    ],
  });
}

export interface PayPayrollLiabilitiesInput {
  /** Amount to remit (e.g. 941 tax deposit). Must be > 0. */
  amount: number | string;
  /** Payment date. */
  date: Date;
  /** Bank / cash account used to make the payment. */
  paymentAccountId: string;
  /** Optional memo. */
  memo?: string | null;
}

/**
 * Pay payroll liabilities:
 *   Dr 2300 Payroll Liabilities  <amount>
 *   Cr <paymentAccountId>        <amount>
 *
 * Reduces the Payroll Liabilities balance and drains the bank account.
 */
export async function payPayrollLiabilities(
  ctx: ServiceContext,
  input: PayPayrollLiabilitiesInput,
) {
  const amt = Money.of(input.amount);
  if (!amt.greaterThan(0)) {
    throw validation('Payment amount must be greater than zero.');
  }

  const payrollAccountId = await accountIdByCode(ctx, CODE_PAYROLL_LIABILITIES);
  const amtStr = toAmountString(amt);
  const description = input.memo?.trim() ? input.memo.trim() : 'Pay Payroll Liabilities';

  return postJournalEntry(ctx, {
    date: input.date,
    description,
    lines: [
      { accountId: payrollAccountId, debit: amtStr },
      { accountId: input.paymentAccountId, credit: amtStr },
    ],
  });
}

/**
 * Current credit balance of account 2200 (Sales Tax Payable).
 * A positive number means the company owes that amount in sales tax.
 */
export async function salesTaxDue(ctx: ServiceContext): Promise<string> {
  const accountId = await accountIdByCode(ctx, CODE_SALES_TAX_PAYABLE);
  return creditBalance(ctx, accountId);
}

/**
 * Current credit balance of account 2300 (Payroll Liabilities).
 * A positive number means the company owes that amount in payroll taxes/withholdings.
 */
export async function payrollLiabilitiesDue(ctx: ServiceContext): Promise<string> {
  const accountId = await accountIdByCode(ctx, CODE_PAYROLL_LIABILITIES);
  return creditBalance(ctx, accountId);
}
