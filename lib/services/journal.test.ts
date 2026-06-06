/**
 * Integration tests for the Manual Journal Entries + General Ledger service.
 *
 * Boots a throwaway PGlite instance, seeds a user + company + minimal chart of accounts,
 * then exercises createManualEntry, listEntries, getEntry, voidEntry, and generalLedger.
 * Asserts that the trial balance stays balanced after every posting and that the GL
 * running balance accumulates correctly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { trialBalance } from './reports';
import {
  createManualEntry,
  listEntries,
  getEntry,
  voidEntry,
  generalLedger,
} from './journal';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-journal');
let ctx: ServiceContext;
let db: DB;
/** Account id map keyed by chart code. */
const acct: Record<string, string> = {};

describe('Journal Entries + General Ledger', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'jtest@test.local', name: 'JTest', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Journal Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // Seed a minimal chart of accounts (same subtype pattern as the integration test).
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking',           'asset',     'checking'],
      ['1200', 'Accounts Receivable','asset',     'accounts_receivable'],
      ['3000', "Owner's Equity",     'equity',    'owners_equity'],
      ['4000', 'Sales Income',       'revenue',   'sales'],
      ['6000', 'Advertising',        'expense',   'operating_expenses'],
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
  // createManualEntry validation
  // -------------------------------------------------------------------------

  it('rejects an entry with no description', async () => {
    await expect(
      createManualEntry(ctx, {
        date: new Date('2025-01-01'),
        description: '   ',
        lines: [
          { accountId: acct['1000'], debit: '100.00' },
          { accountId: acct['4000'], credit: '100.00' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects an unbalanced entry', async () => {
    await expect(
      createManualEntry(ctx, {
        date: new Date('2025-01-01'),
        description: 'Unbalanced',
        lines: [
          { accountId: acct['1000'], debit: '500.00' },
          { accountId: acct['4000'], credit: '400.00' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'UNBALANCED' });
  });

  // -------------------------------------------------------------------------
  // Post two balanced entries and verify GL running balance
  // -------------------------------------------------------------------------

  let entry1Id: string;
  let entry2Id: string;

  it('posts entry 1 — owner investment $5,000', async () => {
    const entry = await createManualEntry(ctx, {
      date: new Date('2025-03-01'),
      description: 'Owner investment',
      reference: 'OWN-001',
      lines: [
        { accountId: acct['1000'], debit: '5000.00' },
        { accountId: acct['3000'], credit: '5000.00' },
      ],
    });
    entry1Id = entry.id;
    expect(entry.status).toBe('posted');
    expect(entry.entryNumber).toBeGreaterThan(0);
  });

  it('posts entry 2 — ad expense $200 paid from checking', async () => {
    const entry = await createManualEntry(ctx, {
      date: new Date('2025-03-05'),
      description: 'March advertising spend',
      lines: [
        { accountId: acct['6000'], debit: '200.00' },
        { accountId: acct['1000'], credit: '200.00' },
      ],
    });
    entry2Id = entry.id;
    expect(entry.status).toBe('posted');
  });

  it('trial balance is balanced after two entries', async () => {
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  // -------------------------------------------------------------------------
  // generalLedger — running balance assertions
  // -------------------------------------------------------------------------

  it('GL for Checking account shows correct running balances', async () => {
    const gl = await generalLedger(ctx, { accountId: acct['1000'] });
    expect(gl).toHaveLength(1);

    const { lines, closingBalance, accountType } = gl[0];
    // Checking is an asset (debit-normal). Investment debits +5000, expense credit -200.
    expect(accountType).toBe('asset');
    expect(lines).toHaveLength(2);

    // Line 1: debit 5000 → running balance 5000.00
    expect(lines[0].debit).toBe('5000.00');
    expect(lines[0].credit).toBeNull();
    expect(lines[0].runningBalance).toBe('5000.00');

    // Line 2: credit 200 → running balance 4800.00
    expect(lines[1].debit).toBeNull();
    expect(lines[1].credit).toBe('200.00');
    expect(lines[1].runningBalance).toBe('4800.00');

    expect(closingBalance).toBe('4800.00');
  });

  it("GL for Owner's Equity shows correct running balance (credit-normal)", async () => {
    const gl = await generalLedger(ctx, { accountId: acct['3000'] });
    expect(gl).toHaveLength(1);
    const { lines, closingBalance, accountType } = gl[0];

    expect(accountType).toBe('equity');
    expect(lines).toHaveLength(1);
    // Equity is credit-normal: credit 5000 → running +5000
    expect(lines[0].credit).toBe('5000.00');
    expect(lines[0].runningBalance).toBe('5000.00');
    expect(closingBalance).toBe('5000.00');
  });

  it('GL date-range filter excludes entries outside range', async () => {
    // Query only up to 2025-03-02 — should see investment (03-01) but not ad expense (03-05).
    const gl = await generalLedger(ctx, {
      accountId: acct['1000'],
      to: new Date('2025-03-02'),
    });
    expect(gl[0].lines).toHaveLength(1);
    expect(gl[0].lines[0].runningBalance).toBe('5000.00');
    expect(gl[0].closingBalance).toBe('5000.00');
  });

  // -------------------------------------------------------------------------
  // listEntries / getEntry
  // -------------------------------------------------------------------------

  it('listEntries returns both posted entries', async () => {
    const rows = await listEntries(ctx);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(entry1Id);
    expect(ids).toContain(entry2Id);
  });

  it('getEntry returns header + lines with account names', async () => {
    const detail = await getEntry(ctx, entry1Id);
    expect(detail.description).toBe('Owner investment');
    expect(detail.reference).toBe('OWN-001');
    expect(detail.lines).toHaveLength(2);

    const debitLine = detail.lines.find((l) => l.debit !== null);
    const creditLine = detail.lines.find((l) => l.credit !== null);
    expect(debitLine?.accountCode).toBe('1000');
    expect(debitLine?.debit).toBe('5000.00');
    expect(creditLine?.accountCode).toBe('3000');
    expect(creditLine?.credit).toBe('5000.00');
  });

  it('getEntry throws NOT_FOUND for an unknown id', async () => {
    await expect(
      getEntry(ctx, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // voidEntry
  // -------------------------------------------------------------------------

  it('voiding entry 2 reverses balances and GL shows only 1 line', async () => {
    await voidEntry(ctx, entry2Id);

    // Trial balance must still balance after void.
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);

    // GL for Checking should now show only the investment line (ad expense reversed).
    const gl = await generalLedger(ctx, { accountId: acct['1000'] });
    expect(gl[0].lines).toHaveLength(1);
    expect(gl[0].closingBalance).toBe('5000.00');
  });

  it('voiding an already-voided entry is idempotent', async () => {
    // Second void should not throw — posting.ts returns early when already void.
    const result = await voidEntry(ctx, entry2Id);
    expect(result.status).toBe('void');
  });

  it('voidEntry throws NOT_FOUND for unknown id', async () => {
    await expect(
      voidEntry(ctx, '00000000-0000-0000-0000-000000000001'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // generalLedger without accountId filter — returns all accounts
  // -------------------------------------------------------------------------

  it('generalLedger with no accountId returns multiple account registers', async () => {
    const gl = await generalLedger(ctx);
    // Should contain at least the accounts that had activity (1000, 3000).
    const codes = gl.map((g) => g.accountCode);
    expect(codes).toContain('1000');
    expect(codes).toContain('3000');
  });
});
