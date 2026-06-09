/**
 * Integration tests for the OPEN-ITEM statement format and batch statement
 * generation added to statements.ts.
 *
 * Uses an isolated PGlite throwaway directory. Verifies:
 *  - openItemStatement: only open invoices, per-invoice aging buckets,
 *    aging summary footer, total due, partial payments
 *  - batchStatements: one entry per customer with something to report,
 *    in both balance_forward and open_item formats
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, customers, invoices, paymentsReceived } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { batchStatements, openItemStatement } from './statements';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-stmt-openitem-b3e8');
let ctx: ServiceContext;
let db: DB;
let acmeId: string;
let zeroId: string;

// Statement date: 2026-06-01.
const AS_OF = new Date('2026-06-01T00:00:00.000Z');

describe('open-item statements + batch (integration)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'owner@openitem.test', name: 'Owner', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Open Item Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    const [acme] = await db
      .insert(customers)
      .values({ companyId: company.id, displayName: 'Acme Corp' })
      .returning();
    acmeId = acme.id;

    // Customer with no open items and no activity — excluded from batches.
    const [zero] = await db
      .insert(customers)
      .values({ companyId: company.id, displayName: 'Zero Zoe' })
      .returning();
    zeroId = zero.id;

    // Inactive customer — never included in batches.
    await db.insert(customers).values({
      companyId: company.id,
      displayName: 'Inactive Ivan',
      isActive: false,
    });

    await db.insert(invoices).values([
      // Current: due in the future as of AS_OF.
      {
        companyId: company.id,
        customerId: acmeId,
        invoiceNumber: 1,
        date: new Date('2026-05-20T00:00:00.000Z'),
        dueDate: new Date('2026-06-19T00:00:00.000Z'),
        status: 'open',
        subtotal: '100.00',
        total: '100.00',
        amountPaid: '0.00',
        balanceDue: '100.00',
      },
      // 45 days past due, partially paid ($150 of $400 remains).
      {
        companyId: company.id,
        customerId: acmeId,
        invoiceNumber: 2,
        date: new Date('2026-03-18T00:00:00.000Z'),
        dueDate: new Date('2026-04-17T00:00:00.000Z'),
        status: 'partial',
        subtotal: '400.00',
        total: '400.00',
        amountPaid: '250.00',
        balanceDue: '150.00',
      },
      // 120 days past due, no due date set — falls back to the invoice date.
      {
        companyId: company.id,
        customerId: acmeId,
        invoiceNumber: 3,
        date: new Date('2026-02-01T00:00:00.000Z'),
        dueDate: null,
        status: 'open',
        subtotal: '75.00',
        total: '75.00',
        amountPaid: '0.00',
        balanceDue: '75.00',
      },
      // Paid — excluded.
      {
        companyId: company.id,
        customerId: acmeId,
        invoiceNumber: 4,
        date: new Date('2026-01-01T00:00:00.000Z'),
        dueDate: new Date('2026-01-31T00:00:00.000Z'),
        status: 'paid',
        subtotal: '999.00',
        total: '999.00',
        amountPaid: '999.00',
        balanceDue: '0.00',
      },
      // Void — excluded.
      {
        companyId: company.id,
        customerId: acmeId,
        invoiceNumber: 5,
        date: new Date('2026-01-05T00:00:00.000Z'),
        dueDate: new Date('2026-02-04T00:00:00.000Z'),
        status: 'void',
        subtotal: '500.00',
        total: '500.00',
        amountPaid: '0.00',
        balanceDue: '500.00',
      },
      // Dated AFTER the statement date — excluded as of AS_OF.
      {
        companyId: company.id,
        customerId: acmeId,
        invoiceNumber: 6,
        date: new Date('2026-06-15T00:00:00.000Z'),
        dueDate: new Date('2026-07-15T00:00:00.000Z'),
        status: 'open',
        subtotal: '60.00',
        total: '60.00',
        amountPaid: '0.00',
        balanceDue: '60.00',
      },
    ]);

    // A payment so the balance-forward batch has activity to show.
    await db.insert(paymentsReceived).values({
      companyId: company.id,
      customerId: acmeId,
      date: new Date('2026-05-01T00:00:00.000Z'),
      method: 'check',
      reference: 'CHK-9',
      amount: '250.00',
      unapplied: '0',
    });
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // openItemStatement
  // -------------------------------------------------------------------------

  it('lists only open invoices as of the statement date, oldest first', async () => {
    const stmt = await openItemStatement(ctx, acmeId, AS_OF);
    expect(stmt.asOf).toBe('2026-06-01');
    expect(stmt.lines.map((l) => l.invoiceNumber)).toEqual([3, 2, 1]);
  });

  it('computes days past due and aging buckets per invoice', async () => {
    const stmt = await openItemStatement(ctx, acmeId, AS_OF);
    const byNum = new Map(stmt.lines.map((l) => [l.invoiceNumber, l]));

    // #1: due 2026-06-19 — not yet due.
    expect(byNum.get(1)!.daysPastDue).toBe(0);
    expect(byNum.get(1)!.agingBucket).toBe('current');

    // #2: due 2026-04-17, 45 days late, partial.
    expect(byNum.get(2)!.daysPastDue).toBe(45);
    expect(byNum.get(2)!.agingBucket).toBe('31-60');
    expect(byNum.get(2)!.amountPaid).toBe('250.00');
    expect(byNum.get(2)!.balanceDue).toBe('150.00');

    // #3: no dueDate — falls back to invoice date 2026-02-01 (120 days).
    expect(byNum.get(3)!.daysPastDue).toBe(120);
    expect(byNum.get(3)!.agingBucket).toBe('90+');
    expect(byNum.get(3)!.dueDate).toBe('2026-02-01');
  });

  it('produces an aging summary footer that ties to the total due', async () => {
    const stmt = await openItemStatement(ctx, acmeId, AS_OF);
    expect(stmt.aging.current).toBe('100.00');
    expect(stmt.aging.days1_30).toBe('0.00');
    expect(stmt.aging.days31_60).toBe('150.00');
    expect(stmt.aging.days61_90).toBe('0.00');
    expect(stmt.aging.days90Plus).toBe('75.00');
    expect(stmt.totalDue).toBe('325.00');
  });

  it('returns an empty, zero-total statement for a customer with no open items', async () => {
    const stmt = await openItemStatement(ctx, zeroId, AS_OF);
    expect(stmt.lines).toHaveLength(0);
    expect(stmt.totalDue).toBe('0.00');
  });

  it('throws NOT_FOUND for a foreign/unknown customer', async () => {
    await expect(
      openItemStatement(ctx, '00000000-0000-0000-0000-000000000000', AS_OF),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // batchStatements
  // -------------------------------------------------------------------------

  it('open_item batch includes only customers with open invoices', async () => {
    const batch = await batchStatements(ctx, { format: 'open_item', asOf: AS_OF });
    expect(batch).toHaveLength(1);
    expect(batch[0].displayName).toBe('Acme Corp');
    expect(batch[0].format).toBe('open_item');
    if (batch[0].format === 'open_item') {
      expect(batch[0].statement.totalDue).toBe('325.00');
    }
  });

  it('balance_forward batch includes customers with balances or activity, skips empty ones', async () => {
    const batch = await batchStatements(ctx, { format: 'balance_forward' });
    expect(batch.map((b) => b.displayName)).toEqual(['Acme Corp']);
    expect(batch[0].format).toBe('balance_forward');
    if (batch[0].format === 'balance_forward') {
      // 100 + 400 + 75 + 999 + 60 invoices (non-void) − 250 payment − 999 paid… the
      // balance-forward closing balance is charges minus payments received:
      // (100+400+75+999+60) − 250 = 1384.00
      expect(batch[0].statement.closingBalance).toBe('1384.00');
    }
  });
});
