/**
 * Integration tests for the bank-categorize service.
 *
 * Boots a throwaway PGlite database, seeds a user + company + GL accounts +
 * a bank account + staged bank_transactions, then exercises:
 *   - listStaged (all / unmatched-only)
 *   - categorize  (money-in and money-out)
 *   - GL trial balance remains balanced after both postings
 *   - matched flag is set correctly
 *   - categorize rejects already-matched transactions
 *   - unmatch voids the entry and clears the flag
 *   - bulkApplyRules / categorizeSuggested batch flow
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { eq, and, sql } from 'drizzle-orm';
import { getDb, closeDb, type DB } from '@/lib/db';
import {
  users,
  companies,
  accounts,
  bankAccounts,
  bankTransactions,
} from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';
import { trialBalance } from './reports';
import { createRule } from './rules';
import {
  listStaged,
  categorize,
  bulkApplyRules,
  categorizeSuggested,
  unmatch,
} from './bankCategorize';

// ---------------------------------------------------------------------------
// UNIQUE test directory
// ---------------------------------------------------------------------------

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-bank-categorize');

let ctx: ServiceContext;
let db: DB;

// IDs populated during setup
let checkingGlId: string;   // 1000 — GL asset (bank GL)
let expenseId: string;      // 6000 — expense account
let revenueId: string;      // 4000 — income account
let bankAccountId: string;

let txnInId: string;        // staged: amount +500 (money IN)
let txnOutId: string;       // staged: amount -200 (money OUT)

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

describe('Bank categorize service', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    // Seed user + company.
    const [user] = await db
      .insert(users)
      .values({ email: 'categorize@test.local', name: 'Cat Tester', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Categorize Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // GL accounts
    const [checking] = await db
      .insert(accounts)
      .values({ companyId: company.id, code: '1000', name: 'Checking', type: 'asset', subtype: 'checking' })
      .returning();
    checkingGlId = checking.id;

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

    // Equity account — needed so trial balance starts at zero.
    await db
      .insert(accounts)
      .values({ companyId: company.id, code: '3000', name: 'Owner Equity', type: 'equity', subtype: 'owners_equity' })
      .returning();

    // Bank account (links Checking GL to a real bank).
    const [ba] = await db
      .insert(bankAccounts)
      .values({
        companyId: company.id,
        accountId: checkingGlId,
        bankName: 'Test Bank',
        accountNumber: '****9999',
      })
      .returning();
    bankAccountId = ba.id;

    // Seed two staged transactions (unmatched).
    const [txnIn] = await db
      .insert(bankTransactions)
      .values({
        companyId: company.id,
        bankAccountId,
        date: new Date('2025-03-01'),
        description: 'Customer payment deposit',
        amount: '500.00',
        matched: false,
      })
      .returning();
    txnInId = txnIn.id;

    const [txnOut] = await db
      .insert(bankTransactions)
      .values({
        companyId: company.id,
        bankAccountId,
        date: new Date('2025-03-05'),
        description: 'Office supplies purchase',
        amount: '-200.00',
        matched: false,
      })
      .returning();
    txnOutId = txnOut.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // listStaged
  // -------------------------------------------------------------------------

  it('listStaged returns both transactions (no filter)', async () => {
    const rows = await listStaged(ctx, bankAccountId);
    expect(rows).toHaveLength(2);
  });

  it('listStaged unmatchedOnly returns both unmatched transactions initially', async () => {
    const rows = await listStaged(ctx, bankAccountId, { unmatchedOnly: true });
    expect(rows).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // categorize — money IN (+500)
  // -------------------------------------------------------------------------

  it('categorize posts money-IN: Dr Checking / Cr Revenue + marks matched', async () => {
    const { transaction, entry } = await categorize(ctx, {
      bankTransactionId: txnInId,
      accountId: revenueId,
      memo: 'Customer payment',
    });

    // matched flag set
    expect(transaction.matched).toBe(true);
    expect(transaction.matchedEntryId).toBe(entry.id);

    // entry was posted
    expect(entry.status).toBe('posted');

    // Check GL line directions: Checking (asset) debited, Revenue credited.
    const { journalEntryLines } = await import('@/lib/db/schema');
    const lines = await db
      .select()
      .from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, entry.id));
    expect(lines).toHaveLength(2);

    const checkingLine = lines.find((l) => l.accountId === checkingGlId);
    const revenueLine  = lines.find((l) => l.accountId === revenueId);
    expect(checkingLine?.debit).toBe('500.00');
    expect(checkingLine?.credit).toBeNull();
    expect(revenueLine?.credit).toBe('500.00');
    expect(revenueLine?.debit).toBeNull();

    // Trial balance must be balanced after posting.
    const tb = await trialBalance(ctx);
    expect(Math.abs(parseFloat(tb.totalDebit) - parseFloat(tb.totalCredit))).toBeLessThan(0.005);
  });

  // -------------------------------------------------------------------------
  // categorize — money OUT (-200)
  // -------------------------------------------------------------------------

  it('categorize posts money-OUT: Dr Expense / Cr Checking + marks matched', async () => {
    const { transaction, entry } = await categorize(ctx, {
      bankTransactionId: txnOutId,
      accountId: expenseId,
      payee: 'Office Depot',
    });

    expect(transaction.matched).toBe(true);
    expect(transaction.payee).toBe('Office Depot');

    const { journalEntryLines } = await import('@/lib/db/schema');
    const lines = await db
      .select()
      .from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, entry.id));

    const expLine  = lines.find((l) => l.accountId === expenseId);
    const bankLine = lines.find((l) => l.accountId === checkingGlId);
    // abs(−200) = 200 debit to expense, credit to bank
    expect(expLine?.debit).toBe('200.00');
    expect(expLine?.credit).toBeNull();
    expect(bankLine?.credit).toBe('200.00');
    expect(bankLine?.debit).toBeNull();

    // Trial balance remains balanced after both postings.
    const tb = await trialBalance(ctx);
    expect(Math.abs(parseFloat(tb.totalDebit) - parseFloat(tb.totalCredit))).toBeLessThan(0.005);
  });

  // -------------------------------------------------------------------------
  // listStaged — after both categorized
  // -------------------------------------------------------------------------

  it('listStaged unmatchedOnly returns 0 after both are matched', async () => {
    const rows = await listStaged(ctx, bankAccountId, { unmatchedOnly: true });
    expect(rows).toHaveLength(0);
  });

  it('listStaged without filter still returns both rows', async () => {
    const rows = await listStaged(ctx, bankAccountId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.matched)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Conflict: re-categorize already-matched transaction
  // -------------------------------------------------------------------------

  it('categorize throws CONFLICT when transaction already matched', async () => {
    await expect(
      categorize(ctx, { bankTransactionId: txnInId, accountId: revenueId }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof ServiceError && e.code === 'CONFLICT',
    );
  });

  // -------------------------------------------------------------------------
  // unmatch — undo the money-IN categorization
  // -------------------------------------------------------------------------

  it('unmatch voids the GL entry and clears matched flag', async () => {
    // Capture the matchedEntryId BEFORE unmatching so we can verify it was voided.
    const [beforeUnmatch] = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, txnInId));
    const entryIdToVoid = beforeUnmatch.matchedEntryId!;
    expect(entryIdToVoid).toBeTruthy();

    const updated = await unmatch(ctx, txnInId);
    expect(updated.matched).toBe(false);
    expect(updated.matchedEntryId).toBeNull();

    // The previously matched GL entry should now be void.
    const { journalEntries } = await import('@/lib/db/schema');
    const [voidedEntry] = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, entryIdToVoid));
    expect(voidedEntry?.status).toBe('void');

    // Confirm the staging row itself is cleared.
    const [txnRow] = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, txnInId));
    expect(txnRow.matched).toBe(false);
    expect(txnRow.matchedEntryId).toBeNull();
  });

  it('unmatch throws CONFLICT when transaction is not matched', async () => {
    // txnInId was just unmatched above — should throw.
    await expect(unmatch(ctx, txnInId)).rejects.toSatisfy(
      (e: unknown) => e instanceof ServiceError && e.code === 'CONFLICT',
    );
  });

  // -------------------------------------------------------------------------
  // bulkApplyRules + categorizeSuggested
  // -------------------------------------------------------------------------

  it('bulkApplyRules sets suggestedAccountId via rule, then categorizeSuggested posts it', async () => {
    // Re-seed a fresh unmatched transaction and a rule that matches it.
    const [txnExtra] = await db
      .insert(bankTransactions)
      .values({
        companyId: ctx.companyId,
        bankAccountId,
        date: new Date('2025-03-10'),
        description: 'amazon prime',
        amount: '-14.99',
        matched: false,
      })
      .returning();

    // Create a rule: description contains "amazon" → expense account.
    await createRule(ctx, {
      name: 'Amazon → Expense',
      matchField: 'description',
      matchOperator: 'contains',
      matchValue: 'amazon',
      setAccountId: expenseId,
      priority: 5,
    });

    // Apply rules — should update suggestedAccountId on our new txn.
    const updatedCount = await bulkApplyRules(ctx, bankAccountId);
    expect(updatedCount).toBeGreaterThanOrEqual(1);

    const [suggested] = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, txnExtra.id));
    expect(suggested.suggestedAccountId).toBe(expenseId);
    expect(suggested.matched).toBe(false);

    // categorizeSuggested should post it.
    const posted = await categorizeSuggested(ctx, bankAccountId);
    expect(posted).toBeGreaterThanOrEqual(1);

    const [now] = await db
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, txnExtra.id));
    expect(now.matched).toBe(true);
    expect(now.matchedEntryId).toBeTruthy();

    // Trial balance still balanced.
    const tb = await trialBalance(ctx);
    expect(Math.abs(parseFloat(tb.totalDebit) - parseFloat(tb.totalCredit))).toBeLessThan(0.005);
  });
});
