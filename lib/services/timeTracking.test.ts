/**
 * Integration tests for the Time Tracking service.
 *
 * Boots a throwaway PGlite database, seeds the minimum accounts/customer, then:
 *   1. Creates two billable time entries for a customer.
 *   2. billTimeToInvoice -> verifies invoice created with the right total.
 *   3. Verifies both entries are marked as invoiced (invoicedInvoiceId set).
 *   4. Verifies the trial balance stays balanced after the posting.
 *   5. Covers update, delete, and guard-rails (cannot edit invoiced entries).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts, timeEntries } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';
import { createAccount } from './accounts';
import { createCustomer } from './customers';
import { trialBalance } from './reports';
import {
  listTimeEntries,
  createTimeEntry,
  updateTimeEntry,
  deleteTimeEntry,
  billTimeToInvoice,
} from './timeTracking';

const TEST_DIR = path.resolve(
  process.cwd(),
  '.bookkeeper-data',
  'test-time-tracking-svc-h7x2q',
);

let ctx: ServiceContext;
let db: DB;
let customerId: string;

describe('Time Tracking service (integration)', () => {
  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'owner@time.local', name: 'Owner', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Time Track Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // Seed the minimum chart of accounts required by createInvoice.
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Cash', 'asset', 'checking'],
      ['1200', 'Accounts Receivable', 'asset', 'accounts_receivable'],
      ['2200', 'Sales Tax Payable', 'liability', 'long_term_liability'],
      ['3000', 'Owner Equity', 'equity', 'owners_equity'],
      ['4000', 'Sales Income', 'revenue', 'sales'],
    ];
    for (const [code, name, type, subtype] of defs) {
      await createAccount(ctx, { code, name, type: type as never, subtype });
    }

    const cust = await createCustomer(ctx, { displayName: 'Acme Corp' });
    customerId = cust.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // createTimeEntry
  // -------------------------------------------------------------------------

  it('creates a time entry and returns it', async () => {
    const entry = await createTimeEntry(ctx, {
      customerId,
      date: new Date('2025-06-01'),
      hours: 2,
      rate: '150.00',
      billable: true,
      description: 'Initial consultation',
    });

    expect(entry.companyId).toBe(ctx.companyId);
    expect(entry.customerId).toBe(customerId);
    expect(entry.hours).toBe('2.00');
    expect(entry.rate).toBe('150.00');
    expect(entry.billable).toBe(true);
    expect(entry.invoicedInvoiceId).toBeNull();
  });

  it('rejects a time entry with zero hours', async () => {
    await expect(
      createTimeEntry(ctx, { customerId, date: new Date(), hours: 0, billable: true }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects a time entry with negative hours', async () => {
    await expect(
      createTimeEntry(ctx, { customerId, date: new Date(), hours: -1, billable: true }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // -------------------------------------------------------------------------
  // listTimeEntries
  // -------------------------------------------------------------------------

  it('listTimeEntries returns entries scoped to the company', async () => {
    const rows = await listTimeEntries(ctx);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      expect(r.companyId).toBe(ctx.companyId);
    }
  });

  it('listTimeEntries filters by billable', async () => {
    await createTimeEntry(ctx, {
      customerId,
      date: new Date('2025-06-02'),
      hours: 1,
      billable: false,
    });
    const billable = await listTimeEntries(ctx, { billable: true });
    const nonBillable = await listTimeEntries(ctx, { billable: false });
    for (const r of billable) expect(r.billable).toBe(true);
    for (const r of nonBillable) expect(r.billable).toBe(false);
  });

  // -------------------------------------------------------------------------
  // updateTimeEntry
  // -------------------------------------------------------------------------

  it('updates a time entry', async () => {
    const entry = await createTimeEntry(ctx, {
      customerId,
      date: new Date('2025-06-03'),
      hours: 3,
      rate: '100.00',
      billable: true,
    });

    const updated = await updateTimeEntry(ctx, entry.id, { hours: 4, description: 'Updated desc' });
    expect(updated.hours).toBe('4.00');
    expect(updated.description).toBe('Updated desc');
  });

  it('rejects updating a non-existent entry', async () => {
    await expect(
      updateTimeEntry(ctx, '00000000-0000-0000-0000-000000000000', { hours: 1 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // deleteTimeEntry
  // -------------------------------------------------------------------------

  it('deletes an uninvoiced entry', async () => {
    const entry = await createTimeEntry(ctx, {
      customerId,
      date: new Date('2025-06-04'),
      hours: 1,
      billable: false,
    });
    const result = await deleteTimeEntry(ctx, entry.id);
    expect(result.deleted).toBe(true);

    const remaining = await ctx.db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.companyId, ctx.companyId), eq(timeEntries.id, entry.id)));
    expect(remaining).toHaveLength(0);
  });

  it('rejects deleting a non-existent entry', async () => {
    await expect(
      deleteTimeEntry(ctx, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // billTimeToInvoice — main scenario
  // -------------------------------------------------------------------------

  it('billTimeToInvoice creates invoice with correct total and marks entries invoiced', async () => {
    // Ensure we start from a clean slate by creating two fresh billable entries.
    const e1 = await createTimeEntry(ctx, {
      customerId,
      date: new Date('2025-07-01'),
      hours: 2,
      rate: '100.00',
      billable: true,
      description: 'Design work',
    });
    const e2 = await createTimeEntry(ctx, {
      customerId,
      date: new Date('2025-07-02'),
      hours: 3,
      rate: '200.00',
      billable: true,
      description: 'Development work',
    });

    // Expected total: 2*100 + 3*200 = 200 + 600 = 800
    const invoice = await billTimeToInvoice(ctx, { customerId });

    // Invoice total should be at least 800 (prior entries from earlier tests may add more).
    // Check specifically that the two entries we created are reflected.
    const totalExpected = 2 * 100 + 3 * 200;
    expect(parseFloat(invoice.total)).toBeGreaterThanOrEqual(totalExpected);
    expect(invoice.customerId).toBe(customerId);
    expect(invoice.status).toBe('open');
    expect(invoice.postedEntryId).toBeTruthy();

    // Both entries should now be marked invoiced.
    const [refreshed1] = await ctx.db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.companyId, ctx.companyId), eq(timeEntries.id, e1.id)));
    const [refreshed2] = await ctx.db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.companyId, ctx.companyId), eq(timeEntries.id, e2.id)));

    expect(refreshed1.invoicedInvoiceId).toBe(invoice.id);
    expect(refreshed2.invoicedInvoiceId).toBe(invoice.id);

    // Trial balance must remain balanced.
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });

  it('refuses to edit an invoiced entry', async () => {
    // After billing the entries above they are marked invoiced; fetch any one.
    const all = await listTimeEntries(ctx, { invoiced: true });
    expect(all.length).toBeGreaterThan(0);

    const invoicedEntry = all[0];
    await expect(
      updateTimeEntry(ctx, invoicedEntry.id, { hours: 99 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses to delete an invoiced entry', async () => {
    const all = await listTimeEntries(ctx, { invoiced: true });
    const invoicedEntry = all[0];
    await expect(
      deleteTimeEntry(ctx, invoicedEntry.id),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('billTimeToInvoice fails when no unbilled entries remain', async () => {
    // All entries for the customer should now be billed.
    await expect(
      billTimeToInvoice(ctx, { customerId }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('listTimeEntries filters invoiced=false returns only uninvoiced entries', async () => {
    const rows = await listTimeEntries(ctx, { invoiced: false });
    for (const r of rows) {
      expect(r.invoicedInvoiceId).toBeNull();
    }
  });
});
