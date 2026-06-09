/**
 * 1099 worksheet + account-to-box mapping tests.
 *
 *  - With NO mapping saved, every eligible payment dollar lands in NEC box 1.
 *  - With a mapping, expense/bill lines route to their account's box and lines
 *    on unmapped accounts are EXCLUDED.
 *  - Bill-payment amounts are prorated across the bill's lines by line amount.
 *  - Credit-card-settled payments stay excluded (1099-K territory).
 *  - set1099Mapping validates boxes/accounts and persists to companies.settings.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import {
  billPaymentApplications,
  billPayments,
  companies,
  users,
  vendors,
} from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { createBill } from './bills';
import { createExpense } from './expenses';
import {
  get1099Mapping,
  set1099Mapping,
  vendor1099Report,
  vendor1099Worksheet,
} from './statements';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-1099-mapping');
const YEAR = 2025;
let ctx: ServiceContext;
let db: DB;
const acct: Record<string, string> = {};
let vendorId: string;

describe('1099 worksheet — account mapping, MISC boxes, CC exclusion', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: '1099-map@test.local', name: '1099 Mapper', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: '1099 Mapping Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['2000', 'Accounts Payable', 'liability', 'accounts_payable'],
      ['2100', 'Company Card', 'liability', 'credit_card'],
      ['6000', 'Subcontractors', 'expense', 'operating_expenses'],
      ['6100', 'Rent', 'expense', 'operating_expenses'],
      ['6300', 'Office Supplies', 'expense', 'operating_expenses'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }

    const [vendor] = await db
      .insert(vendors)
      .values({
        companyId: company.id,
        displayName: 'Mapped 1099 Vendor',
        is1099: true,
        taxId: '12-3456789',
      })
      .returning();
    vendorId = vendor.id;

    // Direct expense in YEAR: 700 subcontract labor + 900 rent, paid by check.
    await createExpense(ctx, {
      vendorId,
      date: new Date(`${YEAR}-03-15T12:00:00.000Z`),
      method: 'cash',
      paymentAccountId: acct['1000'],
      lines: [
        { accountId: acct['6000'], description: 'Contract labor', amount: '700.00' },
        { accountId: acct['6100'], description: 'Office rent', amount: '900.00' },
      ],
    });
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('defaults everything to NEC box 1 when no mapping is saved', async () => {
    expect(await get1099Mapping(ctx)).toBeNull();

    const ws = await vendor1099Worksheet(ctx, { year: YEAR });
    expect(ws.mapped).toBe(false);
    expect(ws.rows.length).toBe(1);
    expect(ws.rows[0].nec1).toBe('1600.00');
    expect(ws.rows[0].misc1).toBe('0.00');
    expect(ws.rows[0].misc3).toBe('0.00');
    expect(ws.rows[0].necEligible).toBe(true);
    expect(ws.rows[0].taxId).toBe('12-3456789');
  });

  it('validates and saves the mapping', async () => {
    await expect(
      set1099Mapping(ctx, { boxes: [{ box: 'nec_9' as never, accountIds: [acct['6000']] }] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    await expect(
      set1099Mapping(ctx, {
        boxes: [
          { box: 'nec_1', accountIds: [acct['6000']] },
          { box: 'misc_1', accountIds: [acct['6000']] }, // same account twice
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    const saved = await set1099Mapping(ctx, {
      boxes: [
        { box: 'nec_1', accountIds: [acct['6000']] },
        { box: 'misc_1', accountIds: [acct['6100']] },
      ],
    });
    expect(saved.boxes.length).toBe(2);

    const roundTrip = await get1099Mapping(ctx);
    expect(roundTrip?.boxes.find((b) => b.box === 'misc_1')?.accountIds).toEqual([acct['6100']]);
  });

  it('routes expense lines to their mapped boxes and excludes unmapped accounts', async () => {
    // Unmapped account: should NOT count while the mapping is active.
    await createExpense(ctx, {
      vendorId,
      date: new Date(`${YEAR}-04-01T12:00:00.000Z`),
      method: 'cash',
      paymentAccountId: acct['1000'],
      lines: [{ accountId: acct['6300'], description: 'Supplies', amount: '100.00' }],
    });

    const ws = await vendor1099Worksheet(ctx, { year: YEAR });
    expect(ws.mapped).toBe(true);
    expect(ws.rows.length).toBe(1);
    expect(ws.rows[0].nec1).toBe('700.00');
    expect(ws.rows[0].misc1).toBe('900.00');
    expect(ws.rows[0].misc3).toBe('0.00');
    expect(ws.rows[0].total).toBe('1600.00'); // 100 on the unmapped account excluded
    expect(ws.rows[0].necEligible).toBe(true);
    expect(ws.rows[0].miscEligible).toBe(true);
  });

  it('keeps excluding credit-card-settled payments (1099-K)', async () => {
    await createExpense(ctx, {
      vendorId,
      date: new Date(`${YEAR}-05-01T12:00:00.000Z`),
      method: 'credit_card',
      paymentAccountId: acct['2100'],
      lines: [{ accountId: acct['6000'], description: 'Card-paid labor', amount: '500.00' }],
    });

    const ws = await vendor1099Worksheet(ctx, { year: YEAR });
    expect(ws.rows[0].nec1).toBe('700.00'); // unchanged

    // The legacy NEC report (used by e-file/XML) also still excludes it.
    const legacy = await vendor1099Report(ctx, { year: YEAR });
    expect(legacy.length).toBe(1);
    // 1600 + 100 supplies (legacy ignores mapping); the 500 CC expense stays out.
    expect(legacy[0].total).toBe('1700.00');
  });

  it('prorates bill payments across bill lines by amount', async () => {
    // Bill: 300 subcontractors + 200 rent = 500 total.
    const bill = await createBill(ctx, {
      vendorId,
      billNumber: '1099-BILL',
      date: new Date(`${YEAR}-06-01T12:00:00.000Z`),
      lines: [
        { accountId: acct['6000'], description: 'Labor', amount: '300.00' },
        { accountId: acct['6100'], description: 'Rent', amount: '200.00' },
      ],
    });

    // Half-paid by check: 250 applied → 150 labor (nec_1) + 100 rent (misc_1).
    const [payment] = await db
      .insert(billPayments)
      .values({
        companyId: ctx.companyId,
        vendorId,
        date: new Date(`${YEAR}-06-15T12:00:00.000Z`),
        method: 'check',
        amount: '250.00',
        paymentAccountId: acct['1000'],
      })
      .returning();
    await db.insert(billPaymentApplications).values({
      billPaymentId: payment.id,
      billId: bill.id,
      amountApplied: '250.00',
    });

    const ws = await vendor1099Worksheet(ctx, { year: YEAR });
    expect(ws.rows[0].nec1).toBe('850.00'); // 700 + 150
    expect(ws.rows[0].misc1).toBe('1000.00'); // 900 + 100
  });

  it('clearing the mapping restores the all-to-NEC default', async () => {
    await set1099Mapping(ctx, { boxes: [] });
    const ws = await vendor1099Worksheet(ctx, { year: YEAR });
    expect(ws.mapped).toBe(false);
    // 1600 expense + 100 supplies + 250 bill payment, all to NEC.
    expect(ws.rows[0].nec1).toBe('1950.00');
    expect(ws.rows[0].misc1).toBe('0.00');
  });
});
