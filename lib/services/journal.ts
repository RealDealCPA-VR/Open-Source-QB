/**
 * Manual Journal Entries + General Ledger service.
 *
 * `createManualEntry` is the public-facing wrapper around `postJournalEntry` for user-authored
 * double-entry transactions entered directly in the UI (as opposed to invoices, bills, etc. that
 * auto-post through their own service layers).
 *
 * `generalLedger` produces the per-account register view — the chronological list of every line
 * that touched an account together with a running balance. The running balance respects the
 * natural sign convention (debit-normal for asset/expense, credit-normal for liability/equity/revenue).
 */
import { and, asc, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { accounts, journalEntries, journalEntryLines } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import {
  type ServiceContext,
  ServiceError,
  notFound,
  validation,
} from './_base';
import {
  type PostingLine,
  postJournalEntry,
  voidJournalEntry,
  balanceDelta,
} from './posting';

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface ManualEntryInput {
  date: Date;
  description: string;
  reference?: string | null;
  lines: PostingLine[];
}

export interface JournalEntryLine {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: string | null;
  credit: string | null;
  memo: string | null;
}

export interface JournalEntryDetail {
  id: string;
  entryNumber: number;
  date: Date;
  description: string;
  reference: string | null;
  status: string;
  createdAt: Date;
  voidedAt: Date | null;
  lines: JournalEntryLine[];
}

export interface ListEntriesOptions {
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

export interface GLRegisterRow {
  date: Date;
  entryNumber: number;
  description: string;
  reference: string | null;
  journalEntryId: string;
  lineId: string;
  debit: string | null;
  credit: string | null;
  /** Running natural balance of the account up through (and including) this line. */
  runningBalance: string;
}

export interface GeneralLedgerResult {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  lines: GLRegisterRow[];
  /** Closing balance after all lines in the result set. */
  closingBalance: string;
}

export interface GLOptions {
  /** Restrict to a single account; if omitted, returns GL for all accounts. */
  accountId?: string;
  from?: Date;
  to?: Date;
}

// ---------------------------------------------------------------------------
// createManualEntry
// ---------------------------------------------------------------------------

/**
 * Create a user-authored manual journal entry.
 * Delegates all validation and balance-update logic to `postJournalEntry`.
 */
export async function createManualEntry(ctx: ServiceContext, input: ManualEntryInput) {
  if (!input.description?.trim()) {
    throw validation('Description is required.');
  }
  if (!input.date || isNaN(input.date.getTime())) {
    throw validation('A valid date is required.');
  }
  return postJournalEntry(ctx, {
    date: input.date,
    description: input.description.trim(),
    reference: input.reference ?? null,
    status: 'posted',
    lines: input.lines,
    sourceRef: 'manual',
  });
}

// ---------------------------------------------------------------------------
// listEntries
// ---------------------------------------------------------------------------

/** List posted + voided journal entries for this company with optional date range paging. */
export async function listEntries(ctx: ServiceContext, opts: ListEntriesOptions = {}) {
  const conds = [eq(journalEntries.companyId, ctx.companyId)];
  if (opts.from) conds.push(gte(journalEntries.date, opts.from));
  if (opts.to) conds.push(lte(journalEntries.date, opts.to));

  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  const rows = await ctx.db
    .select()
    .from(journalEntries)
    .where(and(...conds))
    .orderBy(desc(journalEntries.date), desc(journalEntries.entryNumber))
    .limit(limit)
    .offset(offset);

  return rows;
}

// ---------------------------------------------------------------------------
// getEntry
// ---------------------------------------------------------------------------

/** Fetch a single journal entry with its lines and account names. */
export async function getEntry(ctx: ServiceContext, id: string): Promise<JournalEntryDetail> {
  // Load the entry header — scope by companyId for multi-tenant safety.
  const [entry] = await ctx.db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, id), eq(journalEntries.companyId, ctx.companyId)));

  if (!entry) throw notFound('Journal entry');

  // Load lines joined with account code/name.
  const lineRows = await ctx.db
    .select({
      id: journalEntryLines.id,
      accountId: journalEntryLines.accountId,
      accountCode: accounts.code,
      accountName: accounts.name,
      debit: journalEntryLines.debit,
      credit: journalEntryLines.credit,
      memo: journalEntryLines.memo,
    })
    .from(journalEntryLines)
    .innerJoin(accounts, eq(journalEntryLines.accountId, accounts.id))
    .where(eq(journalEntryLines.journalEntryId, id))
    .orderBy(asc(journalEntryLines.createdAt));

  return {
    id: entry.id,
    entryNumber: entry.entryNumber,
    date: entry.date,
    description: entry.description,
    reference: entry.reference ?? null,
    status: entry.status,
    createdAt: entry.createdAt,
    voidedAt: entry.voidedAt ?? null,
    lines: lineRows.map((l) => ({
      id: l.id,
      accountId: l.accountId,
      accountCode: l.accountCode,
      accountName: l.accountName,
      debit: l.debit ?? null,
      credit: l.credit ?? null,
      memo: l.memo ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// voidEntry
// ---------------------------------------------------------------------------

/** Void a posted journal entry and reverse its balance impact. */
export async function voidEntry(ctx: ServiceContext, id: string) {
  // Confirm the entry belongs to this company before delegating to the engine.
  const [entry] = await ctx.db
    .select({ id: journalEntries.id, companyId: journalEntries.companyId })
    .from(journalEntries)
    .where(and(eq(journalEntries.id, id), eq(journalEntries.companyId, ctx.companyId)));

  if (!entry) throw notFound('Journal entry');

  return voidJournalEntry(ctx, id);
}

// ---------------------------------------------------------------------------
// generalLedger
// ---------------------------------------------------------------------------

/**
 * General Ledger register: chronological lines per account with a running balance.
 *
 * Running balance convention (matches accounting):
 *  - Asset / Expense accounts are debit-normal → balance increases on debit.
 *  - Liability / Equity / Revenue accounts are credit-normal → balance increases on credit.
 *
 * Only 'posted' entries are included (voided entries are excluded from the GL view).
 */
export async function generalLedger(
  ctx: ServiceContext,
  opts: GLOptions = {},
): Promise<GeneralLedgerResult[]> {
  // Build account filter conditions.
  const acctConds = [eq(accounts.companyId, ctx.companyId), eq(accounts.isActive, true)];
  if (opts.accountId) acctConds.push(eq(accounts.id, opts.accountId));

  // Load the requested account(s).
  const acctRows = await ctx.db
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
    })
    .from(accounts)
    .where(and(...acctConds))
    .orderBy(asc(accounts.code));

  if (acctRows.length === 0 && opts.accountId) {
    throw notFound('Account');
  }

  // Build journal entry conditions — only posted entries, scoped to company + optional date range.
  const entryConds = [
    eq(journalEntries.companyId, ctx.companyId),
    eq(journalEntries.status, 'posted'),
  ];
  if (opts.from) entryConds.push(gte(journalEntries.date, opts.from));
  if (opts.to) entryConds.push(lte(journalEntries.date, opts.to));

  // Pull all relevant lines in one query, joining entry header for date/entryNumber/description.
  const accountIds = acctRows.map((a) => a.id);
  if (accountIds.length === 0) return [];

  // We use a parameterised IN list. Drizzle's `inArray` needs at least 1 element.
  const { inArray } = await import('drizzle-orm');

  const lineRows = await ctx.db
    .select({
      lineId: journalEntryLines.id,
      journalEntryId: journalEntryLines.journalEntryId,
      accountId: journalEntryLines.accountId,
      debit: journalEntryLines.debit,
      credit: journalEntryLines.credit,
      date: journalEntries.date,
      entryNumber: journalEntries.entryNumber,
      description: journalEntries.description,
      reference: journalEntries.reference,
    })
    .from(journalEntryLines)
    .innerJoin(journalEntries, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .where(and(inArray(journalEntryLines.accountId, accountIds), ...entryConds))
    .orderBy(asc(journalEntries.date), asc(journalEntries.entryNumber), asc(journalEntryLines.createdAt));

  // Group lines by accountId, accumulate running balance per account.
  const linesByAccount = new Map<string, typeof lineRows>();
  for (const row of lineRows) {
    const bucket = linesByAccount.get(row.accountId) ?? [];
    bucket.push(row);
    linesByAccount.set(row.accountId, bucket);
  }

  const results: GeneralLedgerResult[] = [];

  for (const acct of acctRows) {
    const acctLines = linesByAccount.get(acct.id) ?? [];
    let runningBalance = Money.zero();
    const registerRows: GLRegisterRow[] = [];

    for (const line of acctLines) {
      // balanceDelta follows debit-normal for asset/expense, credit-normal for everything else.
      const delta = balanceDelta(acct.type, line.debit, line.credit);
      runningBalance = runningBalance.plus(delta);

      registerRows.push({
        date: line.date,
        entryNumber: line.entryNumber,
        description: line.description,
        reference: line.reference ?? null,
        journalEntryId: line.journalEntryId,
        lineId: line.lineId,
        debit: line.debit ?? null,
        credit: line.credit ?? null,
        runningBalance: toAmountString(runningBalance),
      });
    }

    results.push({
      accountId: acct.id,
      accountCode: acct.code,
      accountName: acct.name,
      accountType: acct.type,
      lines: registerRows,
      closingBalance: toAmountString(runningBalance),
    });
  }

  return results;
}
