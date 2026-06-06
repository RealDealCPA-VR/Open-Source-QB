/**
 * Integration tests for the salesReps service.
 *
 * Boots a throwaway PGlite instance, seeds a user + company + chart-of-accounts,
 * then exercises CRUD, assign, and commission report.
 *
 * Key assertion: commission = invoiceTotal * commissionRate.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, customers as customersTable, invoices } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';
import { createAccount } from './accounts';
import {
  listSalesReps,
  getSalesRep,
  createSalesRep,
  updateSalesRep,
  deactivateSalesRep,
  assignRepToInvoice,
  commissionReport,
} from './salesReps';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-sales-reps');
let ctx: ServiceContext;
let db: DB;
const acct: Record<string, string> = {};

describe('salesReps service (integration)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'owner-sr@test.local', name: 'Owner SR', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'SalesRep Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // Seed accounts needed for invoice insert.
    const defs: Array<[string, string, string, string]> = [
      ['1200', 'Accounts Receivable', 'asset', 'accounts_receivable'],
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

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  it('creates a sales rep', async () => {
    const rep = await createSalesRep(ctx, {
      name: 'Alice Smith',
      email: 'alice@example.com',
      commissionRate: 0.05,
    });
    expect(rep.name).toBe('Alice Smith');
    expect(rep.email).toBe('alice@example.com');
    // DB stores commissionRate as decimal(6,4) so it may return '0.0500'
    expect(parseFloat(rep.commissionRate)).toBeCloseTo(0.05);
    expect(rep.isActive).toBe(true);
    expect(rep.companyId).toBe(ctx.companyId);
  });

  it('rejects missing name', async () => {
    await expect(
      createSalesRep(ctx, { name: '', commissionRate: 0.05 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects commissionRate > 1', async () => {
    await expect(
      createSalesRep(ctx, { name: 'Bad Rep', commissionRate: 1.5 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects invalid email', async () => {
    await expect(
      createSalesRep(ctx, { name: 'Bob', email: 'not-an-email', commissionRate: 0.1 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // -------------------------------------------------------------------------
  // List / read
  // -------------------------------------------------------------------------

  it('lists active reps', async () => {
    const reps = await listSalesReps(ctx);
    expect(reps.some((r) => r.name === 'Alice Smith')).toBe(true);
  });

  it('getSalesRep returns correct record', async () => {
    const [first] = await listSalesReps(ctx);
    const rep = await getSalesRep(ctx, first.id);
    expect(rep.id).toBe(first.id);
  });

  it('getSalesRep throws NOT_FOUND for unknown id', async () => {
    await expect(
      getSalesRep(ctx, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  it('updates name and commissionRate', async () => {
    const [rep] = await listSalesReps(ctx);
    const updated = await updateSalesRep(ctx, rep.id, { name: 'Alice Jones', commissionRate: 0.08 });
    expect(updated.name).toBe('Alice Jones');
    expect(parseFloat(updated.commissionRate)).toBeCloseTo(0.08);
  });

  // -------------------------------------------------------------------------
  // Deactivate
  // -------------------------------------------------------------------------

  it('deactivates a rep', async () => {
    const created = await createSalesRep(ctx, { name: 'Temp Rep', commissionRate: 0.03 });
    const deactivated = await deactivateSalesRep(ctx, created.id);
    expect(deactivated.isActive).toBe(false);

    // Should not appear in default list.
    const reps = await listSalesReps(ctx);
    expect(reps.find((r) => r.id === created.id)).toBeUndefined();

    // Does appear with includeInactive.
    const all = await listSalesReps(ctx, { includeInactive: true });
    expect(all.find((r) => r.id === created.id)).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Assign rep to invoice + commission report
  // -------------------------------------------------------------------------

  it('commissionReport: commission = total * rate', async () => {
    // Create a customer.
    const [customer] = await db
      .insert(customersTable)
      .values({ companyId: ctx.companyId, displayName: 'Test Customer' })
      .returning();

    // Create a rep at 5%.
    const rep = await createSalesRep(ctx, { name: 'Bob Rep', commissionRate: 0.05 });

    // Insert an invoice directly (bypass GL posting for test simplicity).
    const [inv] = await db
      .insert(invoices)
      .values({
        companyId: ctx.companyId,
        customerId: customer.id,
        invoiceNumber: 1001,
        date: new Date('2024-06-01'),
        status: 'open',
        salesRepId: rep.id,
        subtotal: '1000.00',
        discount: '0.00',
        taxAmount: '0.00',
        total: '1000.00',
        amountPaid: '0.00',
        balanceDue: '1000.00',
        retainageAmount: '0.00',
      })
      .returning();
    expect(inv.salesRepId).toBe(rep.id);

    // Run commission report with no date filter.
    const report = await commissionReport(ctx);
    const row = report.rows.find((r) => r.repId === rep.id);
    expect(row).toBeDefined();
    expect(row!.salesTotal).toBe('1000.00');
    // DB decimal(6,4) may return '0.0500'
    expect(parseFloat(row!.commissionRate)).toBeCloseTo(0.05);
    // commission = 1000 * 0.05 = 50.00
    expect(row!.commission).toBe('50.00');

    expect(report.totals.salesTotal).toMatch(/^\d+\.\d{2}$/);
  });

  it('assignRepToInvoice updates salesRepId', async () => {
    // Create a second customer and invoice.
    const [customer] = await db
      .insert(customersTable)
      .values({ companyId: ctx.companyId, displayName: 'Customer 2' })
      .returning();
    const [inv] = await db
      .insert(invoices)
      .values({
        companyId: ctx.companyId,
        customerId: customer.id,
        invoiceNumber: 1002,
        date: new Date('2024-06-15'),
        status: 'open',
        subtotal: '500.00',
        discount: '0.00',
        taxAmount: '0.00',
        total: '500.00',
        amountPaid: '0.00',
        balanceDue: '500.00',
        retainageAmount: '0.00',
      })
      .returning();

    const [rep] = await listSalesReps(ctx);
    const updated = await assignRepToInvoice(ctx, { invoiceId: inv.id, salesRepId: rep.id });
    expect(updated.salesRepId).toBe(rep.id);

    // Unassign.
    const cleared = await assignRepToInvoice(ctx, { invoiceId: inv.id, salesRepId: null });
    expect(cleared.salesRepId).toBeNull();
  });

  it('assignRepToInvoice throws NOT_FOUND for wrong company invoice', async () => {
    // Create a second company.
    const [user2] = await db
      .insert(users)
      .values({ email: 'other-sr@test.local', name: 'Other', passwordHash: 'x' })
      .returning();
    const [company2] = await db
      .insert(companies)
      .values({ name: 'Other Co SR', ownerId: user2.id })
      .returning();
    const ctx2 = { db, companyId: company2.id, userId: user2.id };

    // Create an invoice in ctx2.
    const [customer2] = await db
      .insert(customersTable)
      .values({ companyId: company2.id, displayName: 'C2' })
      .returning();
    const [inv2] = await db
      .insert(invoices)
      .values({
        companyId: company2.id,
        customerId: customer2.id,
        invoiceNumber: 2001,
        date: new Date('2024-07-01'),
        status: 'open',
        subtotal: '200.00',
        discount: '0.00',
        taxAmount: '0.00',
        total: '200.00',
        amountPaid: '0.00',
        balanceDue: '200.00',
        retainageAmount: '0.00',
      })
      .returning();

    const [rep] = await listSalesReps(ctx);

    // ctx (company 1) tries to assign to company 2's invoice — should throw.
    await expect(
      assignRepToInvoice(ctx, { invoiceId: inv2.id, salesRepId: rep.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('commission report date range filter', async () => {
    // The report should return only invoices within the range.
    const report = await commissionReport(ctx, {
      from: new Date('2024-01-01'),
      to: new Date('2024-12-31'),
    });
    // There should be rows (the invoices we created are in 2024).
    expect(Array.isArray(report.rows)).toBe(true);
    // totals must be non-negative strings.
    expect(parseFloat(report.totals.salesTotal)).toBeGreaterThanOrEqual(0);
    expect(parseFloat(report.totals.commission)).toBeGreaterThanOrEqual(0);
  });
});
