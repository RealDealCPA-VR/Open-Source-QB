import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies, accounts } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { createEmployee } from './payroll';
import { trialBalance } from './reports';
import {
  createReport,
  listReports,
  getReport,
  submitReport,
  approveAndReimburse,
} from './expenseReports';

const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-expense-reports');
let ctx: ServiceContext;
let db: DB;
const acct: Record<string, string> = {};
let employeeId: string;

describe('Expense reports service (end-to-end)', () => {
  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'exprpt-owner@test.local', name: 'Exp Owner', passwordHash: 'x' })
      .returning();
    const [company] = await db
      .insert(companies)
      .values({ name: 'Expense Test Co', ownerId: user.id })
      .returning();
    ctx = { db, companyId: company.id, userId: user.id };

    // Seed GL accounts.
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking',           'asset',   'checking'],
      ['5100', 'Travel Expense',     'expense',  'operating_expenses'],
      ['5200', 'Meals & Entertain.', 'expense',  'operating_expenses'],
    ];
    for (const [code, name, type, subtype] of defs) {
      const row = await createAccount(ctx, { code, name, type: type as never, subtype });
      acct[code] = row.id;
    }

    // Create an employee for the reports.
    const emp = await createEmployee(ctx, {
      firstName: 'Alice',
      lastName: 'Smith',
      payType: 'salary',
      payRate: '60000.00',
    });
    employeeId = emp.id;
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // createReport
  // -------------------------------------------------------------------------

  it('creates an expense report in draft status with correct total', async () => {
    const report = await createReport(ctx, {
      employeeId,
      title: 'Q1 Travel',
      lines: [
        { accountId: acct['5100'], description: 'Flight to NYC', amount: '450.00' },
        { accountId: acct['5200'], description: 'Team dinner',   amount: '120.00' },
      ],
    });

    expect(report.status).toBe('draft');
    expect(report.total).toBe('570.00');
    expect(report.companyId).toBe(ctx.companyId);
    expect(report.employeeId).toBe(employeeId);
    expect(report.title).toBe('Q1 Travel');
    expect(report.postedEntryId).toBeNull();
  });

  it('rejects createReport with no lines', async () => {
    await expect(
      createReport(ctx, { employeeId, lines: [] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects createReport with a zero-amount line', async () => {
    await expect(
      createReport(ctx, {
        employeeId,
        lines: [{ accountId: acct['5100'], amount: '0' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects createReport with a negative-amount line', async () => {
    await expect(
      createReport(ctx, {
        employeeId,
        lines: [{ accountId: acct['5100'], amount: '-10.00' }],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects createReport for unknown employee', async () => {
    await expect(
      createReport(ctx, {
        employeeId: '00000000-0000-0000-0000-000000000000',
        lines: [{ accountId: acct['5100'], amount: '100.00' }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // -------------------------------------------------------------------------
  // listReports & getReport
  // -------------------------------------------------------------------------

  it('lists all reports for the company', async () => {
    const list = await listReports(ctx);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every((r) => r.companyId === ctx.companyId)).toBe(true);
  });

  it('getReport returns report with lines', async () => {
    const list = await listReports(ctx);
    const first = list[0];
    const fetched = await getReport(ctx, first.id);
    expect(fetched.id).toBe(first.id);
    expect(Array.isArray(fetched.lines)).toBe(true);
    expect(fetched.lines.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // submitReport
  // -------------------------------------------------------------------------

  it('submits a draft report', async () => {
    // Create a fresh report to submit.
    const report = await createReport(ctx, {
      employeeId,
      title: 'Submit Test',
      lines: [{ accountId: acct['5100'], amount: '100.00' }],
    });

    const submitted = await submitReport(ctx, report.id);
    expect(submitted.status).toBe('submitted');
    expect(submitted.submittedAt).toBeTruthy();
  });

  it('rejects submitting a non-draft report', async () => {
    // Create and submit.
    const report = await createReport(ctx, {
      employeeId,
      lines: [{ accountId: acct['5100'], amount: '50.00' }],
    });
    await submitReport(ctx, report.id);

    // Submit again — should fail.
    await expect(submitReport(ctx, report.id)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  // -------------------------------------------------------------------------
  // approveAndReimburse — main scenario
  // -------------------------------------------------------------------------

  it('approveAndReimburse posts a balanced GL entry (Dr expense / Cr Checking)', async () => {
    // Create report with two expense lines.
    const report = await createReport(ctx, {
      employeeId,
      title: 'Reimburse Test',
      lines: [
        { accountId: acct['5100'], description: 'Hotel', amount: '300.00' },
        { accountId: acct['5200'], description: 'Lunch', amount: '75.00' },
      ],
    });

    // Submit first.
    await submitReport(ctx, report.id);

    // Approve & reimburse.
    const reimbursed = await approveAndReimburse(ctx, report.id);
    expect(reimbursed.status).toBe('reimbursed');
    expect(reimbursed.postedEntryId).toBeTruthy();
    expect(reimbursed.total).toBe('375.00');

    // Verify account balance impact:
    //   Dr 5100 Travel Expense     +300.00
    //   Dr 5200 Meals              +75.00
    //   Cr 1000 Checking           -375.00 (asset; credit reduces it)
    const rows = await db
      .select({ code: accounts.code, balance: accounts.balance })
      .from(accounts)
      .where(eq(accounts.companyId, ctx.companyId));
    const bal = Object.fromEntries(rows.map((r) => [r.code, r.balance]));
    expect(bal['5100']).toBe('300.00');
    expect(bal['5200']).toBe('75.00');
    // Checking started at 0; credit of 375 reduces it.
    expect(bal['1000']).toBe('-375.00');
  });

  it('trial balance is balanced after reimbursement posting', async () => {
    const tb = await trialBalance(ctx);
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
  });

  it('reimbursed report includes lines', async () => {
    const list = await listReports(ctx);
    const reimbursed = list.find((r) => r.status === 'reimbursed');
    expect(reimbursed).toBeTruthy();

    const full = await getReport(ctx, reimbursed!.id);
    expect(full.lines.length).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Edge cases for approveAndReimburse
  // -------------------------------------------------------------------------

  it('rejects reimbursing a draft report directly', async () => {
    const report = await createReport(ctx, {
      employeeId,
      lines: [{ accountId: acct['5100'], amount: '20.00' }],
    });
    // Attempt to reimburse without submitting first.
    await expect(approveAndReimburse(ctx, report.id)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects reimbursing an already reimbursed report', async () => {
    // Find the already-reimbursed report.
    const list = await listReports(ctx);
    const reimbursed = list.find((r) => r.status === 'reimbursed');
    expect(reimbursed).toBeTruthy();

    await expect(approveAndReimburse(ctx, reimbursed!.id)).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});
