/**
 * Integration tests for the Bills (A/P) service.
 *
 * Uses a throwaway PGlite directory so tests are fully isolated from dev data.
 * Verifies:
 *  - A/P (2000) is credited by the full bill total on createBill.
 *  - Expense accounts are debited per line.
 *  - Trial balance stays balanced after every mutation.
 *  - voidBill reverses all GL impacts.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts, vendors } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { trialBalance } from './reports';
import { createBill, getBill, listBills, voidBill } from './bills';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-bills');
let ctx: ServiceContext;
let db: DB;

/** Account-code → id lookup populated during seed. */
const acct: Record<string, string> = {};
let vendorId: string;

describe('Bills (A/P) service', () => {
  // -----------------------------------------------------------------------
  // Setup — one user, one company, seeded accounts + one vendor
  // -----------------------------------------------------------------------
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'bills-owner@test.local', name: 'Bills Owner', passwordHash: 'x' })
      .returning();

    const [company] = await db
      .insert(companies)
      .values({ name: 'Bills Test Co', ownerId: user.id })
      .returning();

    ctx = { db, companyId: company.id, userId: user.id };

    // Seed the accounts we need.
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['2000', 'Accounts Payable', 'liability', 'accounts_payable'],
      ['5000', 'Cost of Goods Sold', 'expense', 'cost_of_goods_sold'],
      ['6000', 'Advertising & Marketing', 'expense', 'operating_expenses'],
      ['6300', 'Office Supplies', 'expense', 'operating_expenses'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }

    // Seed one vendor.
    const [vendor] = await db
      .insert(vendors)
      .values({
        companyId: company.id,
        displayName: 'ACME Supplies Inc.',
      })
      .returning();
    vendorId = vendor.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Validation guards
  // -----------------------------------------------------------------------

  it('rejects a bill with no lines', async () => {
    await expect(
      createBill(ctx, {
        vendorId,
        date: new Date('2025-03-01'),
        lines: [],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a bill line with a zero amount', async () => {
    await expect(
      createBill(ctx, {
        vendorId,
        date: new Date('2025-03-01'),
        lines: [{ accountId: acct['5000'], amount: '0.00' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a bill for a vendor in another company', async () => {
    await expect(
      createBill(ctx, {
        vendorId: '00000000-0000-0000-0000-000000000000',
        date: new Date('2025-03-01'),
        lines: [{ accountId: acct['5000'], amount: '100.00' }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -----------------------------------------------------------------------
  // Happy-path: create, list, getBill, trial balance
  // -----------------------------------------------------------------------

  it('creates a single-line bill and credits A/P', async () => {
    const bill = await createBill(ctx, {
      vendorId,
      billNumber: 'INV-001',
      date: new Date('2025-03-05'),
      dueDate: new Date('2025-04-05'),
      lines: [
        { accountId: acct['5000'], description: 'March inventory', amount: '1500.00' },
      ],
    });

    expect(bill.total).toBe('1500.00');
    expect(bill.balanceDue).toBe('1500.00');
    expect(bill.amountPaid).toBe('0.00');
    expect(bill.status).toBe('open');
    expect(bill.postedEntryId).toBeTruthy();

    // A/P account balance should now be 1500.00 (credit-normal = positive balance)
    const [ap] = await db.select().from(accounts).where(eq(accounts.id, acct['2000']));
    expect(ap.balance).toBe('1500.00');

    // Expense account balance should be 1500.00 (debit-normal)
    const [cogs] = await db.select().from(accounts).where(eq(accounts.id, acct['5000']));
    expect(cogs.balance).toBe('1500.00');

    // Trial balance must be balanced.
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it('creates a multi-line bill and correctly sums the total', async () => {
    const bill = await createBill(ctx, {
      vendorId,
      billNumber: 'INV-002',
      date: new Date('2025-03-10'),
      lines: [
        { accountId: acct['6000'], description: 'Q1 advertising', amount: '800.00' },
        { accountId: acct['6300'], description: 'Office supplies', amount: '250.00' },
      ],
    });

    expect(bill.total).toBe('1050.00');
    expect(bill.balanceDue).toBe('1050.00');

    // A/P should now carry 1500 + 1050 = 2550
    const [ap] = await db.select().from(accounts).where(eq(accounts.id, acct['2000']));
    expect(ap.balance).toBe('2550.00');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('listBills returns all bills for the company', async () => {
    const list = await listBills(ctx);
    // We've created 2 bills so far.
    expect(list.length).toBeGreaterThanOrEqual(2);
    // All belong to our company.
    for (const b of list) {
      expect(b.companyId).toBe(ctx.companyId);
    }
  });

  it('getBill returns the bill with its lines', async () => {
    const bill = await createBill(ctx, {
      vendorId,
      billNumber: 'INV-003',
      date: new Date('2025-03-15'),
      lines: [
        { accountId: acct['6000'], amount: '300.00' },
        { accountId: acct['6300'], amount: '150.00' },
      ],
    });

    const fetched = await getBill(ctx, bill.id);
    expect(fetched.id).toBe(bill.id);
    expect(fetched.lines).toHaveLength(2);
    expect(fetched.lines[0].lineOrder).toBe(0);
    expect(fetched.lines[1].lineOrder).toBe(1);
  });

  it('getBill throws NOT_FOUND for an unknown id', async () => {
    await expect(
      getBill(ctx, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -----------------------------------------------------------------------
  // voidBill — reverses GL, zeroes balanceDue, is idempotent
  // -----------------------------------------------------------------------

  it('voidBill reverses the GL and zeroes balanceDue', async () => {
    // Snapshot A/P before voiding.
    const [apBefore] = await db.select().from(accounts).where(eq(accounts.id, acct['2000']));
    const apBefore$ = apBefore.balance;

    // Create a fresh bill to void.
    const bill = await createBill(ctx, {
      vendorId,
      billNumber: 'VOID-ME',
      date: new Date('2025-03-20'),
      lines: [{ accountId: acct['5000'], amount: '400.00' }],
    });

    // A/P increased by 400.
    const [apMid] = await db.select().from(accounts).where(eq(accounts.id, acct['2000']));
    expect(Number(apMid.balance)).toBe(Number(apBefore$) + 400);

    // Now void it.
    const voided = await voidBill(ctx, bill.id);
    expect(voided.status).toBe('void');
    expect(voided.balanceDue).toBe('0.00');

    // A/P must return to its pre-bill level.
    const [apAfter] = await db.select().from(accounts).where(eq(accounts.id, acct['2000']));
    expect(apAfter.balance).toBe(apBefore$);

    // Trial balance still balanced.
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('voidBill is idempotent when called twice', async () => {
    const bill = await createBill(ctx, {
      vendorId,
      date: new Date('2025-03-25'),
      lines: [{ accountId: acct['5000'], amount: '100.00' }],
    });

    const first = await voidBill(ctx, bill.id);
    expect(first.status).toBe('void');

    // Second call should not throw.
    const second = await voidBill(ctx, bill.id);
    expect(second.status).toBe('void');

    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('voidBill throws NOT_FOUND for an unknown bill id', async () => {
    await expect(
      voidBill(ctx, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -----------------------------------------------------------------------
  // Final overall balance check
  // -----------------------------------------------------------------------

  it('trial balance is balanced after all operations', async () => {
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });
});
