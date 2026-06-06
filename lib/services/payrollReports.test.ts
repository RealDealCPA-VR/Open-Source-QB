/**
 * Integration tests for payrollReports: w2Data and form941Data.
 *
 * Boots a dedicated throwaway PGlite database, seeds the minimum accounts
 * and one employee, runs a paycheck (letting computeWithholding auto-fill the
 * tax lines), then asserts that w2Data aggregates wages and withholdings
 * correctly from the stored paycheckLines rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb, type DB } from '@/lib/db';
import { users, companies } from '@/lib/db/schema';
import type { ServiceContext } from './_base';
import { createAccount } from './accounts';
import { createEmployee, runPaycheck } from './payroll';
import { w2Data, form941Data } from './payrollReports';

// Unique data dir — must NOT collide with test-payroll used in payroll.test.ts.
const TEST_DIR = path.resolve(process.cwd(), '.bookkeeper-data', 'test-payroll-reports');

let ctx: ServiceContext;
let db: DB;
let employeeId: string;

describe('payrollReports — w2Data and form941Data', () => {
  // ---------------------------------------------------------------------------
  // Setup: seed DB, accounts, employee, and two paychecks.
  // ---------------------------------------------------------------------------

  beforeAll(async () => {
    db = await getDb(TEST_DIR);

    const [user] = await db
      .insert(users)
      .values({ email: 'reports-owner@test.local', name: 'Reports Owner', passwordHash: 'x' })
      .returning();

    const [company] = await db
      .insert(companies)
      .values({ name: 'Reports Test Co', ownerId: user.id })
      .returning();

    ctx = { db, companyId: company.id, userId: user.id };

    // Seed the three GL accounts required by runPaycheck.
    const defs: Array<[string, string, string, string]> = [
      ['1000', 'Checking',           'asset',     'checking'],
      ['2300', 'Payroll Liabilities', 'liability', 'long_term_liability'],
      ['6500', 'Payroll Expense',    'expense',   'payroll'],
    ];
    for (const [code, name, type, subtype] of defs) {
      await createAccount(ctx, { code, name, type: type as never, subtype });
    }

    // Seed one employee.
    const emp = await createEmployee(ctx, {
      firstName: 'Alice',
      lastName:  'Smith',
      payType:   'salary',
      payRate:   '52000.00',
    });
    employeeId = emp.id;

    // Run two paychecks in 2024 with auto-computed taxes (no explicit taxes param).
    // Gross $2000 per paycheck, biweekly (default periodsPerYear=26).
    await runPaycheck(ctx, {
      employeeId,
      payDate: new Date('2024-01-12'),
      periodStart: new Date('2024-01-01'),
      periodEnd:   new Date('2024-01-12'),
      grossPay: '2000.00',
      // taxes intentionally omitted → computeWithholding auto-fills
    });

    await runPaycheck(ctx, {
      employeeId,
      payDate: new Date('2024-01-26'),
      periodStart: new Date('2024-01-13'),
      periodEnd:   new Date('2024-01-26'),
      grossPay: '2000.00',
    });
  });

  afterAll(async () => {
    await closeDb(TEST_DIR);
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // w2Data tests
  // ---------------------------------------------------------------------------

  describe('w2Data', () => {
    it('returns wages equal to the sum of grossPay across paychecks in the year', async () => {
      const result = await w2Data(ctx, { employeeId, year: 2024 });

      // Two paychecks of $2000 each → wages = $4000.00
      expect(result.wages).toBe('4000.00');
    });

    it('returns the correct employee name', async () => {
      const result = await w2Data(ctx, { employeeId, year: 2024 });
      expect(result.employee.firstName).toBe('Alice');
      expect(result.employee.lastName).toBe('Smith');
    });

    it('returns the correct company name', async () => {
      const result = await w2Data(ctx, { employeeId, year: 2024 });
      expect(result.company.name).toBe('Reports Test Co');
    });

    it('returns federal withholding > 0 (auto-computed)', async () => {
      const result = await w2Data(ctx, { employeeId, year: 2024 });
      expect(parseFloat(result.federalWithheld)).toBeGreaterThan(0);
    });

    it('returns social security > 0 (auto-computed)', async () => {
      const result = await w2Data(ctx, { employeeId, year: 2024 });
      expect(parseFloat(result.socialSecurity)).toBeGreaterThan(0);
    });

    it('returns medicare > 0 (auto-computed)', async () => {
      const result = await w2Data(ctx, { employeeId, year: 2024 });
      expect(parseFloat(result.medicare)).toBeGreaterThan(0);
    });

    it('returns zeros for a year with no paychecks', async () => {
      const result = await w2Data(ctx, { employeeId, year: 2020 });
      expect(result.wages).toBe('0.00');
      expect(result.federalWithheld).toBe('0.00');
      expect(result.socialSecurity).toBe('0.00');
      expect(result.medicare).toBe('0.00');
    });

    it('throws NOT_FOUND for an unknown employee', async () => {
      await expect(
        w2Data(ctx, { employeeId: '00000000-0000-0000-0000-000000000000', year: 2024 }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  // ---------------------------------------------------------------------------
  // form941Data tests
  // ---------------------------------------------------------------------------

  describe('form941Data', () => {
    it('returns total wages for Q1 2024', async () => {
      const result = await form941Data(ctx, { quarter: 1, year: 2024 });
      // Both paychecks are in January → Q1
      expect(result.totals.wages).toBe('4000.00');
    });

    it('returns federal withheld > 0 for Q1 2024', async () => {
      const result = await form941Data(ctx, { quarter: 1, year: 2024 });
      expect(parseFloat(result.totals.federalWithheld)).toBeGreaterThan(0);
    });

    it('returns zeros for a quarter with no paychecks', async () => {
      const result = await form941Data(ctx, { quarter: 3, year: 2024 });
      expect(result.totals.wages).toBe('0.00');
      expect(result.totals.federalWithheld).toBe('0.00');
    });

    it('returns correct quarter and year metadata', async () => {
      const result = await form941Data(ctx, { quarter: 1, year: 2024 });
      expect(result.quarter).toBe(1);
      expect(result.year).toBe(2024);
      expect(result.company.name).toBe('Reports Test Co');
    });
  });
});
