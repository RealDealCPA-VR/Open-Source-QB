/**
 * Regression tests for the banking fix package:
 *
 *  1. Credit-card (liability) reconciliation math is account-type aware — a normal
 *     positive statement balance reconciles, including the second-session opening seed.
 *  2. Reconciled lines cannot be voided (posting.ts guard) — directly or via
 *     bankCategorize.unmatch.
 *  3. OFX parser handles OFX 2.x XML (pretty-printed and single-line) and
 *     single-line SGML files.
 *  4. Categorization rule setPayee is applied on import and by applyRulesToAccount.
 *  5. bankCategorize.categorize is atomic — a failure after GL posting rolls back
 *     the entry and leaves the staging row unmatched (no duplicate-post window).
 *  6. Deposit GL entries get a real `deposit:<id>` sourceRef (not 'deposit:pending').
 *  7. An in-progress reconciliation can be cancelled and its statement balance corrected.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { and, eq, like } from 'drizzle-orm';
import { getDb, closeDb, type DB } from '@/lib/db';
import {
  users,
  companies,
  accounts,
  bankAccounts,
  bankTransactions,
  customers,
  journalEntries,
  paymentsReceived,
  reconciliations,
} from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';
import { postJournalEntry, voidJournalEntry } from './posting';
import {
  startReconciliation,
  listClearable,
  toggleCleared,
  getProgress,
  completeReconciliation,
  cancelReconciliation,
  updateStatement,
} from './reconcile';
import { categorize, unmatch } from './bankCategorize';
import { createRule, applyRulesToAccount, matchRule } from './rules';
import { parseOFX, importTransactions } from './import';
import { createDeposit } from './deposits';

// ---------------------------------------------------------------------------
// Fault injection: writeAudit can be told to fail for one entityType so we can
// prove categorize() is atomic (GL post + matched flag commit or roll back together).
// ---------------------------------------------------------------------------

const auditFail = vi.hoisted(() => ({ entityType: null as string | null }));

vi.mock('./_base', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./_base')>();
  return {
    ...mod,
    writeAudit: async (ctx: unknown, params: { entityType: string }) => {
      if (auditFail.entityType && params.entityType === auditFail.entityType) {
        throw new Error('Injected audit failure');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return mod.writeAudit(ctx as any, params as any);
    },
  };
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-fixes-banking');

let ctx: ServiceContext;
let db: DB;

// GL accounts
let checkingGlId: string; // 1000 asset
let ufId: string; // 1050 asset (Undeposited Funds)
let ccGlId: string; // 2100 liability (credit card)
let revenueId: string; // 4000
let expenseId: string; // 6000

async function newBankAccount(glAccountId: string, label: string): Promise<string> {
  const [ba] = await db
    .insert(bankAccounts)
    .values({
      companyId: ctx.companyId,
      accountId: glAccountId,
      bankName: label,
      accountNumber: '****0000',
    })
    .returning();
  return ba.id;
}

/** Create a dedicated GL asset account so reconciliation flows don't interfere. */
async function newGlAsset(code: string, name: string): Promise<string> {
  const [row] = await db
    .insert(accounts)
    .values({ companyId: ctx.companyId, code, name, type: 'asset', subtype: 'checking' })
    .returning();
  return row.id;
}

