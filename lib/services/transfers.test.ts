import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, sum } from 'drizzle-orm';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts, journalEntries, journalEntryLines } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';
import { createAccount } from './accounts';
import { createTransfer, listTransfers } from './transfers';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-transfers');
let ctx: ServiceContext;
let db: DB;
const acct: Record<string, string> = {};

describe('Transfers service (end-to-end)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'owner@transfer.test', name: 'Owner', passwordHash: 'x' })
      .returning();

    const [company] = await db
      .insert(companies)
      .values({ name: 'Transfer Test Co', ownerId: user.id })
      .returning();

    ctx = { db, companyId: company.id, userId: user.id };

    // Seed two asset accounts and an equity account (for trial balance).
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['1010', 'Savings', 'asset', 'savings'],
      ['3000', "Owner's Equity", 'equity', 'owners_equity'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  it('rejects when from and to account are the same', async () => {
    await expect(
      createTransfer(ctx, {
        date: new Date('2025-01-01'),
        fromAccountId: acct['1000'],
        toAccountId: acct['1000'],
        amount: '100.00',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a zero amount', async () => {
    await expect(
      createTransfer(ctx, {
        date: new Date('2025-01-01'),
        fromAccountId: acct['1000'],
        toAccountId: acct['1010'],
        amount: '0',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a negative amount', async () => {
    await expect(
      createTransfer(ctx, {
        date: new Date('2025-01-01'),
        fromAccountId: acct['1000'],
        toAccountId: acct['1010'],
        amount: '-50.00',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // -------------------------------------------------------------------------
  // Happy path: transfer $500 Checking -> Savings
  // -------------------------------------------------------------------------

  it('transfers $500 from Checking to Savings and moves balances correctly', async () => {
    const transfer = await createTransfer(ctx, {
      date: new Date('2025-03-01'),
      fromAccountId: acct['1000'],
      toAccountId: acct['1010'],
      amount: '500.00',
      memo: 'Monthly savings move',
    });

    // Returned record is well-formed.
    expect(transfer.companyId).toBe(ctx.companyId);
    expect(transfer.amount).toBe('500.00');
    expect(transfer.fromAccountId).toBe(acct['1000']);
    expect(transfer.toAccountId).toBe(acct['1010']);
    expect(transfer.postedEntryId).toBeTruthy();

    // Cached balances moved correctly.
    const rows = await db.select().from(accounts).where(eq(accounts.companyId, ctx.companyId));
    const bal = Object.fromEntries(rows.map((r) => [r.code, r.balance]));

    // Checking (fromAccount) was credited — asset decreases.
    expect(bal['1000']).toBe('-500.00');
    // Savings (toAccount) was debited — asset increases.
    expect(bal['1010']).toBe('500.00');
    // Equity untouched.
    expect(bal['3000']).toBe('0.00');
  });

  // -------------------------------------------------------------------------
  // Trial balance remains balanced
  // -------------------------------------------------------------------------

  it('trial balance is balanced after the transfer', async () => {
    const allAccts = await db.select().from(accounts).where(eq(accounts.companyId, ctx.companyId));

    // Sum debits and credits from all journal entry lines for this company.
    const entries = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.companyId, ctx.companyId));

    let totalDebit = 0;
    let totalCredit = 0;

    for (const entry of entries) {
      const lines = await db
        .select()
        .from(journalEntryLines)
        .where(eq(journalEntryLines.journalEntryId, entry.id));
      for (const line of lines) {
        totalDebit += parseFloat(line.debit ?? '0');
        totalCredit += parseFloat(line.credit ?? '0');
      }
    }

    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(500);
  });

  // -------------------------------------------------------------------------
  // listTransfers scoped to company
  // -------------------------------------------------------------------------

  it('listTransfers returns the transfer scoped to the company', async () => {
    const list = await listTransfers(ctx);
    expect(list).toHaveLength(1);
    expect(list[0].amount).toBe('500.00');
    expect(list[0].memo).toBe('Monthly savings move');
  });

  // -------------------------------------------------------------------------
  // Second transfer: verify cumulative balances
  // -------------------------------------------------------------------------

  it('applies a second transfer ($200 Savings -> Checking) correctly', async () => {
    await createTransfer(ctx, {
      date: new Date('2025-03-15'),
      fromAccountId: acct['1010'],
      toAccountId: acct['1000'],
      amount: '200.00',
      memo: 'Partial reversal',
    });

    const rows = await db.select().from(accounts).where(eq(accounts.companyId, ctx.companyId));
    const bal = Object.fromEntries(rows.map((r) => [r.code, r.balance]));

    // Net: Checking started 0, received 500 credit then 200 debit => -300
    expect(bal['1000']).toBe('-300.00');
    // Savings: started 0, received 500 debit then 200 credit => 300
    expect(bal['1010']).toBe('300.00');

    const list = await listTransfers(ctx);
    expect(list).toHaveLength(2);

    // Trial balance still balanced (debits == credits).
    const entries = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.companyId, ctx.companyId));

    let totalDebit = 0;
    let totalCredit = 0;
    for (const entry of entries) {
      const lines = await db
        .select()
        .from(journalEntryLines)
        .where(eq(journalEntryLines.journalEntryId, entry.id));
      for (const line of lines) {
        totalDebit += parseFloat(line.debit ?? '0');
        totalCredit += parseFloat(line.credit ?? '0');
      }
    }
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(700); // 500 + 200
  });
});
