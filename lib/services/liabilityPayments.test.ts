/**
 * Integration tests for liabilityPayments.ts
 *
 * Boot pattern:
 *  - Spin up a throwaway PGlite dir under .bookkeeper-data/test-liability-payments
 *  - Seed user + company + accounts (1000 Checking, 2200 Sales Tax Payable, 2300 Payroll Liabilities)
 *  - Accrue a tax payable via a balanced JE (e.g. from a sale that collected sales tax)
 *  - Pay part of it via paySalesTax, assert 2200 reduced + trial balance balanced
 *  - Mirror for payroll liabilities
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { postJournalEntry } from './posting';
import { trialBalance } from './reports';
import { createTaxAgency } from './salesTax';
import {
  paySalesTax,
  payPayrollLiabilities,
  salesTaxDue,
  payrollLiabilitiesDue,
} from './liabilityPayments';

const TEST_DIR = path.resolve(
  process.cwd(),
  '.bookkeeper-data',
  'test-liability-payments',
);

let ctx: ServiceContext;
let db: DB;

// Account IDs keyed by code
const acct: Record<string, string> = {};

describe('Liability Payments — end-to-end', () => {
  // ── setup ──────────────────────────────────────────────────────────────────
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'liab-test@bookkeeper.local', name: 'Liab Tester', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Liability Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // Seed chart of accounts
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['2200', 'Sales Tax Payable', 'liability', 'long_term_liability'],
      ['2300', 'Payroll Liabilities', 'liability', 'long_term_liability'],
      ['4000', 'Sales Revenue', 'revenue', 'sales'],
      ['5100', 'Payroll Expense', 'expense', 'payroll'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, {
        code,
        name,
        type: type as never,
        subtype,
      });
      acct[code] = row.id;
    }

    // ── Accrue sales tax payable ──────────────────────────────────────────────
    // Simulate collecting $100 in sales tax from a customer invoice:
    //   Dr Checking 1100  (cash from customer)
    //   Cr Sales Revenue  1000
    //   Cr Sales Tax Payable 100
    await postJournalEntry(ctx, {
      date: new Date('2025-03-01'),
      description: 'Sale with sales tax collected',
      lines: [
        { accountId: acct['1000'], debit: '1100.00' },
        { accountId: acct['4000'], credit: '1000.00' },
        { accountId: acct['2200'], credit: '100.00' },
      ],
    });

    // ── Accrue payroll liabilities ─────────────────────────────────────────────
    // Simulate payroll run: gross pay $2000, taxes withheld $400, net paid $1600:
    //   Dr Payroll Expense 2000
    //   Cr Payroll Liabilities 400  (taxes withheld / employer share)
    //   Cr Checking 1600            (net pay to employees)
    await postJournalEntry(ctx, {
      date: new Date('2025-03-15'),
      description: 'Payroll run — March 2025',
      lines: [
        { accountId: acct['5100'], debit: '2000.00' },
        { accountId: acct['2300'], credit: '400.00' },
        { accountId: acct['1000'], credit: '1600.00' },
      ],
    });
  });

  // ── teardown ────────────────────────────────────────────────────────────────
  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ── salesTaxDue ─────────────────────────────────────────────────────────────

  it('salesTaxDue returns the correct accrued credit balance', async () => {
    const due = await salesTaxDue(ctx);
    expect(due).toBe('100.00');
  });

  // ── payrollLiabilitiesDue ───────────────────────────────────────────────────

  it('payrollLiabilitiesDue returns the correct accrued credit balance', async () => {
    const due = await payrollLiabilitiesDue(ctx);
    expect(due).toBe('400.00');
  });

  // ── paySalesTax validations ─────────────────────────────────────────────────

  it('paySalesTax rejects amount <= 0', async () => {
    await expect(
      paySalesTax(ctx, {
        amount: 0,
        date: new Date('2025-04-01'),
        paymentAccountId: acct['1000'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await expect(
      paySalesTax(ctx, {
        amount: -50,
        date: new Date('2025-04-01'),
        paymentAccountId: acct['1000'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // ── paySalesTax happy path ──────────────────────────────────────────────────

  it('paySalesTax partial payment reduces 2200 and keeps trial balance balanced', async () => {
    // Pay $60 of the $100 owed
    const entry = await paySalesTax(ctx, {
      amount: '60.00',
      date: new Date('2025-04-01'),
      paymentAccountId: acct['1000'],
      memo: 'Q1 sales tax remittance',
    });

    expect(entry).toBeTruthy();
    expect(entry.description).toBe('Q1 sales tax remittance');

    // 2200 should now have a net credit of $40 (100 accrued - 60 paid)
    const remaining = await salesTaxDue(ctx);
    expect(remaining).toBe('40.00');

    // Trial balance must stay balanced after the payment
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('paySalesTax second payment clears remaining 2200 balance', async () => {
    // Pay the remaining $40
    await paySalesTax(ctx, {
      amount: '40.00',
      date: new Date('2025-04-15'),
      paymentAccountId: acct['1000'],
      agencyId: 'agency-abc',
    });

    const remaining = await salesTaxDue(ctx);
    expect(remaining).toBe('0.00');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  // ── payPayrollLiabilities validations ──────────────────────────────────────

  it('payPayrollLiabilities rejects amount <= 0', async () => {
    await expect(
      payPayrollLiabilities(ctx, {
        amount: 0,
        date: new Date('2025-04-20'),
        paymentAccountId: acct['1000'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // ── payPayrollLiabilities happy path ────────────────────────────────────────

  it('payPayrollLiabilities reduces 2300 and keeps trial balance balanced', async () => {
    // Pay $250 of the $400 payroll liabilities
    const entry = await payPayrollLiabilities(ctx, {
      amount: '250.00',
      date: new Date('2025-04-20'),
      paymentAccountId: acct['1000'],
      memo: '941 tax deposit — March',
    });

    expect(entry).toBeTruthy();
    expect(entry.description).toBe('941 tax deposit — March');

    const remaining = await payrollLiabilitiesDue(ctx);
    expect(remaining).toBe('150.00');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('payPayrollLiabilities full clearance zeroes 2300', async () => {
    await payPayrollLiabilities(ctx, {
      amount: '150.00',
      date: new Date('2025-04-25'),
      paymentAccountId: acct['1000'],
    });

    const remaining = await payrollLiabilitiesDue(ctx);
    expect(remaining).toBe('0.00');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  // ── paySalesTax GL memo uses the agency display name, never its UUID ───────

  it('paySalesTax interpolates the agency display name into the description', async () => {
    const agency = await createTaxAgency(ctx, { name: 'CA Dept of Tax & Fee Admin' });

    const entry = await paySalesTax(ctx, {
      amount: '10.00',
      date: new Date('2025-05-01'),
      paymentAccountId: acct['1000'],
      agencyId: agency.id,
    });

    expect(entry.description).toBe('Pay Sales Tax — CA Dept of Tax & Fee Admin');
    expect(entry.description).not.toContain(agency.id);
    // The machine-readable id lives in sourceRef only.
    expect(entry.sourceRef).toBe(`tax_agency:${agency.id}`);
  });
});