describe('Banking fix package', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'fixes-banking@test.local', name: 'Fix Tester', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Banking Fixes Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['1050', 'Undeposited Funds', 'asset', 'checking'],
      ['2100', 'Credit Card', 'liability', 'credit_card'],
      ['3000', 'Owner Equity', 'equity', 'owners_equity'],
      ['4000', 'Sales Revenue', 'revenue', 'sales'],
      ['6000', 'Office Expense', 'expense', 'operating_expenses'],
    ];
    const ids: Record<string, string> = {};
    for (const [code, name, type, subtype] of defs) {
      const [row] = await db
        .insert(accounts)
        .values({ companyId: company.id, code, name, type: type as never, subtype: subtype as never })
        .returning();
      ids[code] = row.id;
    }
    checkingGlId = ids['1000'];
    ufId = ids['1050'];
    ccGlId = ids['2100'];
    revenueId = ids['4000'];
    expenseId = ids['6000'];
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. OFX parser — OFX 2.x XML and single-line files
  // -------------------------------------------------------------------------

  describe('OFX parser (2.x XML + single-line)', () => {
    const assertTxn = (txns: ReturnType<typeof parseOFX>) => {
      expect(txns).toHaveLength(1);
      const t = txns[0];
      expect(t.description).toBe('ACME');
      expect(t.amount).toBe('-42.50');
      expect(t.fitId).toBe('TXN001');
      expect(t.date.toISOString().slice(0, 10)).toBe('2024-01-15');
    };

    it('parses pretty-printed OFX 2.x XML with closing tags on the same line', () => {
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<?OFX OFXHEADER="200" VERSION="202" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>',
        '<OFX>',
        '  <BANKMSGSRSV1>',
        '    <STMTTRNRS>',
        '      <STMTRS>',
        '        <BANKTRANLIST>',
        '          <STMTTRN>',
        '            <TRNTYPE>DEBIT</TRNTYPE>',
        '            <DTPOSTED>20240115</DTPOSTED>',
        '            <TRNAMT>-42.50</TRNAMT>',
        '            <FITID>TXN001</FITID>',
        '            <NAME>ACME</NAME>',
        '          </STMTTRN>',
        '        </BANKTRANLIST>',
        '      </STMTRS>',
        '    </STMTTRNRS>',
        '  </BANKMSGSRSV1>',
        '</OFX>',
      ].join('\n');
      assertTxn(parseOFX(xml));
    });

    it('parses a fully single-line SGML file', () => {
      const sgml =
        'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n\n' +
        '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>' +
        '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20240115<TRNAMT>-42.50<FITID>TXN001<NAME>ACME</STMTTRN>' +
        '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
      assertTxn(parseOFX(sgml));
    });

    it('parses a fully single-line OFX 2.x XML file', () => {
      const xml =
        '<?xml version="1.0"?><?OFX OFXHEADER="200" VERSION="202"?>' +
        '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>' +
        '<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240115</DTPOSTED>' +
        '<TRNAMT>-42.50</TRNAMT><FITID>TXN001</FITID><NAME>ACME</NAME></STMTTRN>' +
        '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
      assertTxn(parseOFX(xml));
    });

    it('still parses classic multi-line SGML (no regression)', () => {
      const sgml = [
        'OFXHEADER:100',
        '',
        '<OFX>',
        '<BANKMSGSRSV1>',
        '<STMTTRNRS>',
        '<STMTRS>',
        '<BANKTRANLIST>',
        '<STMTTRN>',
        '<TRNTYPE>DEBIT',
        '<DTPOSTED>20240115',
        '<TRNAMT>-42.50',
        '<FITID>TXN001',
        '<NAME>ACME',
        '</STMTTRN>',
        '</BANKTRANLIST>',
        '</STMTRS>',
        '</STMTTRNRS>',
        '</BANKMSGSRSV1>',
        '</OFX>',
      ].join('\n');
      assertTxn(parseOFX(sgml));
    });
  });

  // -------------------------------------------------------------------------
  // 2. Credit-card (liability) reconciliation
  // -------------------------------------------------------------------------

  describe('credit-card reconciliation (liability GL account)', () => {
    let ccBankAcctId: string;

    it('reconciles against a positive statement balance (amount owed)', async () => {
      ccBankAcctId = await newBankAccount(ccGlId, 'CC Bank');

      // Charge $200 on the card: Dr expense / Cr credit-card liability.
      await postJournalEntry(ctx, {
        date: new Date('2025-04-10'),
        description: 'Card charge — office supplies',
        lines: [
          { accountId: expenseId, debit: '200.00' },
          { accountId: ccGlId, credit: '200.00' },
        ],
      });

      const recon = await startReconciliation(ctx, {
        bankAccountId: ccBankAcctId,
        statementDate: new Date('2025-04-30'),
        statementBalance: '200.00', // positive = amount owed, as printed on the statement
      });

      const lines = await listClearable(ctx, ccBankAcctId, new Date('2025-04-30'), recon.id);
      expect(lines).toHaveLength(1);
      await toggleCleared(ctx, recon.id, lines[0].journalEntryLineId, true);

      const progress = await getProgress(ctx, recon.id);
      expect(progress.clearedBalance).toBe('200.00');
      expect(progress.difference).toBe('0.00');

      const completed = await completeReconciliation(ctx, recon.id);
      expect(completed.status).toBe('completed');
    });

    it('seeds the next session opening from lastReconciledBalance in statement terms', async () => {
      // New charge $50 and a $30 payment toward the card (Dr liability / Cr checking).
      await postJournalEntry(ctx, {
        date: new Date('2025-05-05'),
        description: 'Card charge — software',
        lines: [
          { accountId: expenseId, debit: '50.00' },
          { accountId: ccGlId, credit: '50.00' },
        ],
      });
      await postJournalEntry(ctx, {
        date: new Date('2025-05-10'),
        description: 'Card payment',
        lines: [
          { accountId: ccGlId, debit: '30.00' },
          { accountId: checkingGlId, credit: '30.00' },
        ],
      });

      // Statement: 200 owed + 50 charge − 30 payment = 220 owed.
      const recon = await startReconciliation(ctx, {
        bankAccountId: ccBankAcctId,
        statementDate: new Date('2025-05-31'),
        statementBalance: '220.00',
      });

      const lines = await listClearable(ctx, ccBankAcctId, new Date('2025-05-31'), recon.id);
      // The line cleared in the completed April session must NOT reappear.
      expect(lines).toHaveLength(2);
      for (const l of lines) {
        await toggleCleared(ctx, recon.id, l.journalEntryLineId, true);
      }

      const progress = await getProgress(ctx, recon.id);
      expect(progress.clearedBalance).toBe('220.00');
      expect(progress.difference).toBe('0.00');
      await completeReconciliation(ctx, recon.id);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Void guard for reconciled lines + transactional unmatch
  // -------------------------------------------------------------------------

  describe('reconciled-void guard', () => {
    let guardGlId: string;
    let guardBankAcctId: string;
    let guardEntryId: string;
    let stagedTxnId: string;
    let matchedEntryId: string;

    it('blocks voiding an entry whose line was cleared in a completed reconciliation', async () => {
      guardGlId = await newGlAsset('1010', 'Guard Checking');
      guardBankAcctId = await newBankAccount(guardGlId, 'Guard Bank');

      const entry = await postJournalEntry(ctx, {
        date: new Date('2025-06-01'),
        description: 'Sale deposited to checking',
        lines: [
          { accountId: guardGlId, debit: '100.00' },
          { accountId: revenueId, credit: '100.00' },
        ],
      });
      guardEntryId = entry.id;

      // Stage + categorize a second txn so we can test unmatch below.
      const [staged] = await db
        .insert(bankTransactions)
        .values({
          companyId: ctx.companyId,
          bankAccountId: guardBankAcctId,
          date: new Date('2025-06-02'),
          description: 'Card reader payout',
          amount: '300.00',
          matched: false,
        })
        .returning();
      stagedTxnId = staged.id;
      const { entry: catEntry } = await categorize(ctx, {
        bankTransactionId: stagedTxnId,
        accountId: revenueId,
      });
      matchedEntryId = catEntry.id;

      // Dedicated GL account: only the $100 sale and the $300 categorized payout
      // sit on it. Opening is 0 (first session), so the statement is 400.00.
      const recon = await startReconciliation(ctx, {
        bankAccountId: guardBankAcctId,
        statementDate: new Date('2025-06-30'),
        statementBalance: '400.00',
      });
      const lines = await listClearable(ctx, guardBankAcctId, new Date('2025-06-30'), recon.id);
      expect(lines).toHaveLength(2);
      for (const l of lines) await toggleCleared(ctx, recon.id, l.journalEntryLineId, true);
      const progress = await getProgress(ctx, recon.id);
      expect(progress.difference).toBe('0.00');
      await completeReconciliation(ctx, recon.id);

      // Direct void must now be blocked.
      await expect(voidJournalEntry(ctx, guardEntryId)).rejects.toMatchObject({
        code: 'CONFLICT',
      });

      // Entry is still posted.
      const [after] = await db
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.id, guardEntryId));
      expect(after.status).toBe('posted');
    });

    it('blocks bankCategorize.unmatch for a reconciled match and leaves no partial state', async () => {
      await expect(unmatch(ctx, stagedTxnId)).rejects.toMatchObject({ code: 'CONFLICT' });

      // Transactional: the matched flag must NOT have been cleared and the entry
      // must still be posted.
      const [txn] = await db
        .select()
        .from(bankTransactions)
        .where(eq(bankTransactions.id, stagedTxnId));
      expect(txn.matched).toBe(true);
      expect(txn.matchedEntryId).toBe(matchedEntryId);

      const [entry] = await db
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.id, matchedEntryId));
      expect(entry.status).toBe('posted');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Atomic categorize — failure after GL post rolls everything back
  // -------------------------------------------------------------------------

  describe('categorize atomicity', () => {
    it('rolls back the GL entry when the post-posting step fails', async () => {
      const atomicBankAcctId = await newBankAccount(checkingGlId, 'Atomic Bank');
      const [staged] = await db
        .insert(bankTransactions)
        .values({
          companyId: ctx.companyId,
          bankAccountId: atomicBankAcctId,
          date: new Date('2025-07-01'),
          description: 'Atomicity probe',
          amount: '-75.00',
          matched: false,
        })
        .returning();

      const [checkingBefore] = await db
        .select({ balance: accounts.balance })
        .from(accounts)
        .where(eq(accounts.id, checkingGlId));

      // Fail the bank_transaction audit write — this happens AFTER postJournalEntry
      // and AFTER the matched-flag update inside categorize's transaction.
      auditFail.entityType = 'bank_transaction';
      try {
        await expect(
          categorize(ctx, { bankTransactionId: staged.id, accountId: expenseId }),
        ).rejects.toThrow('Injected audit failure');
      } finally {
        auditFail.entityType = null;
      }

      // No orphan GL entry…
      const orphans = await db
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ctx.companyId),
            eq(journalEntries.sourceRef, `bank_transaction:${staged.id}`),
          ),
        );
      expect(orphans).toHaveLength(0);

      // …the staging row is still unmatched…
      const [txn] = await db
        .select()
        .from(bankTransactions)
        .where(eq(bankTransactions.id, staged.id));
      expect(txn.matched).toBe(false);
      expect(txn.matchedEntryId).toBeNull();

      // …and the cached balance did not move.
      const [checkingAfter] = await db
        .select({ balance: accounts.balance })
        .from(accounts)
        .where(eq(accounts.id, checkingGlId));
      expect(checkingAfter.balance).toBe(checkingBefore.balance);

      // Retrying after the transient failure works exactly once.
      const result = await categorize(ctx, {
        bankTransactionId: staged.id,
        accountId: expenseId,
      });
      expect(result.transaction.matched).toBe(true);
      await expect(
        categorize(ctx, { bankTransactionId: staged.id, accountId: expenseId }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  // -------------------------------------------------------------------------
  // 5. setPayee rule application
  // -------------------------------------------------------------------------

  describe("rule 'setPayee'", () => {
    let payeeBankAcctId: string;

    it('matchRule returns both setAccountId and setPayee', async () => {
      payeeBankAcctId = await newBankAccount(checkingGlId, 'Payee Bank');
      await createRule(ctx, {
        name: 'Netflix rule',
        matchField: 'description',
        matchOperator: 'contains',
        matchValue: 'NETFLIX',
        setAccountId: expenseId,
        setPayee: 'Netflix',
      });

      const match = await matchRule(ctx, {
        description: 'NETFLIX.COM 866-579-7172',
        payee: null,
        amount: '-15.49',
      });
      expect(match).toEqual({ setAccountId: expenseId, setPayee: 'Netflix' });
    });

    it('writes the payee onto staged rows during import', async () => {
      const csv = 'Date,Description,Amount\n2025-07-03,NETFLIX.COM 866-579-7172,-15.49\n';
      const summary = await importTransactions(ctx, {
        bankAccountId: payeeBankAcctId,
        fileType: 'csv',
        content: csv,
        csvMapping: { dateCol: 'Date', descriptionCol: 'Description', amountCol: 'Amount' },
      });
      expect(summary.imported).toBe(1);

      const [row] = await db
        .select()
        .from(bankTransactions)
        .where(
          and(
            eq(bankTransactions.bankAccountId, payeeBankAcctId),
            like(bankTransactions.description, '%NETFLIX%'),
          ),
        );
      expect(row.payee).toBe('Netflix');
      expect(row.suggestedAccountId).toBe(expenseId);
    });

    it('applyRulesToAccount backfills payee on already-staged rows', async () => {
      const [staged] = await db
        .insert(bankTransactions)
        .values({
          companyId: ctx.companyId,
          bankAccountId: payeeBankAcctId,
          date: new Date('2025-07-04'),
          description: 'NETFLIX subscription renewal',
          amount: '-15.49',
          matched: false,
        })
        .returning();

      const updated = await applyRulesToAccount(ctx, payeeBankAcctId);
      expect(updated).toBeGreaterThanOrEqual(1);

      const [row] = await db
        .select()
        .from(bankTransactions)
        .where(eq(bankTransactions.id, staged.id));
      expect(row.payee).toBe('Netflix');
      expect(row.suggestedAccountId).toBe(expenseId);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Deposit sourceRef backfill
  // -------------------------------------------------------------------------

  describe('deposit sourceRef', () => {
    it("stamps the GL entry with deposit:<id> instead of 'deposit:pending'", async () => {
      const [customer] = await db
        .insert(customers)
        .values({ companyId: ctx.companyId, displayName: 'Deposit Customer' })
        .returning();

      const [payment] = await db
        .insert(paymentsReceived)
        .values({
          companyId: ctx.companyId,
          customerId: customer.id,
          date: new Date('2025-07-10'),
          amount: '500.00',
          depositAccountId: ufId,
        })
        .returning();

      const deposit = await createDeposit(ctx, {
        depositAccountId: checkingGlId,
        date: new Date('2025-07-11'),
        paymentIds: [payment.id],
      });

      const [entry] = await db
        .select()
        .from(journalEntries)
        .where(eq(journalEntries.id, deposit.postedEntryId!));
      expect(entry.sourceRef).toBe(`deposit:${deposit.id}`);

      const pending = await db
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ctx.companyId),
            eq(journalEntries.sourceRef, 'deposit:pending'),
          ),
        );
      expect(pending).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Cancel + correct an in-progress reconciliation
  // -------------------------------------------------------------------------

  describe('cancel / correct reconciliation', () => {
    let cancelBankAcctId: string;
    let lineId: string;

    it('updateStatement corrects a mistyped statement balance while in progress', async () => {
      const cancelGlId = await newGlAsset('1020', 'Cancel Checking');
      cancelBankAcctId = await newBankAccount(cancelGlId, 'Cancel Bank');

      await postJournalEntry(ctx, {
        date: new Date('2025-08-01'),
        description: 'Deposit for cancel test',
        lines: [
          { accountId: cancelGlId, debit: '40.00' },
          { accountId: revenueId, credit: '40.00' },
        ],
      });

      // Mistyped statement balance.
      const recon = await startReconciliation(ctx, {
        bankAccountId: cancelBankAcctId,
        statementDate: new Date('2025-08-31'),
        statementBalance: '999.00',
      });

      const updated = await updateStatement(ctx, recon.id, { statementBalance: '40.00' });
      expect(updated.statementBalance).toBe('40.00');

      const progress = await getProgress(ctx, recon.id);
      expect(progress.statementBalance).toBe('40.00');

      // Toggle a line so cancel has session items to discard.
      const lines = await listClearable(ctx, cancelBankAcctId, new Date('2025-08-31'), recon.id);
      expect(lines).toHaveLength(1);
      lineId = lines[0].journalEntryLineId;
      await toggleCleared(ctx, recon.id, lineId, true);

      // Cancel the session entirely.
      await cancelReconciliation(ctx, recon.id);
      const [gone] = await db
        .select()
        .from(reconciliations)
        .where(eq(reconciliations.id, recon.id));
      expect(gone).toBeUndefined();
    });

    it('after cancel, a new session can start and the cleared toggle did not persist', async () => {
      const recon2 = await startReconciliation(ctx, {
        bankAccountId: cancelBankAcctId,
        statementDate: new Date('2025-08-31'),
        statementBalance: '40.00',
      });

      const lines = await listClearable(ctx, cancelBankAcctId, new Date('2025-08-31'), recon2.id);
      const line = lines.find((l) => l.journalEntryLineId === lineId);
      expect(line).toBeDefined();
      expect(line!.isCleared).toBe(false);

      // A completed reconciliation cannot be cancelled.
      for (const l of lines) await toggleCleared(ctx, recon2.id, l.journalEntryLineId, true);
      const progress = await getProgress(ctx, recon2.id);
      expect(progress.difference).toBe('0.00');
      await completeReconciliation(ctx, recon2.id);

      await expect(cancelReconciliation(ctx, recon2.id)).rejects.toBeInstanceOf(ServiceError);
      await expect(updateStatement(ctx, recon2.id, { statementBalance: '1.00' })).rejects.toBeInstanceOf(
        ServiceError,
      );
    });
  });
});
