/**
 * Multi-currency service.
 *
 * The `currencies` table (see schema.ts) tracks every currency a company uses, each with a
 * `rateToBase` (units of base currency per 1 unit of this currency). The base currency always
 * has rateToBase = 1 and isBase = true.
 *
 * Conversions:
 *   amount in foreign → amount in base : amount * fromRate
 *   amount in base    → amount in foreign: amount / toRate
 *   cross-rate (foreign A → foreign B)  : amount * fromRate / toRate
 *
 * FX gain/loss entries are posted through postJournalEntry so the GL remains the single source
 * of truth:
 *   Gain: Dr <asset/liability account>  /  Cr 4900 Other Income
 *   Loss: Dr 6100 Bank & Merchant Fees  /  Cr <asset/liability account>
 */
import { and, eq, ne } from 'drizzle-orm';
import { currencies, accounts } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import { postJournalEntry } from './posting';
import { type ServiceContext, ServiceError, validation, notFound, writeAudit } from './_base';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CurrencyRow {
  id: string;
  companyId: string;
  code: string;
  name: string;
  rateToBase: string;
  isBase: boolean;
  updatedAt: Date;
}

export interface UpsertCurrencyInput {
  code: string;
  name: string;
  /** Exchange rate: how many base-currency units equal 1 unit of this currency. */
  rateToBase: string | number;
}

export interface SetBaseCurrencyInput {
  code: string;
  name: string;
}

export interface RecordFxAdjustmentInput {
  /** The account being revalued (must belong to this company). */
  accountId: string;
  /** Absolute amount of the gain or loss in base currency. */
  amount: string | number;
  /** true = FX gain, false = FX loss. */
  gain: boolean;
  date: Date;
  memo?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a GL account by code, scoped to the company. Throws NOT_FOUND if missing. */
async function resolveAccountByCode(ctx: ServiceContext, code: string): Promise<string> {
  const [row] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, code)));
  if (!row) throw notFound(`Account ${code}`);
  return row.id;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** List all currencies for the company (base currency first). */
export async function listCurrencies(ctx: ServiceContext): Promise<CurrencyRow[]> {
  const rows = await ctx.db
    .select()
    .from(currencies)
    .where(eq(currencies.companyId, ctx.companyId));
  // Put base currency first for convenience
  return rows.sort((a, b) => (b.isBase ? 1 : 0) - (a.isBase ? 1 : 0));
}

/**
 * Set (or replace) the base currency for a company.
 * - If a base already exists its isBase flag is cleared.
 * - The new base is inserted/updated with rateToBase = 1.
 */
export async function setBaseCurrency(
  ctx: ServiceContext,
  input: SetBaseCurrencyInput,
): Promise<CurrencyRow> {
  const { code, name } = input;
  if (!code || code.length > 3) throw validation('Currency code must be 1–3 characters.');
  if (!name) throw validation('Currency name is required.');

  // Clear any existing base flag
  await ctx.db
    .update(currencies)
    .set({ isBase: false, updatedAt: new Date() })
    .where(and(eq(currencies.companyId, ctx.companyId), eq(currencies.isBase, true)));

  // Upsert the new base
  const [existing] = await ctx.db
    .select()
    .from(currencies)
    .where(and(eq(currencies.companyId, ctx.companyId), eq(currencies.code, code.toUpperCase())));

  let row: CurrencyRow;
  if (existing) {
    const [updated] = await ctx.db
      .update(currencies)
      .set({ name, rateToBase: '1', isBase: true, updatedAt: new Date() })
      .where(eq(currencies.id, existing.id))
      .returning();
    row = updated as CurrencyRow;
  } else {
    const [inserted] = await ctx.db
      .insert(currencies)
      .values({
        companyId: ctx.companyId,
        code: code.toUpperCase(),
        name,
        rateToBase: '1',
        isBase: true,
      })
      .returning();
    row = inserted as CurrencyRow;
  }

  await writeAudit(ctx, {
    action: 'update',
    entityType: 'currency',
    entityId: row.id,
    newValues: { code: row.code, name: row.name, isBase: true },
  });

  return row;
}

/**
 * Insert or update a foreign currency and its exchange rate.
 * Cannot be used to (re-)set the base currency — use setBaseCurrency for that.
 * rateToBase must be positive (> 0).
 */
