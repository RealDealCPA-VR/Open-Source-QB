/**
 * Integration test for the Bank Reconciliation service.
 *
 * Uses an isolated PGlite database (throwaway dir) so it never touches the dev DB.
 * Verifies that:
 *  - startReconciliation opens a session and rejects duplicates.
 *  - listClearable returns posted lines dated <= statementDate.
 *  - toggleCleared marks / un-marks a line; getProgress reflects the change.
 *  - completeReconciliation succeeds when difference ≤ $0.01 and rejects otherwise.
 *  - After completion the trial balance is unaffected (reconciliation is not a GL writer).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts, bankAccounts } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';
import { createAccount } from './accounts';
import { postJournalEntry } from './posting';
import { trialBalance } from './reports';
import {
  startReconciliation,
  listClearable,
  toggleCleared,
  getProgress,
  completeReconciliation,
  listReconciliations,
} from './reconcile';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-reconcile-int');
let ctx: ServiceContext;
let db: DB;

// Account ids
let cashAccountId: string;
let bankAccountId: string; // the bankAccounts row id
let equityAccountId: string;

describe('Reconciliation service (end-to-end)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'owner@reconcile.test', name: 'Owner', passwordHash: 'x' })
      .returning();

    const [company] = await db
      .insert(companies)
      .values({ name: 'Reconcile Test Co', ownerId: user.id })
      .returning();

    ctx = { db, companyId: company.id, userId: user.id };

    // Create minimal COA: a cash account + equity.
    const cashAcct = await createAccount(ctx, {
      code: '1000',
      name: 'Checking',
      type: 'asset',
      subtype: 'checking',
    });
    cashAccountId = cashAcct.id;

    const equityAcct = await createAccount(ctx, {
      code: '3000',
      name: 'Owner Equity',
      type: 'equity',
      subtype: 'owners_equity',
    });
    equityAccountId = equityAcct.id;

    // Create a bankAccounts row linked to the cash GL account.
    const [ba] = await db
      .insert(bankAccounts)
      .values({
        companyId: company.id,
        accountId: cashAccountId,
        bankName: 'First National',
        accountNumber: '****1234',
      })
      .returning();
    bankAccountId = ba.id;

    // Post some transactions:
    //  Jan 1: owner invests $5,000 (debit cash, credit equity)
    //  Jan 5: expense $200 (credit cash, debit equity — simplified)
    //  Jan 15: income $800 (debit cash, credit equity)
    await postJournalEntry(ctx, {
      date: new Date('2025-01-01'),
      description: 'Owner investment',
      lines: [
        { accountId: cashAccountId, debit: '5000.00' },
        { accountId: equityAccountId, credit: '5000.00' },
      ],
    });
    await postJournalEntry(ctx, {
      date: new Date('2025-01-05'),
      description: 'Expense payment',
      lines: [
        { accountId: equityAccountId, debit: '200.00' },
        { accountId: cashAccountId, credit: '200.00' },
      ],
    });
    await postJournalEntry(ctx, {
      date: new Date('2025-01-15'),
      description: 'Customer payment',
      lines: [
        { accountId: cashAccountId, debit: '800.00' },
        { accountId: equityAccountId, credit: '800.00' },
      ],
    });
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  let reconciliationId: string;

  it('starts a reconciliation session', async () => {
    const recon = await startReconciliation(ctx, {
      bankAccountId,
      statementDate: new Date('2025-01-31'),
      statementBalance: '5600.00', // 5000 - 200 + 800
    });
    expect(recon.status).toBe('in_progress');
    expect(recon.bankAccountId).toBe(bankAccountId);
    expect(recon.statementBalance).toBe('5600.00');
    reconciliationId = recon.id;
  });

  it('rejects a duplicate in-progress session for the same bank account', async () => {
    await expect(
      startReconciliation(ctx, {
        bankAccountId,
        statementDate: new Date('2025-01-31'),
        statementBalance: '5600.00',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('listReconciliations returns the session', async () => {
    const rows = await listReconciliations(ctx);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const found = rows.find((r) => r.id === reconciliationId);
    expect(found).toBeDefined();
    expect(found!.bankName).toBe('First National');
  });

  it('listClearable returns posted lines up to statementDate', async () => {
    const lines = await listClearable(
      ctx,
      bankAccountId,
      new Date('2025-01-31'),
      reconciliationId,
    );
    // 3 transactions posted against the cash account
    expect(lines.length).toBe(3);
    // None cleared yet
    expect(lines.every((l) => !l.isCleared)).toBe(true);
  });

  it('getProgress shows full difference before any clearing', async () => {
    const p = await getProgress(ctx, reconciliationId);
    expect(p.statementBalance).toBe('5600.00');
    expect(p.clearedBalance).toBe('0.00');
    expect(p.difference).toBe('5600.00');
  });

  it('completeReconciliation fails when difference != 0', async () => {
    await expect(completeReconciliation(ctx, reconciliationId)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('toggleCleared marks all three lines as cleared', async () => {
    const lines = await listClearable(ctx, bankAccountId, new Date('2025-01-31'), reconciliationId);
    for (const line of lines) {
      await toggleCleared(ctx, reconciliationId, line.journalEntryLineId, true);
    }
    const p = await getProgress(ctx, reconciliationId);
    // clearedBalance = 5000 - 200 + 800 = 5600
    expect(p.clearedBalance).toBe('5600.00');
    expect(p.difference).toBe('0.00');
  });

  it('completeReconciliation succeeds when difference = 0', async () => {
    const completed = await completeReconciliation(ctx, reconciliationId);
    expect(completed.status).toBe('completed');
    expect(completed.reconciledBalance).toBe('5600.00');
    expect(completed.completedAt).toBeTruthy();
  });

  it('trial balance remains balanced after reconciliation', async () => {
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('listClearable for a new session excludes lines cleared in the completed session', async () => {
    // Start a fresh session for the same bank account.
    const recon2 = await startReconciliation(ctx, {
      bankAccountId,
      statementDate: new Date('2025-02-28'),
      statementBalance: '5600.00',
    });
    const lines = await listClearable(
      ctx,
      bankAccountId,
      new Date('2025-02-28'),
      recon2.id,
    );
    // The three January lines were permanently cleared; they should not appear again.
    expect(lines.length).toBe(0);
  });
});
