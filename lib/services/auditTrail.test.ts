/**
 * Integration tests for the Audit Trail service.
 *
 * Uses a throwaway PGlite directory (UNIQUE per test run so parallel tests don't collide).
 * Exercises listAuditLogs + getAuditLog after performing audited mutations via existing
 * services (createAccount, updateAccount).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { ServiceError } from './_base';
import { createAccount, updateAccount } from './accounts';
import { listAuditLogs, getAuditLog } from './auditTrail';
import { trialBalance } from './reports';
import { postJournalEntry } from './posting';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-audit-trail');

let ctx: ServiceContext;
let ctx2: ServiceContext; // isolation
let db: DB;
const acct: Record<string, string> = {};

describe('Audit Trail service (integration)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    // ----- Company A -----
    const [user] = await db
      .insert(users)
      .values({ email: 'audit-owner@test.local', name: 'Audit Owner', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Audit Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // ----- Company B (isolation) -----
    const [user2] = await db
      .insert(users)
      .values({ email: 'audit-other@test.local', name: 'Other Owner', passwordHash: 'x' })
      .returning();
    const [company2] = await db
      .insert(companies)
      .values({ name: 'Other Audit Co', ownerId: user2.id })
      .returning();
    ctx2 = { db, companyId: company2.id, userId: user2.id };

    // Seed accounts needed for GL checks.
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking', 'asset', 'checking'],
      ['3000', "Owner's Equity", 'equity', 'owners_equity'],
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
  // listAuditLogs — basic presence
  // -------------------------------------------------------------------------

  it('createAccount writes an audit log that listAuditLogs returns', async () => {
    const { rows } = await listAuditLogs(ctx);
    // We created 2 accounts in beforeAll — at least those logs must be present.
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.entityType === 'account')).toBe(true);
    expect(rows.every((r) => r.action === 'create')).toBe(true);
  });

  it('listAuditLogs returns newest first', async () => {
    // Create a third account to generate another log entry.
    await createAccount(ctx, {
      code: '2000',
      name: 'Accounts Payable',
      type: 'liability',
      subtype: 'accounts_payable',
    });

    const { rows } = await listAuditLogs(ctx);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    // Sorted descending by createdAt.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].createdAt >= rows[i].createdAt).toBe(true);
    }
  });

  it('listAuditLogs includes the actor name', async () => {
    const { rows } = await listAuditLogs(ctx);
    expect(rows.every((r) => r.actorName === 'Audit Owner')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------

  it('filters by entityType', async () => {
    // Inject an entry for a different entityType via a journal entry (which also
    // writes an audit log with entityType = "journal_entry").
    await postJournalEntry(ctx, {
      date: new Date('2025-01-15'),
      description: 'Seed entry for audit filter test',
      lines: [
        { accountId: acct['1000'], debit: '100.00' },
        { accountId: acct['3000'], credit: '100.00' },
      ],
    });

    const { rows: accountRows } = await listAuditLogs(ctx, { entityType: 'account' });
    expect(accountRows.every((r) => r.entityType === 'account')).toBe(true);

    const { rows: jeRows } = await listAuditLogs(ctx, { entityType: 'journal_entry' });
    expect(jeRows.every((r) => r.entityType === 'journal_entry')).toBe(true);
    expect(jeRows.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by action', async () => {
    // updateAccount produces an "update" audit log.
    const [existing] = (await listAuditLogs(ctx, { entityType: 'account' })).rows;
    await updateAccount(ctx, existing.entityId, { description: 'audit filter test' });

    const { rows: createRows } = await listAuditLogs(ctx, { action: 'create' });
    expect(createRows.every((r) => r.action === 'create')).toBe(true);

    const { rows: updateRows } = await listAuditLogs(ctx, { action: 'update' });
    expect(updateRows.length).toBeGreaterThanOrEqual(1);
    expect(updateRows.every((r) => r.action === 'update')).toBe(true);
  });

  it('filters by date range (from / to)', async () => {
    const from = new Date('2000-01-01');
    const to = new Date('2000-12-31');
    // No activity existed in year 2000 — should return 0 rows.
    const { rows, total } = await listAuditLogs(ctx, { from, to });
    expect(rows.length).toBe(0);
    expect(total).toBe(0);
  });

  it('pagination: limit + offset work correctly', async () => {
    const { rows: all, total } = await listAuditLogs(ctx, { limit: 100, offset: 0 });
    expect(total).toBeGreaterThanOrEqual(4);

    const { rows: page1 } = await listAuditLogs(ctx, { limit: 2, offset: 0 });
    const { rows: page2 } = await listAuditLogs(ctx, { limit: 2, offset: 2 });

    expect(page1.length).toBe(2);
    // Pages must not overlap.
    const ids1 = new Set(page1.map((r) => r.id));
    const ids2 = new Set(page2.map((r) => r.id));
    expect([...ids1].some((id) => ids2.has(id))).toBe(false);

    // Together they match the first 4 of all.
    const combinedIds = [...page1, ...page2].map((r) => r.id);
    expect(combinedIds).toEqual(all.slice(0, 4).map((r) => r.id));
  });

  // -------------------------------------------------------------------------
  // getAuditLog — detail view with old/new values
  // -------------------------------------------------------------------------

  it('getAuditLog returns oldValues + newValues for an update entry', async () => {
    const { rows: updateRows } = await listAuditLogs(ctx, { action: 'update' });
    expect(updateRows.length).toBeGreaterThanOrEqual(1);

    const detail = await getAuditLog(ctx, updateRows[0].id);
    expect(detail.id).toBe(updateRows[0].id);
    // The updateAccount call always stores both old and new values.
    expect(detail.oldValues).toBeDefined();
    expect(detail.newValues).toBeDefined();
    expect(detail.oldValues).not.toBeNull();
    expect(detail.newValues).not.toBeNull();
  });

  it('getAuditLog throws NOT_FOUND for an unknown id', async () => {
    await expect(
      getAuditLog(ctx, '00000000-0000-0000-0000-000000000099'),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // Multi-tenant isolation
  // -------------------------------------------------------------------------

  it('listAuditLogs does not return entries from another company', async () => {
    // Create something in company B to generate a log.
    await createAccount(ctx2, {
      code: '1000',
      name: 'Checking B',
      type: 'asset',
      subtype: 'checking',
    });

    const { rows } = await listAuditLogs(ctx);
    // All rows must belong to company A — we cannot directly verify companyId from the
    // returned shape, but we can check no actorName from company B leaks in (company B
    // actor is "Other Owner").
    expect(rows.some((r) => r.actorName === 'Other Owner')).toBe(false);
  });

  it('getAuditLog throws NOT_FOUND when accessing another company\'s entry', async () => {
    // Get an entry that belongs to company B.
    const { rows: b2rows } = await listAuditLogs(ctx2);
    expect(b2rows.length).toBeGreaterThanOrEqual(1);

    // Company A context must not be able to retrieve company B's log.
    await expect(getAuditLog(ctx, b2rows[0].id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  // -------------------------------------------------------------------------
  // Trial balance stays balanced
  // -------------------------------------------------------------------------

  it('trial balance is balanced after all audit-generating operations', async () => {
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
  });
});