export async function upsertCurrency(
  ctx: ServiceContext,
  input: UpsertCurrencyInput,
): Promise<CurrencyRow> {
  const { code, name, rateToBase } = input;
  if (!code || code.length > 3) throw validation('Currency code must be 1–3 characters.');
  if (!name) throw validation('Currency name is required.');

  const rate = Money.of(rateToBase);
  if (!rate.greaterThan(0)) throw validation('rateToBase must be greater than zero.');

  const [existing] = await ctx.db
    .select()
    .from(currencies)
    .where(and(eq(currencies.companyId, ctx.companyId), eq(currencies.code, code.toUpperCase())));

  let row: CurrencyRow;
  if (existing) {
    if (existing.isBase) {
      throw new ServiceError(
        'CONFLICT',
        `${code.toUpperCase()} is the base currency. Use setBaseCurrency to change the base.`,
      );
    }
    const [updated] = await ctx.db
      .update(currencies)
      .set({ name, rateToBase: rate.toFixed(8), updatedAt: new Date() })
      .where(eq(currencies.id, existing.id))
      .returning();
    row = updated as CurrencyRow;
  } else {
    const [inserted] = await ctx.db
      .insert(currencies)
      .values({
        companyId: ctx.companyId,
        code: code.toUpperCase(),
        name,
        rateToBase: rate.toFixed(8),
        isBase: false,
      })
      .returning();
    row = inserted as CurrencyRow;
  }

  await writeAudit(ctx, {
    action: existing ? 'update' : 'create',
    entityType: 'currency',
    entityId: row.id,
    oldValues: existing ? { rateToBase: existing.rateToBase } : undefined,
    newValues: { code: row.code, name: row.name, rateToBase: row.rateToBase },
  });

  return row;
}

/**
 * Convert an amount between currencies via their rateToBase values.
 *
 * @param amount    The source amount.
 * @param fromRate  rateToBase of the source currency  (1.0 if source is base).
 * @param toRate    rateToBase of the target currency  (1.0 if target is base).
 * @returns         The converted amount as a Decimal-string (toFixed(2)).
 *
 * Formula: amount * fromRate / toRate
 */
export function convert(
  amount: string | number,
  fromRate: string | number,
  toRate: string | number = '1',
): string {
  const result = Money.of(amount).times(Money.of(fromRate)).dividedBy(Money.of(toRate));
  return toAmountString(result);
}

/**
 * Return the revaluation snapshot: all non-base currencies with their current rate.
 * This is the data foundation for an FX revaluation report — callers can combine it
 * with account balances to compute unrealised gains/losses.
 */
export async function revaluation(
  ctx: ServiceContext,
): Promise<Array<{ id: string; code: string; name: string; rateToBase: string }>> {
  const rows = await ctx.db
    .select({ id: currencies.id, code: currencies.code, name: currencies.name, rateToBase: currencies.rateToBase })
    .from(currencies)
    .where(and(eq(currencies.companyId, ctx.companyId), ne(currencies.isBase, true)));
  return rows;
}

/**
 * Post a balanced FX gain/loss journal entry through the posting engine.
 *
 *   Gain: Dr <accountId>       /  Cr 4900 (Other Income)
 *   Loss: Dr 6100 (Bank Fees)  /  Cr <accountId>
 *
 * Both lines are equal to `amount` so the entry is always balanced.
 */
export async function recordFxAdjustment(
  ctx: ServiceContext,
  input: RecordFxAdjustmentInput,
): Promise<{ entryId: string }> {
  const { accountId, amount, gain, date, memo } = input;

  const absAmount = Money.abs(amount);
  if (absAmount.isZero()) throw validation('FX adjustment amount must be non-zero.');

  // Verify the target account belongs to this company
  const [targetAcct] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.id, accountId)));
  if (!targetAcct) throw notFound(`Account ${accountId}`);

  const otherIncomeId = await resolveAccountByCode(ctx, '4900');
  const bankFeesId = await resolveAccountByCode(ctx, '6100');

  const amtStr = toAmountString(absAmount);
  const description = memo ?? (gain ? 'FX gain adjustment' : 'FX loss adjustment');

  let lines: Array<{ accountId: string; debit?: string; credit?: string; memo?: string }>;

  if (gain) {
    // Gain: Dr the subject account / Cr Other Income (4900)
    lines = [
      { accountId, debit: amtStr, memo: description },
      { accountId: otherIncomeId, credit: amtStr, memo: description },
    ];
  } else {
    // Loss: Dr Bank & Merchant Fees (6100) / Cr the subject account
    lines = [
      { accountId: bankFeesId, debit: amtStr, memo: description },
      { accountId, credit: amtStr, memo: description },
    ];
  }

  const entry = await postJournalEntry(ctx, {
    date,
    description,
    lines,
    sourceRef: 'fx_adjustment',
  });

  return { entryId: entry.id };
}
