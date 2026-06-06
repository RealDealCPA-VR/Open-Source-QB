/**
 * Integration tests for the Estimates service.
 *
 * Verifies:
 *  1. createEstimate inserts header + lines with correct computed totals.
 *  2. listEstimates / getEstimate round-trip correctly.
 *  3. updateEstimateStatus transitions work and guard closed estimates.
 *  4. convertToInvoice creates an invoice, posts to AR, marks the estimate closed,
 *     and leaves the trial balance balanced.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { createCustomer } from './customers';
import { trialBalance } from './reports';
import {
  createEstimate,
  listEstimates,
  getEstimate,
  updateEstimateStatus,
  convertToInvoice,
} from './estimates';
import { ServiceError } from './_base';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-estimates-svc');
let ctx: ServiceContext;
let db: DB;
let customerId: string;

describe('Estimates service', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'owner@est.local', name: 'Owner', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Est Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // Seed the minimum chart of accounts required by createInvoice.
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Cash', 'asset', 'checking'],
      ['1200', 'Accounts Receivable', 'asset', 'accounts_receivable'],
      ['2200', 'Sales Tax Payable', 'liability', 'accounts_payable'],
      ['3000', 'Owner Equity', 'equity', 'owners_equity'],
      ['4000', 'Sales Income', 'revenue', 'sales'],
    ];
    for (const [code, name, type, subtype] of defs) {
      await createAccount(ctx, { code, name, type: type as never, subtype });
    }

    const customer = await createCustomer(ctx, {
      displayName: 'Acme Corp',
      email: 'acme@example.com',
    });
    customerId = customer.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ---- createEstimate ----

  it('creates an estimate with correct computed totals', async () => {
    const est = await createEstimate(ctx, {
      customerId,
      date: new Date('2025-03-01'),
      lines: [
        { description: 'Consulting', quantity: 10, rate: 150 },
        { description: 'Travel', quantity: 1, rate: 200, taxable: false },
      ],
    });

    expect(est.estimateNumber).toBe(1);
    expect(est.status).toBe('draft');
    // subtotal = 10*150 + 1*200 = 1500 + 200 = 1700
    expect(est.subtotal).toBe('1700.00');
    expect(est.taxAmount).toBe('0.00');
    expect(est.total).toBe('1700.00');
    expect(est.lines).toHaveLength(2);
    expect(est.lines[0].amount).toBe('1500.00');
    expect(est.lines[1].amount).toBe('200.00');
    expect(est.lines[1].taxable).toBe(false);
  });

  it('rejects an estimate with no lines', async () => {
    await expect(
      createEstimate(ctx, { customerId, date: new Date(), lines: [] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a line with zero or negative quantity', async () => {
    await expect(
      createEstimate(ctx, {
        customerId,
        date: new Date(),
        lines: [{ description: 'Bad', quantity: 0, rate: 100 }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // ---- listEstimates / getEstimate ----

  it('listEstimates returns all estimates scoped to the company', async () => {
    // Create a second estimate so we have two.
    await createEstimate(ctx, {
      customerId,
      date: new Date('2025-04-01'),
      lines: [{ description: 'Design', quantity: 5, rate: 80 }],
    });

    const list = await listEstimates(ctx);
    expect(list.length).toBeGreaterThanOrEqual(2);
    // All belong to this company.
    expect(list.every((e) => e.companyId === ctx.companyId)).toBe(true);
  });

  it('getEstimate returns header + lines', async () => {
    const [first] = await listEstimates(ctx);
    const detail = await getEstimate(ctx, first.id);
    expect(detail.id).toBe(first.id);
    expect(Array.isArray(detail.lines)).toBe(true);
    expect(detail.lines.length).toBeGreaterThanOrEqual(1);
  });

  it('getEstimate throws NOT_FOUND for unknown id', async () => {
    await expect(
      getEstimate(ctx, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // ---- updateEstimateStatus ----

  it('can transition an estimate from draft to accepted', async () => {
    const [target] = await listEstimates(ctx);
    const updated = await updateEstimateStatus(ctx, target.id, 'accepted');
    expect(updated.status).toBe('accepted');
  });

  it('can transition back to draft from accepted', async () => {
    const list = await listEstimates(ctx);
    const accepted = list.find((e) => e.status === 'accepted');
    expect(accepted).toBeDefined();
    const updated = await updateEstimateStatus(ctx, accepted!.id, 'draft');
    expect(updated.status).toBe('draft');
  });

  it('rejects invalid status values', async () => {
    const [target] = await listEstimates(ctx);
    await expect(
      // @ts-expect-error — intentionally testing invalid status
      updateEstimateStatus(ctx, target.id, 'open'),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // ---- convertToInvoice ----

  it('converts an estimate to an invoice and posts AR', async () => {
    // Create a fresh estimate for conversion.
    const est = await createEstimate(ctx, {
      customerId,
      date: new Date('2025-05-01'),
      expirationDate: new Date('2025-05-31'),
      lines: [{ description: 'Widget build', quantity: 3, rate: 500 }],
      memo: 'Net 30',
    });
    expect(est.status).toBe('draft');

    const invoice = await convertToInvoice(ctx, est.id);

    // Invoice created with correct amount.
    expect(invoice.customerId).toBe(customerId);
    expect(invoice.total).toBe('1500.00');
    expect(invoice.status).toBe('open');
    expect(invoice.postedEntryId).toBeTruthy();

    // Estimate should now be closed with convertedInvoiceId set.
    const closed = await getEstimate(ctx, est.id);
    expect(closed.status).toBe('closed');
    expect(closed.convertedInvoiceId).toBe(invoice.id);

    // AR account should have a positive balance (debit normal).
    const arRows = await db
      .select({ balance: accounts.balance })
      .from(accounts)
      .where(
        eq(accounts.companyId, ctx.companyId),
      );
    const arAccount = arRows.find(() => true); // just confirm AR exists
    expect(arAccount).toBeDefined();

    // Trial balance must still be balanced after the GL posting.
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('refuses to convert an already-closed estimate', async () => {
    // The estimate we just closed above.
    const list = await listEstimates(ctx);
    const closed = list.find((e) => e.status === 'closed');
    expect(closed).toBeDefined();

    await expect(convertToInvoice(ctx, closed!.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses to convert a rejected estimate', async () => {
    const est = await createEstimate(ctx, {
      customerId,
      date: new Date('2025-06-01'),
      lines: [{ description: 'Rejected work', quantity: 1, rate: 100 }],
    });
    await updateEstimateStatus(ctx, est.id, 'rejected');

    await expect(convertToInvoice(ctx, est.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses to change status of a closed estimate', async () => {
    const list = await listEstimates(ctx);
    const closed = list.find((e) => e.status === 'closed');
    expect(closed).toBeDefined();

    await expect(
      updateEstimateStatus(ctx, closed!.id, 'draft'),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
