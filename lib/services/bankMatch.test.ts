/**
 * Integration tests for bank-feed MATCH + EXCLUDE (QB Bank Feeds parity).
 *
 * Boots a throwaway PGlite database, seeds a user + company + GL accounts +
 * a bank account + posted journal entries + staged bank_transactions, then
 * exercises:
 *   - suggestMatches: amount/sign/date-window filtering, check-number ranking,
 *     already-matched exclusion
 *   - matchTransaction: links matchedEntryId WITHOUT posting a new entry,
 *     validates account/amount, rejects double-matches
 *   - unmatch: clears the link without voiding a pre-existing entry, but DOES
 *     void an entry that categorize created
 *   - excludeTransaction / restoreExcluded + listStaged filters
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { getDb, closeDb, type DB } from '@/lib/db';
import {
  users,
  companies,
  accounts,
  bankAccounts,
  bankTransactions,
  journalEntries,
} from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';
import { postJournalEntry } from './posting';
import { trialBalance } from './reports';
import {
  listStaged,
  categorize,
  suggestMatches,
  matchTransaction,
  excludeTransaction,
  restoreExcluded,
  unmatch,
} from './bankCategorize';

// ---------------------------------------------------------------------------
// UNIQUE test directory
// ---------------------------------------------------------------------------

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-bank-match');

let ctx: ServiceContext;
let db: DB;

// IDs populated during setup
let checkingGlId: string; // 1000 — bank GL
let savingsGlId: string;  // 1010 — second bank GL (wrong-account tests)
let expenseId: string;    // 6000
let revenueId: string;    // 4000
let bankAccountId: string;

// Posted "register" entries (pre-existing books)
let checkEntryId: string;    // -200 check, reference 1042, dated 03-04
let depositEntryId: string;  // +500 deposit, dated 03-02
let farEntryId: string;      // -200 check dated 04-20 (outside ±14d window)

// Staged feed lines
let feedCheckId: string;   // -200.00 on 03-05, description "CHECK 1042"
let feedDepositId: string; // +500.00 on 03-01
let feedJunkId: string;    // -9.99 on 03-06 (exclude tests)
let feedAddId: string;     // -55.00 on 03-07 (categorize-then-unmatch test)

async function postedEntryCount(): Promise<number> {
  const rows = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(eq(journalEntries.companyId, ctx.companyId));
  return rows.length;
}

describe('Bank-feed match + exclude', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'match@test.local', name: 'Match Tester', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Match Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // GL accounts
    const [checking] = await db
      .insert(accounts)
      .values({ companyId: company.id, code: '1000', name: 'Checking', type: 'asset', subtype: 'checking' })
      .returning();
    checkingGlId = checking.id;

    const [savings] = await db
      .insert(accounts)
      .values({ companyId: company.id, code: '1010', name: 'Savings', type: 'asset', subtype: 'savings' })
      .returning();
    savingsGlId = savings.id;

    const [revenue] = await db
      .insert(accounts)
      .values({ companyId: company.id, code: '4000', name: 'Sales Revenue', type: 'revenue', subtype: 'sales' })
      .returning();
    revenueId = revenue.id;

    const [expense] = await db
      .insert(accounts)
      .values({ companyId: company.id, code: '6000', name: 'Office Expense', type: 'expense', subtype: 'operating_expenses' })
      .returning();
    expenseId = expense.id;

    await db
      .insert(accounts)
      .values({ companyId: company.id, code: '3000', name: 'Owner Equity', type: 'equity', subtype: 'owners_equity' });

    const [ba] = await db
      .insert(bankAccounts)
      .values({ companyId: company.id, accountId: checkingGlId, bankName: 'Test Bank', accountNumber: '****1234' })
      .returning();
    bankAccountId = ba.id;

    // ---- Pre-existing register entries (the books already have these) ----
    // Check #1042: Dr Expense 200 / Cr Checking 200 — bank net −200.
    const checkEntry = await postJournalEntry(ctx, {
      date: new Date('2025-03-04'),
      description: 'Check to Office Depot',
      reference: '1042',
      lines: [
        { accountId: expenseId, debit: '200.00' },
        { accountId: checkingGlId, credit: '200.00' },
      ],
    });
    checkEntryId = checkEntry.id;

    // Deposit: Dr Checking 500 / Cr Revenue 500 — bank net +500.
    const depositEntry = await postJournalEntry(ctx, {
      date: new Date('2025-03-02'),
      description: 'Customer deposit',
      lines: [
        { accountId: checkingGlId, debit: '500.00' },
        { accountId: revenueId, credit: '500.00' },
      ],
    });
    depositEntryId = depositEntry.id;

    // Same amount as the check but 46 days later — outside the ±14d window.
    const farEntry = await postJournalEntry(ctx, {
      date: new Date('2025-04-20'),
      description: 'Later check, same amount',
      lines: [
        { accountId: expenseId, debit: '200.00' },
        { accountId: checkingGlId, credit: '200.00' },
      ],
    });
    farEntryId = farEntry.id;

    // ---- Staged feed lines ----
    const [feedCheck] = await db
      .insert(bankTransactions)
      .values({
        companyId: company.id,
        bankAccountId,
        date: new Date('2025-03-05'),
        description: 'CHECK 1042 OFFICE DEPOT',
        amount: '-200.00',
      })
      .returning();
    feedCheckId = feedCheck.id;

    const [feedDeposit] = await db
      .insert(bankTransactions)
      .values({
        companyId: company.id,
        bankAccountId,
        date: new Date('2025-03-01'),
        description: 'BRANCH DEPOSIT',
        amount: '500.00',
      })
      .returning();
    feedDepositId = feedDeposit.id;

    const [feedJunk] = await db
      .insert(bankTransactions)
      .values({
        companyId: company.id,
        bankAccountId,
        date: new Date('2025-03-06'),
        description: 'PERSONAL COFFEE',
        amount: '-9.99',
      })
      .returning();
    feedJunkId = feedJunk.id;

    const [feedAdd] = await db
      .insert(bankTransactions)
      .values({
        companyId: company.id,
        bankAccountId,
        date: new Date('2025-03-07'),
        description: 'OFFICE SUPPLY RUN',
        amount: '-55.00',
      })
      .returning();
    feedAddId = feedAdd.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // suggestMatches
  // -------------------------------------------------------------------------

  it('suggestMatches finds the check entry with a high-confidence reference match', async () => {
    const candidates = await suggestMatches(ctx, feedCheckId);
    expect(candidates.length).toBeGreaterThanOrEqual(1);

    const top = candidates[0];
    expect(top.entryId).toBe(checkEntryId);
    expect(top.referenceMatch).toBe(true);
    expect(top.confidence).toBe('high');
    expect(top.score).toBe(100);
    expect(top.amount).toBe('-200.00');

    // Sign-compatible only: the +500 deposit must NOT be a candidate for a −200 line.
    expect(candidates.some((c) => c.entryId === depositEntryId)).toBe(false);
  });

  it('suggestMatches excludes entries outside the ±14-day window', async () => {
    const candidates = await suggestMatches(ctx, feedCheckId);
    expect(candidates.some((c) => c.entryId === farEntryId)).toBe(false);
  });

  it('suggestMatches finds the deposit for the money-IN feed line', async () => {
    const candidates = await suggestMatches(ctx, feedDepositId);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].entryId).toBe(depositEntryId);
    expect(candidates[0].amount).toBe('500.00');
    expect(candidates[0].dateDiffDays).toBe(1);
    expect(candidates[0].confidence).toBe('high'); // 1 day away
  });

  it('suggestMatches returns [] when nothing fits', async () => {
    const candidates = await suggestMatches(ctx, feedJunkId); // −9.99, no entry
    expect(candidates).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // matchTransaction
  // -------------------------------------------------------------------------

  it('matchTransaction validates account/amount before linking', async () => {
    // Deposit entry (+500) cannot match the −200 feed line.
    await expect(matchTransaction(ctx, feedCheckId, depositEntryId)).rejects.toSatisfy(
      (e: unknown) => e instanceof ServiceError && e.code === 'VALIDATION',
    );

    // An entry that never touches the Checking GL is rejected too.
    const offBank = await postJournalEntry(ctx, {
      date: new Date('2025-03-05'),
      description: 'Savings-only movement',
      lines: [
        { accountId: savingsGlId, debit: '200.00' },
        { accountId: revenueId, credit: '200.00' },
      ],
    });
    await expect(matchTransaction(ctx, feedCheckId, offBank.id)).rejects.toSatisfy(
      (e: unknown) => e instanceof ServiceError && e.code === 'VALIDATION',
    );
  });

  it('matchTransaction links the existing entry WITHOUT posting a new one', async () => {
    const before = await postedEntryCount();
    const tbBefore = await trialBalance(ctx);

    const { transaction, entry } = await matchTransaction(ctx, feedCheckId, checkEntryId);
    expect(transaction.matched).toBe(true);
    expect(transaction.matchedEntryId).toBe(checkEntryId);
    expect(entry.id).toBe(checkEntryId);

    // The whole point: no new journal entry, no GL movement.
    const after = await postedEntryCount();
    expect(after).toBe(before);
    const tbAfter = await trialBalance(ctx);
    expect(tbAfter.totalDebit).toBe(tbBefore.totalDebit);
    expect(tbAfter.totalCredit).toBe(tbBefore.totalCredit);
  });

  it('an entry matched to one feed line stops being suggested for others', async () => {
    // New −200 feed line; checkEntry is taken, farEntry is out of window → no candidates.
    const [dup] = await db
      .insert(bankTransactions)
      .values({
        companyId: ctx.companyId,
        bankAccountId,
        date: new Date('2025-03-05'),
        description: 'CHECK 1042 OFFICE DEPOT (duplicate feed line)',
        amount: '-200.00',
      })
      .returning();
    const candidates = await suggestMatches(ctx, dup.id);
    expect(candidates.some((c) => c.entryId === checkEntryId)).toBe(false);

    // And matching it directly to the taken entry is a CONFLICT.
    await expect(matchTransaction(ctx, dup.id, checkEntryId)).rejects.toSatisfy(
      (e: unknown) => e instanceof ServiceError && e.code === 'CONFLICT',
    );
  });

  it('matchTransaction rejects an already-matched feed line', async () => {
    await expect(matchTransaction(ctx, feedCheckId, checkEntryId)).rejects.toSatisfy(
      (e: unknown) => e instanceof ServiceError && e.code === 'CONFLICT',
    );
  });

  // -------------------------------------------------------------------------
  // unmatch — matched-to-existing vs categorized
  // -------------------------------------------------------------------------

  it('unmatch on a matched-to-existing row clears the link WITHOUT voiding the entry', async () => {
    const updated = await unmatch(ctx, feedCheckId);
    expect(updated.matched).toBe(false);
    expect(updated.matchedEntryId).toBeNull();

    // Pre-existing register entry must remain posted.
    const [entry] = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, checkEntryId));
    expect(entry.status).toBe('posted');
  });

  it('unmatch on a categorized row still voids the entry categorize created', async () => {
    const { entry } = await categorize(ctx, {
      bankTransactionId: feedAddId,
      accountId: expenseId,
    });
    expect(entry.status).toBe('posted');

    const updated = await unmatch(ctx, feedAddId);
    expect(updated.matched).toBe(false);
    expect(updated.matchedEntryId).toBeNull();

    const [voided] = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, entry.id));
    expect(voided.status).toBe('void');

    const tb = await trialBalance(ctx);
    expect(Math.abs(parseFloat(tb.totalDebit) - parseFloat(tb.totalCredit))).toBeLessThan(0.005);
  });

  // -------------------------------------------------------------------------
  // exclude / restore + listStaged filters
  // -------------------------------------------------------------------------

  it('excludeTransaction removes the row from the review queue', async () => {
    const excluded = await excludeTransaction(ctx, feedJunkId);
    expect(excluded.excluded).toBe(true);

    const unreviewed = await listStaged(ctx, bankAccountId, { filter: 'unreviewed' });
    expect(unreviewed.some((r) => r.id === feedJunkId)).toBe(false);

    const excludedRows = await listStaged(ctx, bankAccountId, { filter: 'excluded' });
    expect(excludedRows.some((r) => r.id === feedJunkId)).toBe(true);

    // unmatchedOnly back-compat behaves like 'unreviewed'.
    const legacy = await listStaged(ctx, bankAccountId, { unmatchedOnly: true });
    expect(legacy.some((r) => r.id === feedJunkId)).toBe(false);
  });

  it('excluded rows cannot be categorized, matched, or re-excluded', async () => {
    await expect(
      categorize(ctx, { bankTransactionId: feedJunkId, accountId: expenseId }),
    ).rejects.toSatisfy((e: unknown) => e instanceof ServiceError && e.code === 'CONFLICT');

    await expect(matchTransaction(ctx, feedJunkId, checkEntryId)).rejects.toSatisfy(
      (e: unknown) => e instanceof ServiceError && e.code === 'CONFLICT',
    );

    await expect(suggestMatches(ctx, feedJunkId)).rejects.toSatisfy(
      (e: unknown) => e instanceof ServiceError && e.code === 'CONFLICT',
    );

    await expect(excludeTransaction(ctx, feedJunkId)).rejects.toSatisfy(
      (e: unknown) => e instanceof ServiceError && e.code === 'CONFLICT',
    );
  });

  it('restoreExcluded puts the row back in the review queue', async () => {
    const restored = await restoreExcluded(ctx, feedJunkId);
    expect(restored.excluded).toBe(false);

    const unreviewed = await listStaged(ctx, bankAccountId, { filter: 'unreviewed' });
    expect(unreviewed.some((r) => r.id === feedJunkId)).toBe(true);

    await expect(restoreExcluded(ctx, feedJunkId)).rejects.toSatisfy(
      (e: unknown) => e instanceof ServiceError && e.code === 'CONFLICT',
    );
  });

  it('a matched row cannot be excluded', async () => {
    // Re-match the check feed line (it was unmatched earlier).
    await matchTransaction(ctx, feedCheckId, checkEntryId);
    await expect(excludeTransaction(ctx, feedCheckId)).rejects.toSatisfy(
      (e: unknown) => e instanceof ServiceError && e.code === 'CONFLICT',
    );
  });

  it('listStaged filter=matched returns matched rows only', async () => {
    const matchedRows = await listStaged(ctx, bankAccountId, { filter: 'matched' });
    expect(matchedRows.length).toBeGreaterThanOrEqual(1);
    expect(matchedRows.every((r) => r.matched)).toBe(true);
    expect(matchedRows.some((r) => r.id === feedCheckId)).toBe(true);
  });
});
