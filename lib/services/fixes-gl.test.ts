/**
 * Regression tests for the GL fix package:
 *  - createAccount/updateAccount subtype validation (invalid enum -> VALIDATION, not a 500)
 *  - createAccount openingBalance posts a balanced JE against Opening Balance Equity
 *  - parentId validation (self / cyclic / cross-company) + getAccountTree cycle hardening
 *  - sourceRef exposed via getEntry / listEntries / generalLedger
 *  - getAuditLog returns oldValues/newValues (powers the new /api/audit-trail/[id] route)
 *  - reopenPeriod unlocks a closed period (exposed via PATCH /api/fiscal-periods/[id])
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts, journalEntries } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import {
  createAccount,
  updateAccount,
  getAccountTree,
  listAccounts,
} from './accounts';
import { postJournalEntry } from './posting';
import { getEntry, listEntries, generalLedger } from './journal';
import { getAuditLog, listAuditLogs } from './auditTrail';
import { closePeriod, reopenPeriod } from './fiscalPeriods';
import { verifyIntegrity } from './integrity';
import { trialBalance } from './reports';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-fixes-gl');

let ctx: ServiceContext;
let ctx2: ServiceContext; // second company for tenancy tests
let db: DB;

describe('GL fix package regressions', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [u] = await db
      .insert(users)
      .values({ email: 'gl-fixes@test.local', name: 'GL Fixes', passwordHash: 'x' })
      .returning();
    const [c] = await db.insert(companies).values({ name: 'GL Fix Co', ownerId: u.id }).returning();
    ctx = { db, companyId: c.id, userId: u.id };

    const [u2] = await db
      .insert(users)
      .values({ email: 'gl-fixes-2@test.local', name: 'GL Fixes 2', passwordHash: 'x' })
      .returning();
    const [c2] = await db
      .insert(companies)
      .values({ name: 'Other GL Co', ownerId: u2.id })
      .returning();
    ctx2 = { db, companyId: c2.id, userId: u2.id };
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Subtype validation
  // -------------------------------------------------------------------------

  it('rejects an invalid subtype with VALIDATION instead of a Postgres enum error', async () => {
    await expect(
      createAccount(ctx, { code: '9901', name: 'Bad Subtype', type: 'asset', subtype: 'asset' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createAccount(ctx, { code: '9902', name: 'Bad Subtype 2', type: 'asset', subtype: 'nope' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('maps a blank subtype to a per-type default and normalizes case/whitespace', async () => {
    const blank = await createAccount(ctx, {
      code: '9903',
      name: 'Blank Subtype',
      type: 'expense',
      subtype: '',
    });
    expect(blank.subtype).toBe('operating_expenses');

    const messy = await createAccount(ctx, {
      code: '9904',
      name: 'Messy Subtype',
      type: 'asset',
      subtype: '  Checking ',
    });
    expect(messy.subtype).toBe('checking');
  });

  it('updateAccount also validates subtype', async () => {
    const acct = await createAccount(ctx, {
      code: '9905',
      name: 'Update Subtype',
      type: 'revenue',
      subtype: 'sales',
    });
    await expect(updateAccount(ctx, acct.id, { subtype: 'not_a_subtype' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const updated = await updateAccount(ctx, acct.id, { subtype: 'service_revenue' });
    expect(updated.subtype).toBe('service_revenue');
  });

  // -------------------------------------------------------------------------
  // Opening balance posts a balanced JE against Opening Balance Equity
  // -------------------------------------------------------------------------

  it('posts a balanced opening-balance JE so cached balance, GL, and integrity agree', async () => {
    const acct = await createAccount(ctx, {
      code: '1050',
      name: 'OB Savings',
      type: 'asset',
      subtype: 'savings',
      openingBalance: 500,
    });
    expect(acct.balance).toBe('500.00');

    // Opening Balance Equity exists and carries the offset.
    const [obe] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.name, 'Opening Balance Equity')));
    expect(obe).toBeTruthy();
    expect(obe.type).toBe('equity');
    expect(obe.balance).toBe('500.00'); // credit-normal, credited 500

    // A posted, balanced JE exists with the account sourceRef.
    const [je] = await db
      .select()
      .from(journalEntries)
      .where(
        and(eq(journalEntries.companyId, ctx.companyId), eq(journalEntries.sourceRef, `account:${acct.id}`)),
      );
    expect(je).toBeTruthy();
    expect(je.status).toBe('posted');

    // Trial balance includes the opening amount (reports derive from the GL, not the cache).
    const tb = await trialBalance(ctx);
    const tbRow = tb.rows.find((r: { accountId: string }) => r.accountId === acct.id);
    expect(tbRow).toBeTruthy();

    // The app's own integrity checker passes (cached balance == GL).
    const integrity = await verifyIntegrity(ctx);
    const check2 = integrity.checks.find((c) => c.name.includes('Cached account balances'));
    expect(check2?.ok).toBe(true);
  });

  it('handles credit-normal types and negative opening balances correctly', async () => {
    const liab = await createAccount(ctx, {
      code: '2050',
      name: 'OB Loan',
      type: 'liability',
      subtype: 'long_term_liability',
      openingBalance: '300.00',
    });
    expect(liab.balance).toBe('300.00');

    const overdrawn = await createAccount(ctx, {
      code: '1060',
      name: 'OB Overdrawn',
      type: 'asset',
      subtype: 'checking',
      openingBalance: -75,
    });
    expect(overdrawn.balance).toBe('-75.00');

    const integrity = await verifyIntegrity(ctx);
    const check1 = integrity.checks.find((c) => c.name.includes('Journal entries balanced'));
    const check2 = integrity.checks.find((c) => c.name.includes('Cached account balances'));
    expect(check1?.ok).toBe(true);
    expect(check2?.ok).toBe(true);
  });

  it('a zero opening balance creates no journal entry', async () => {
    const acct = await createAccount(ctx, {
      code: '1070',
      name: 'No OB',
      type: 'asset',
      subtype: 'checking',
    });
    expect(acct.balance).toBe('0.00');
    const jes = await db
      .select()
      .from(journalEntries)
      .where(
        and(eq(journalEntries.companyId, ctx.companyId), eq(journalEntries.sourceRef, `account:${acct.id}`)),
      );
    expect(jes.length).toBe(0);
  });

  // -------------------------------------------------------------------------
  // parentId validation + tree hardening
  // -------------------------------------------------------------------------

  it('rejects self, cyclic, and cross-company parentIds; accepts a valid reparent', async () => {
    const a = await createAccount(ctx, { code: '7000', name: 'Parent A', type: 'expense', subtype: 'operating_expenses' });
    const b = await createAccount(ctx, { code: '7010', name: 'Child B', type: 'expense', subtype: 'operating_expenses', parentId: a.id });
    const c = await createAccount(ctx, { code: '7020', name: 'Grandchild C', type: 'expense', subtype: 'operating_expenses', parentId: b.id });

    // Self-parent
    await expect(updateAccount(ctx, a.id, { parentId: a.id })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    // Cycle: A under its own grandchild
    await expect(updateAccount(ctx, a.id, { parentId: c.id })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    // Cross-company parent
    const foreign = await createAccount(ctx2, { code: '7000', name: 'Foreign', type: 'expense', subtype: 'operating_expenses' });
    await expect(updateAccount(ctx, c.id, { parentId: foreign.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      createAccount(ctx, { code: '7030', name: 'Bad Parent', type: 'expense', subtype: 'operating_expenses', parentId: foreign.id }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Valid reparent: C directly under A
    const moved = await updateAccount(ctx, c.id, { parentId: a.id });
    expect(moved.parentId).toBe(a.id);
  });

  it('getAccountTree never loses accounts even with legacy cyclic data', async () => {
    const x = await createAccount(ctx, { code: '7100', name: 'Cycle X', type: 'expense', subtype: 'operating_expenses' });
    const y = await createAccount(ctx, { code: '7110', name: 'Cycle Y', type: 'expense', subtype: 'operating_expenses', parentId: x.id });
    // Simulate pre-existing bad data: close the cycle behind the service's back.
    await db.update(accounts).set({ parentId: y.id }).where(eq(accounts.id, x.id));

    const tree = await getAccountTree(ctx);
    const seen = new Set<string>();
    const stack = [...tree];
    while (stack.length) {
      const node = stack.pop()!;
      expect(seen.has(node.id)).toBe(false); // acyclic output
      seen.add(node.id);
      stack.push(...node.children);
    }
    const all = await listAccounts(ctx, { includeInactive: true });
    for (const acct of all) expect(seen.has(acct.id)).toBe(true);

    // Repair for subsequent tests.
    await db.update(accounts).set({ parentId: null }).where(eq(accounts.id, x.id));
  });

  // -------------------------------------------------------------------------
  // sourceRef exposure in journal APIs
  // -------------------------------------------------------------------------

  it('exposes sourceRef via getEntry, listEntries, and generalLedger', async () => {
    const cash = await createAccount(ctx, { code: '1000', name: 'Cash', type: 'asset', subtype: 'checking' });
    const sales = await createAccount(ctx, { code: '4000', name: 'Sales', type: 'revenue', subtype: 'sales' });

    const entry = await postJournalEntry(ctx, {
      date: new Date('2026-03-15'),
      description: 'Invoice posting',
      sourceRef: 'invoice:test-123',
      lines: [
        { accountId: cash.id, debit: '100.00' },
        { accountId: sales.id, credit: '100.00' },
      ],
    });

    const detail = await getEntry(ctx, entry.id);
    expect(detail.sourceRef).toBe('invoice:test-123');

    const listed = await listEntries(ctx);
    const row = listed.find((e) => e.id === entry.id);
    expect(row?.sourceRef).toBe('invoice:test-123');

    const [gl] = await generalLedger(ctx, { accountId: cash.id });
    const glLine = gl.lines.find((l) => l.journalEntryId === entry.id);
    expect(glLine?.sourceRef).toBe('invoice:test-123');
  });

  // -------------------------------------------------------------------------
  // Audit trail detail (powers /api/audit-trail/[id])
  // -------------------------------------------------------------------------

  it('getAuditLog returns oldValues/newValues for the before/after diff', async () => {
    const acct = await createAccount(ctx, { code: '7200', name: 'Audit Me', type: 'expense', subtype: 'operating_expenses' });
    await updateAccount(ctx, acct.id, { name: 'Audited' });

    const { rows } = await listAuditLogs(ctx, { entityType: 'account', action: 'update' });
    const listRow = rows.find((r) => r.entityId === acct.id);
    expect(listRow).toBeTruthy();
    // List view trims values...
    expect(listRow!.oldValues).toBeUndefined();
    // ...but the detail fetch includes them.
    const detail = await getAuditLog(ctx, listRow!.id);
    expect(detail.oldValues).toBeTruthy();
    expect(detail.newValues).toBeTruthy();
    expect((detail.oldValues as { name: string }).name).toBe('Audit Me');
    expect((detail.newValues as { name: string }).name).toBe('Audited');
  });

  // -------------------------------------------------------------------------
  // Reopen period (powers PATCH /api/fiscal-periods/[id])
  // -------------------------------------------------------------------------

  it('reopenPeriod unlocks a closed period for posting again', async () => {
    const cash = await listAccounts(ctx).then((rows) => rows.find((r) => r.code === '1000')!);
    const sales = await listAccounts(ctx).then((rows) => rows.find((r) => r.code === '4000')!);

    const period = await closePeriod(ctx, {
      periodStart: new Date('2025-06-01'),
      periodEnd: new Date('2025-06-30'),
    });

    const entry = {
      date: new Date('2025-06-15'),
      description: 'In closed period',
      lines: [
        { accountId: cash.id, debit: '10.00' },
        { accountId: sales.id, credit: '10.00' },
      ],
    };
    await expect(postJournalEntry(ctx, entry)).rejects.toMatchObject({ code: 'PERIOD_CLOSED' });

    await reopenPeriod(ctx, period.id);
    await expect(postJournalEntry(ctx, entry)).resolves.toBeTruthy();
  });
});
