/**
 * Integration tests for the vendor credits service.
 *
 * Seed: user + company + minimal COA (1000 Checking, 2000 A/P, 5000 Expense).
 * Tests:
 *  1. createVendorCredit — A/P is debited (reduced), expense is credited; trial balance stays balanced.
 *  2. applyToBill — bill.balanceDue decreases, credit.unapplied decreases; trial balance still balanced.
 *  3. voidVendorCredit — GL entry reversed; trial balance balanced again.
 *  4. Validation guards (unapplied overflow, void twice, etc.).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';
import { createAccount } from './accounts';
import { createBill } from './bills';
import { createVendorCredit, listVendorCredits, getVendorCredit, applyToBill, voidVendorCredit } from './vendorCredits';
import { trialBalance } from './reports';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-vendor-credits-7vc');
let ctx: ServiceContext;
let db: DB;
const acct: Record<string, string> = {};
let vendorId: string;

describe('vendorCredits service', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    // Seed user + company.
    const [user] = await db
      .insert(users)
      .values({ email: 'vc-owner@test.local', name: 'VC Owner', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'VC Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // Seed minimal COA.
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['2000', 'Accounts Payable', 'liability', 'accounts_payable'],
      ['5000', 'Office Supplies Expense', 'expense', 'operating_expenses'],
      ['5100', 'Utilities Expense', 'expense', 'operating_expenses'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }

    // Seed a vendor directly via DB (no vendor service required for test setup).
    const { vendors } = await import('@/lib/db/schema');
    const [vendor] = await db
      .insert(vendors)
      .values({ companyId: ctx.companyId, displayName: 'Acme Supplies' })
      .returning();
    vendorId = vendor.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // createVendorCredit
  // -------------------------------------------------------------------------

  it('creates a vendor credit and posts a balanced GL entry', async () => {
    const credit = await createVendorCredit(ctx, {
      vendorId,
      date: new Date('2025-03-01'),
      memo: 'Returned office supplies',
      lines: [
        { accountId: acct['5000'], description: 'Returned paper', amount: '150.00' },
        { accountId: acct['5100'], description: 'Utility overcharge refund', amount: '50.00' },
      ],
    });

    expect(credit.total).toBe('200.00');
    expect(credit.unapplied).toBe('200.00');
    expect(credit.status).toBe('open');
    expect(credit.postedEntryId).toBeTruthy();

    // A/P should be debited by 200 (liability decreased by 200 on the natural balance side).
    // The A/P account type is 'liability' so its natural balance is credit-normal.
    // A debit on A/P decreases the balance.
    const [apRow] = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, acct['2000']));
    // Starting balance 0. Dr A/P 200 => balance goes to -200 (credit-normal, debit decreases it).
    expect(apRow.balance).toBe('-200.00');

    // Trial balance must stay balanced after the posting.
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('listVendorCredits returns the created credit', async () => {
    const list = await listVendorCredits(ctx);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((c) => c.total === '200.00')).toBe(true);
  });

  it('getVendorCredit returns header + lines', async () => {
    const list = await listVendorCredits(ctx);
    const creditId = list[0].id;

    const full = await getVendorCredit(ctx, creditId);
    expect(full.lines).toHaveLength(2);
    expect(full.lines[0].amount).toBe('150.00');
    expect(full.lines[1].amount).toBe('50.00');
  });

  it('rejects lines with zero amount', async () => {
    await expect(
      createVendorCredit(ctx, {
        vendorId,
        date: new Date('2025-03-02'),
        lines: [{ accountId: acct['5000'], amount: '0.00' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // -------------------------------------------------------------------------
  // applyToBill
  // -------------------------------------------------------------------------

  it('applies a vendor credit to a bill and reduces both balances', async () => {
    // Create a fresh credit to apply.
    const credit = await createVendorCredit(ctx, {
      vendorId,
      date: new Date('2025-03-10'),
      lines: [{ accountId: acct['5000'], amount: '300.00' }],
    });

    // Create a bill for the same vendor.
    const bill = await createBill(ctx, {
      vendorId,
      date: new Date('2025-03-05'),
      lines: [{ accountId: acct['5000'], amount: '500.00' }],
    });

    // Apply $200 of the credit to the bill.
    const result = await applyToBill(ctx, {
      vendorCreditId: credit.id,
      billId: bill.id,
      amount: '200.00',
    });

    expect(result.credit.unapplied).toBe('100.00');
    expect(result.credit.status).toBe('partial');

    expect(result.bill.amountPaid).toBe('200.00');
    expect(result.bill.balanceDue).toBe('300.00');
    expect(result.bill.status).toBe('partial');

    // Trial balance must still be balanced (no new GL entry was posted).
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('fully applies a credit and sets credit status to closed', async () => {
    const credit = await createVendorCredit(ctx, {
      vendorId,
      date: new Date('2025-03-15'),
      lines: [{ accountId: acct['5000'], amount: '100.00' }],
    });

    const bill = await createBill(ctx, {
      vendorId,
      date: new Date('2025-03-12'),
      lines: [{ accountId: acct['5000'], amount: '400.00' }],
    });

    const result = await applyToBill(ctx, {
      vendorCreditId: credit.id,
      billId: bill.id,
      amount: '100.00',
    });

    expect(result.credit.unapplied).toBe('0.00');
    expect(result.credit.status).toBe('closed');
    expect(result.bill.balanceDue).toBe('300.00');
  });

  it('rejects apply amount that exceeds credit unapplied', async () => {
    const credit = await createVendorCredit(ctx, {
      vendorId,
      date: new Date('2025-03-20'),
      lines: [{ accountId: acct['5000'], amount: '50.00' }],
    });

    const bill = await createBill(ctx, {
      vendorId,
      date: new Date('2025-03-18'),
      lines: [{ accountId: acct['5000'], amount: '500.00' }],
    });

    await expect(
      applyToBill(ctx, {
        vendorCreditId: credit.id,
        billId: bill.id,
        amount: '999.00',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects apply amount that exceeds bill balance due', async () => {
    const credit = await createVendorCredit(ctx, {
      vendorId,
      date: new Date('2025-03-22'),
      lines: [{ accountId: acct['5000'], amount: '600.00' }],
    });

    const bill = await createBill(ctx, {
      vendorId,
      date: new Date('2025-03-21'),
      lines: [{ accountId: acct['5000'], amount: '100.00' }],
    });

    await expect(
      applyToBill(ctx, {
        vendorCreditId: credit.id,
        billId: bill.id,
        amount: '200.00',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // -------------------------------------------------------------------------
  // voidVendorCredit
  // -------------------------------------------------------------------------

  it('voiding a credit reverses the GL entry and keeps trial balance balanced', async () => {
    // Capture A/P balance before creating the credit.
    const [apBefore] = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, acct['2000']));

    const credit = await createVendorCredit(ctx, {
      vendorId,
      date: new Date('2025-04-01'),
      lines: [{ accountId: acct['5000'], amount: '75.00' }],
    });

    // A/P balance should have changed.
    const [apMid] = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, acct['2000']));
    expect(parseFloat(apMid.balance)).toBeLessThan(parseFloat(apBefore.balance));

    // Void the credit — GL should be reversed.
    const voided = await voidVendorCredit(ctx, credit.id);
    expect(voided.status).toBe('void');

    const [apAfter] = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, acct['2000']));
    expect(apAfter.balance).toBe(apBefore.balance);

    // Trial balance still balanced.
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('voiding an already-void credit is idempotent', async () => {
    const credit = await createVendorCredit(ctx, {
      vendorId,
      date: new Date('2025-04-05'),
      lines: [{ accountId: acct['5000'], amount: '25.00' }],
    });

    await voidVendorCredit(ctx, credit.id);
    // Second void should not throw.
    const again = await voidVendorCredit(ctx, credit.id);
    expect(again.status).toBe('void');
  });

  it('rejects voiding a credit that has been applied', async () => {
    const credit = await createVendorCredit(ctx, {
      vendorId,
      date: new Date('2025-04-10'),
      lines: [{ accountId: acct['5000'], amount: '80.00' }],
    });

    const bill = await createBill(ctx, {
      vendorId,
      date: new Date('2025-04-08'),
      lines: [{ accountId: acct['5000'], amount: '200.00' }],
    });

    await applyToBill(ctx, {
      vendorCreditId: credit.id,
      billId: bill.id,
      amount: '40.00',
    });

    await expect(voidVendorCredit(ctx, credit.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
