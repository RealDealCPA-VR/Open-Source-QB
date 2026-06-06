/**
 * Integration tests for the Credit Memos service.
 *
 * Uses a throwaway PGlite DB so every test run is isolated.
 * The trial balance must stay balanced after every mutation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { eq } from 'drizzle-orm';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts, invoices } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';
import { createAccount } from './accounts';
import { createInvoice } from './invoices';
import { createCreditMemo, getCreditMemo, listCreditMemos, applyToInvoice, voidCreditMemo } from './creditMemos';
import { trialBalance } from './reports';

// Unique dir per test run — parallel-safe
const TEST_DIR = path.resolve(
  process.cwd(),
  '.bookkeeper-data',
  'test-credit-memos-' + Date.now(),
);

let ctx: ServiceContext;
let db: DB;
// Account id map keyed by COA code
const acct: Record<string, string> = {};

describe('Credit Memos service', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'cm-owner@test.local', name: 'CM Owner', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'CM Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // Seed chart of accounts
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['1200', 'Accounts Receivable', 'asset', 'accounts_receivable'],
      ['2000', 'Accounts Payable', 'liability', 'accounts_payable'],
      ['2200', 'Sales Tax Payable', 'liability', 'accounts_payable'],
      ['3000', 'Owner Equity', 'equity', 'owners_equity'],
      ['4000', 'Sales Income', 'revenue', 'sales'],
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

  // Helper: check trial balance is balanced
  async function assertBalanced() {
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  }

  // Helper: get account balance from DB
  async function getBalance(code: string): Promise<string> {
    const [row] = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.id, acct[code]));
    return row?.balance ?? '0.00';
  }

  // ---------------------------------------------------------------------------
  // Seed a customer directly via DB (no customer service dependency)
  // ---------------------------------------------------------------------------
  let customerId: string;
  beforeAll(async () => {
    const { customers } = await import('@/lib/db/schema');
    const [cust] = await db
      .insert(customers)
      .values({
        companyId: ctx.companyId,
        displayName: 'Test Customer',
        taxable: false,
      })
      .returning();
    customerId = cust.id;
  });

  // ---------------------------------------------------------------------------
  // Test: createCreditMemo posts correct GL and reduces A/R
  // ---------------------------------------------------------------------------
  it('createCreditMemo: posts Dr income / Cr A/R and trial balance stays balanced', async () => {
    const arBefore = await getBalance('1200');
    const incBefore = await getBalance('4000');

    const memo = await createCreditMemo(ctx, {
      customerId,
      date: new Date('2025-03-01'),
      lines: [
        { description: 'Returned widget', quantity: 2, rate: '50.00' },
      ],
    });

    expect(memo.total).toBe('100.00');
    expect(memo.unapplied).toBe('100.00');
    expect(memo.status).toBe('open');
    expect(memo.postedEntryId).toBeTruthy();

    // A/R should decrease (credit to A/R)
    const arAfter = await getBalance('1200');
    const incAfter = await getBalance('4000');

    // A/R is asset (debit normal), credit reduces it
    const arDelta = Number(arAfter) - Number(arBefore);
    expect(arDelta).toBeCloseTo(-100, 2);

    // Income is revenue (credit normal), debit reduces it
    const incDelta = Number(incAfter) - Number(incBefore);
    expect(incDelta).toBeCloseTo(-100, 2);

    await assertBalanced();
  });

  // ---------------------------------------------------------------------------
  // Test: getCreditMemo returns header + lines
  // ---------------------------------------------------------------------------
  it('getCreditMemo returns memo with lines', async () => {
    const memo = await createCreditMemo(ctx, {
      customerId,
      date: new Date('2025-03-05'),
      lines: [{ description: 'Line A', quantity: 1, rate: '75.00' }],
      memo: 'Returns batch 2',
    });

    const fetched = await getCreditMemo(ctx, memo.id);
    expect(fetched.id).toBe(memo.id);
    expect(fetched.lines).toHaveLength(1);
    expect(fetched.lines[0].amount).toBe('75.00');
    expect(fetched.memo).toBe('Returns batch 2');
  });

  // ---------------------------------------------------------------------------
  // Test: listCreditMemos scoped to company
  // ---------------------------------------------------------------------------
  it('listCreditMemos returns all memos for company', async () => {
    const list = await listCreditMemos(ctx);
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (const m of list) {
      expect(m.companyId).toBe(ctx.companyId);
    }
  });

  // ---------------------------------------------------------------------------
  // Test: applyToInvoice reduces invoice.balanceDue and memo.unapplied
  // ---------------------------------------------------------------------------
  it('applyToInvoice: invoice balance reduced, memo unapplied reduced', async () => {
    // Create an invoice for $200
    const inv = await createInvoice(ctx, {
      customerId,
      date: new Date('2025-03-10'),
      lines: [{ quantity: 4, rate: '50.00' }],
    });
    expect(inv.balanceDue).toBe('200.00');

    // Create a credit memo for $80
    const memo = await createCreditMemo(ctx, {
      customerId,
      date: new Date('2025-03-11'),
      lines: [{ quantity: 1, rate: '80.00' }],
    });
    expect(memo.unapplied).toBe('80.00');

    // Apply $60 of the credit to the invoice
    const result = await applyToInvoice(ctx, {
      creditMemoId: memo.id,
      invoiceId: inv.id,
      amount: '60.00',
    });

    expect(result.invoice.balanceDue).toBe('140.00');
    expect(result.invoice.amountPaid).toBe('60.00');
    expect(result.invoice.status).toBe('partial');
    expect(result.creditMemo.unapplied).toBe('20.00');
    expect(result.creditMemo.status).toBe('open');

    // Trial balance still balanced (no new GL entry was posted)
    await assertBalanced();
  });

  it('applyToInvoice: fully applying credit sets invoice to paid and memo unapplied=0', async () => {
    // Small invoice
    const inv = await createInvoice(ctx, {
      customerId,
      date: new Date('2025-03-12'),
      lines: [{ quantity: 1, rate: '30.00' }],
    });
    // Matching credit memo
    const memo = await createCreditMemo(ctx, {
      customerId,
      date: new Date('2025-03-12'),
      lines: [{ quantity: 1, rate: '30.00' }],
    });

    const result = await applyToInvoice(ctx, {
      creditMemoId: memo.id,
      invoiceId: inv.id,
      amount: '30.00',
    });

    expect(result.invoice.status).toBe('paid');
    expect(result.invoice.balanceDue).toBe('0.00');
    expect(result.creditMemo.unapplied).toBe('0.00');
    expect(result.creditMemo.status).toBe('paid');

    await assertBalanced();
  });

  // ---------------------------------------------------------------------------
  // Test: applyToInvoice validation errors
  // ---------------------------------------------------------------------------
  it('applyToInvoice: rejects amount > unapplied', async () => {
    const inv = await createInvoice(ctx, {
      customerId,
      date: new Date('2025-03-13'),
      lines: [{ quantity: 1, rate: '500.00' }],
    });
    const memo = await createCreditMemo(ctx, {
      customerId,
      date: new Date('2025-03-13'),
      lines: [{ quantity: 1, rate: '50.00' }],
    });

    await expect(
      applyToInvoice(ctx, { creditMemoId: memo.id, invoiceId: inv.id, amount: '100.00' }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it('applyToInvoice: rejects amount > invoice.balanceDue', async () => {
    const inv = await createInvoice(ctx, {
      customerId,
      date: new Date('2025-03-14'),
      lines: [{ quantity: 1, rate: '10.00' }],
    });
    const memo = await createCreditMemo(ctx, {
      customerId,
      date: new Date('2025-03-14'),
      lines: [{ quantity: 1, rate: '200.00' }],
    });

    await expect(
      applyToInvoice(ctx, { creditMemoId: memo.id, invoiceId: inv.id, amount: '50.00' }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  // ---------------------------------------------------------------------------
  // Test: voidCreditMemo reverses GL and trial balance stays balanced
  // ---------------------------------------------------------------------------
  it('voidCreditMemo: reverses GL entry and trial balance stays balanced', async () => {
    const arBefore = await getBalance('1200');

    const memo = await createCreditMemo(ctx, {
      customerId,
      date: new Date('2025-03-20'),
      lines: [{ description: 'To void', quantity: 1, rate: '40.00' }],
    });

    // A/R should have dropped by $40
    const arAfterCreate = await getBalance('1200');
    expect(Number(arAfterCreate) - Number(arBefore)).toBeCloseTo(-40, 2);

    // Void it
    const voided = await voidCreditMemo(ctx, memo.id);
    expect(voided.status).toBe('void');

    // A/R should be restored
    const arAfterVoid = await getBalance('1200');
    expect(Number(arAfterVoid)).toBeCloseTo(Number(arBefore), 2);

    await assertBalanced();
  });

  it('voidCreditMemo: idempotent on already-voided memo', async () => {
    const memo = await createCreditMemo(ctx, {
      customerId,
      date: new Date('2025-03-21'),
      lines: [{ quantity: 1, rate: '15.00' }],
    });
    await voidCreditMemo(ctx, memo.id);
    // Second void should not throw
    const again = await voidCreditMemo(ctx, memo.id);
    expect(again.status).toBe('void');
  });

  it('voidCreditMemo: blocks void when credit has been applied', async () => {
    const inv = await createInvoice(ctx, {
      customerId,
      date: new Date('2025-03-22'),
      lines: [{ quantity: 1, rate: '100.00' }],
    });
    const memo = await createCreditMemo(ctx, {
      customerId,
      date: new Date('2025-03-22'),
      lines: [{ quantity: 1, rate: '50.00' }],
    });
    await applyToInvoice(ctx, { creditMemoId: memo.id, invoiceId: inv.id, amount: '50.00' });

    await expect(voidCreditMemo(ctx, memo.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
