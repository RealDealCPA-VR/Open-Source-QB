/**
 * Integration tests for expenses.ts (Write Checks / direct expenses / CC charges).
 *
 * Boot pattern mirrors billPayments.test.ts:
 *  - Throwaway PGlite dir under .bookkeeper-data/test-expenses
 *  - Seed user + company + accounts + vendor
 *  - Exercise check/cash/credit-card paths, the print queue, and void.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import {
  users,
  companies,
  accounts,
  vendors,
  expenseLines,
  journalEntries,
  journalEntryLines,
} from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { trialBalance } from './reports';
import {
  createExpense,
  getExpense,
  listExpenses,
  listPrintQueue,
  markExpensePrinted,
  voidExpense,
} from './expenses';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-expenses');
let ctx: ServiceContext;
let db: DB;

const acct: Record<string, string> = {};
let vendorId: string;

async function balanceOf(accountId: string): Promise<string> {
  const [row] = await db
    .select({ balance: accounts.balance })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  return row.balance;
}

describe('Expenses (Write Checks / CC charges) — end-to-end', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'exp-test@bookkeeper.local', name: 'Expense Tester', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Expense Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['2100', 'Visa Card', 'liability', 'credit_card'],
      ['5000', 'Office Supplies Expense', 'expense', 'operating_expenses'],
      ['5100', 'Travel Expense', 'expense', 'operating_expenses'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }

    const [v] = await db
      .insert(vendors)
      .values({ companyId: company.id, displayName: 'Office Depot' })
      .returning();
    vendorId = v.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ── Write Checks (method=check) ───────────────────────────────────────────

  it('creates a multi-line check: Dr expense lines / Cr bank, with sourceRef', async () => {
    const before = await balanceOf(acct['1000']);

    const expense = await createExpense(ctx, {
      vendorId,
      date: new Date('2025-05-01'),
      method: 'check',
      reference: '2001',
      paymentAccountId: acct['1000'],
      memo: 'Supplies + travel',
      lines: [
        { accountId: acct['5000'], description: 'Paper', amount: '120.50' },
        { accountId: acct['5100'], description: 'Mileage', amount: '79.50' },
      ],
    });

    expect(expense.total).toBe('200.00');
    expect(expense.reference).toBe('2001');
    expect(expense.payeeName).toBe('Office Depot');
    expect(expense.postedEntryId).toBeTruthy();
    expect(expense.toPrint).toBe(false);

    // Journal entry: posted, linked via sourceRef
    const [entry] = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, expense.postedEntryId!));
    expect(entry.status).toBe('posted');
    expect(entry.sourceRef).toBe(`expense:${expense.id}`);
    expect(entry.reference).toBe('2001');

    // GL lines: two debits + one credit of 200 to checking
    const glLines = await db
      .select()
      .from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, entry.id));
    expect(glLines).toHaveLength(3);
    const credit = glLines.find((l) => l.accountId === acct['1000']);
    expect(credit?.credit).toBe('200.00');

    // Expense lines persisted in order
    const lines = await db
      .select()
      .from(expenseLines)
      .where(eq(expenseLines.expenseId, expense.id));
    expect(lines).toHaveLength(2);

    // Bank balance decreased by 200
    const after = await balanceOf(acct['1000']);
    expect(Number(after)).toBeCloseTo(Number(before) - 200, 2);

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('auto-assigns the next check number when reference is omitted', async () => {
    const expense = await createExpense(ctx, {
      payeeName: 'Corner Cafe',
      date: new Date('2025-05-02'),
      method: 'check',
      paymentAccountId: acct['1000'],
      lines: [{ accountId: acct['5000'], amount: '15.00' }],
    });
    // '2001' exists from the prior test → next is 2002
    expect(expense.reference).toBe('2002');
    expect(expense.payeeName).toBe('Corner Cafe');
  });

  // ── Print queue ───────────────────────────────────────────────────────────

  it('queues a to-print check (no number) and stamps it via markExpensePrinted', async () => {
    const queued = await createExpense(ctx, {
      vendorId,
      date: new Date('2025-05-03'),
      method: 'check',
      reference: '9999', // ignored: to-print checks get numbered at print time
      toPrint: true,
      paymentAccountId: acct['1000'],
      lines: [{ accountId: acct['5100'], amount: '50.00' }],
    });
    expect(queued.toPrint).toBe(true);
    expect(queued.reference).toBeNull();

    const queue = await listPrintQueue(ctx);
    expect(queue.map((e) => e.id)).toContain(queued.id);

    const printed = await markExpensePrinted(ctx, { expenseId: queued.id });
    expect(printed.toPrint).toBe(false);
    expect(printed.reference).toBe('2003'); // 2001, 2002 already used

    // The journal entry reference picked up the stamped number
    const [entry] = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, queued.postedEntryId!));
    expect(entry.reference).toBe('2003');

    // Queue is now empty of this check
    const queueAfter = await listPrintQueue(ctx);
    expect(queueAfter.map((e) => e.id)).not.toContain(queued.id);

    // Cannot print twice
    await expect(
      markExpensePrinted(ctx, { expenseId: queued.id }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  // ── Credit card charge / credit ───────────────────────────────────────────

  it('records a credit card charge: Dr expense / Cr CC liability', async () => {
    const before = await balanceOf(acct['2100']);

    const charge = await createExpense(ctx, {
      vendorId,
      date: new Date('2025-05-04'),
      method: 'credit_card',
      paymentAccountId: acct['2100'],
      lines: [{ accountId: acct['5100'], description: 'Hotel', amount: '300.00' }],
    });
    expect(charge.total).toBe('300.00');

    // CC liability (credit-normal) increased by 300
    const after = await balanceOf(acct['2100']);
    expect(Number(after)).toBeCloseTo(Number(before) + 300, 2);

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('records a credit card credit via the refund flag: Dr CC liability / Cr expense', async () => {
    const before = await balanceOf(acct['2100']);

    const credit = await createExpense(ctx, {
      vendorId,
      date: new Date('2025-05-05'),
      method: 'credit_card',
      isRefund: true,
      paymentAccountId: acct['2100'],
      lines: [{ accountId: acct['5100'], description: 'Hotel refund', amount: '80.00' }],
    });
    expect(credit.total).toBe('-80.00'); // stored negative = credit

    const after = await balanceOf(acct['2100']);
    expect(Number(after)).toBeCloseTo(Number(before) - 80, 2);

    // GL: debit on the CC account
    const glLines = await db
      .select()
      .from(journalEntryLines)
      .where(eq(journalEntryLines.journalEntryId, credit.postedEntryId!));
    const ccLine = glLines.find((l) => l.accountId === acct['2100']);
    expect(ccLine?.debit).toBe('80.00');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('treats a negative line total as a credit card credit', async () => {
    const before = await balanceOf(acct['2100']);
    const credit = await createExpense(ctx, {
      payeeName: 'Airline Refund',
      date: new Date('2025-05-06'),
      method: 'credit_card',
      paymentAccountId: acct['2100'],
      lines: [{ accountId: acct['5100'], amount: '-25.00' }],
    });
    expect(credit.total).toBe('-25.00');
    const after = await balanceOf(acct['2100']);
    expect(Number(after)).toBeCloseTo(Number(before) - 25, 2);
  });

  // ── Validation guards ─────────────────────────────────────────────────────

  it('rejects a credit card charge against a bank account', async () => {
    await expect(
      createExpense(ctx, {
        vendorId,
        date: new Date('2025-05-07'),
        method: 'credit_card',
        paymentAccountId: acct['1000'],
        lines: [{ accountId: acct['5000'], amount: '10.00' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a check drawn on a credit-card account', async () => {
    await expect(
      createExpense(ctx, {
        vendorId,
        date: new Date('2025-05-07'),
        method: 'check',
        paymentAccountId: acct['2100'],
        lines: [{ accountId: acct['5000'], amount: '10.00' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a refund on a non-credit-card method', async () => {
    await expect(
      createExpense(ctx, {
        vendorId,
        date: new Date('2025-05-07'),
        method: 'check',
        isRefund: true,
        paymentAccountId: acct['1000'],
        lines: [{ accountId: acct['5000'], amount: '10.00' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects mixed-sign lines, zero lines, empty lines, and a missing payee', async () => {
    await expect(
      createExpense(ctx, {
        vendorId,
        date: new Date('2025-05-07'),
        method: 'credit_card',
        paymentAccountId: acct['2100'],
        lines: [
          { accountId: acct['5000'], amount: '10.00' },
          { accountId: acct['5100'], amount: '-5.00' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await expect(
      createExpense(ctx, {
        vendorId,
        date: new Date('2025-05-07'),
        method: 'check',
        paymentAccountId: acct['1000'],
        lines: [{ accountId: acct['5000'], amount: '0' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await expect(
      createExpense(ctx, {
        vendorId,
        date: new Date('2025-05-07'),
        method: 'check',
        paymentAccountId: acct['1000'],
        lines: [],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await expect(
      createExpense(ctx, {
        date: new Date('2025-05-07'),
        method: 'check',
        paymentAccountId: acct['1000'],
        lines: [{ accountId: acct['5000'], amount: '10.00' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a line that posts to the payment account itself', async () => {
    await expect(
      createExpense(ctx, {
        vendorId,
        date: new Date('2025-05-07'),
        method: 'check',
        paymentAccountId: acct['1000'],
        lines: [{ accountId: acct['1000'], amount: '10.00' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // ── getExpense / listExpenses ─────────────────────────────────────────────

  it('getExpense returns the expense with its lines', async () => {
    const created = await createExpense(ctx, {
      vendorId,
      date: new Date('2025-05-08'),
      method: 'cash',
      paymentAccountId: acct['1000'],
      lines: [
        { accountId: acct['5000'], description: 'Stamps', amount: '12.00' },
        { accountId: acct['5100'], description: 'Parking', amount: '8.00' },
      ],
    });
    const fetched = await getExpense(ctx, created.id);
    expect(fetched.id).toBe(created.id);
    expect(fetched.lines).toHaveLength(2);
    expect(fetched.lines[0].description).toBe('Stamps');
  });

  it('listExpenses scopes to company and filters by method and vendor', async () => {
    const all = await listExpenses(ctx);
    expect(all.length).toBeGreaterThanOrEqual(6);
    for (const e of all) expect(e.companyId).toBe(ctx.companyId);

    const ccOnly = await listExpenses(ctx, { method: 'credit_card' });
    expect(ccOnly.length).toBeGreaterThanOrEqual(3);
    for (const e of ccOnly) expect(e.method).toBe('credit_card');

    const byVendor = await listExpenses(ctx, { vendorId });
    for (const e of byVendor) expect(e.vendorId).toBe(vendorId);
    // joined vendor name comes back
    expect(byVendor[0].vendorName).toBe('Office Depot');
  });

  // ── voidExpense ───────────────────────────────────────────────────────────

  it('voids an expense: reverses the GL impact and excludes it from listings', async () => {
    const bankBefore = await balanceOf(acct['1000']);

    const expense = await createExpense(ctx, {
      vendorId,
      date: new Date('2025-05-09'),
      method: 'check',
      paymentAccountId: acct['1000'],
      lines: [{ accountId: acct['5000'], amount: '60.00' }],
    });
    const bankMid = await balanceOf(acct['1000']);
    expect(Number(bankMid)).toBeCloseTo(Number(bankBefore) - 60, 2);

    const voided = await voidExpense(ctx, expense.id);
    expect(voided.voidedAt).toBeTruthy();

    // Bank balance restored
    const bankAfter = await balanceOf(acct['1000']);
    expect(Number(bankAfter)).toBeCloseTo(Number(bankBefore), 2);

    // Journal entry marked void
    const [entry] = await db
      .select()
      .from(journalEntries)
      .where(
        and(eq(journalEntries.id, expense.postedEntryId!), eq(journalEntries.companyId, ctx.companyId)),
      );
    expect(entry.status).toBe('void');

    // Excluded from default listing, included with includeVoided
    const active = await listExpenses(ctx);
    expect(active.map((e) => e.id)).not.toContain(expense.id);
    const withVoided = await listExpenses(ctx, { includeVoided: true });
    expect(withVoided.map((e) => e.id)).toContain(expense.id);

    // Voiding twice conflicts
    await expect(voidExpense(ctx, expense.id)).rejects.toMatchObject({ code: 'CONFLICT' });

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });
});
