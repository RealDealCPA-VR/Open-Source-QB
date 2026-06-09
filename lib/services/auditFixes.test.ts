/**
 * Regression tests for the security/correctness fixes from the codebase audit.
 *
 * These cover the pure, dependency-free fixes (no DB harness needed):
 *   - posting.assertBalanced now rounds each line to 2dp and requires EXACT balance.
 *   - auth tokens are bound to an audience ('user' vs 'portal') and not interchangeable.
 *   - CSV import honors a declared dateFormat instead of guessing.
 *   - federal withholding subtracts the standard deduction (no longer over-withholds gross).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { assertBalanced } from './posting';
import { parseCSV } from './import';
import { computeWithholding } from './payrollTax';
import { createSessionToken, verifySessionToken } from '@/lib/auth';

describe('assertBalanced — rounds per line and requires exact balance', () => {
  it('accepts an exactly-balanced 2dp entry', () => {
    expect(() =>
      assertBalanced([
        { accountId: 'a', debit: '100.00' },
        { accountId: 'b', credit: '100.00' },
      ]),
    ).not.toThrow();
  });

  it('rejects an entry that only balances on the raw (sub-cent) totals but not after per-line rounding', () => {
    // Raw: 33.334 * 3 = 100.002 ≈ 100.00 within the old half-cent tolerance, but each line
    // rounds to 33.33 and the stored debit total (99.99) would not equal the 100.00 credit.
    expect(() =>
      assertBalanced([
        { accountId: 'a', debit: '33.334' },
        { accountId: 'b', debit: '33.334' },
        { accountId: 'c', debit: '33.334' },
        { accountId: 'd', credit: '100.00' },
      ]),
    ).toThrowError(/out of balance/i);
  });
});

describe('session tokens are audience-bound', () => {
  beforeAll(() => {
    process.env.BKA_AUTH_SECRET = 'audit-fixes-secret';
  });

  it('a portal token is not accepted as a main-app session', () => {
    const portalToken = createSessionToken('emp-1', 'portal');
    expect(verifySessionToken(portalToken, 'portal')).toEqual({ userId: 'emp-1' });
    // Default expectedKind is 'user' — a portal token must be rejected there.
    expect(verifySessionToken(portalToken)).toBeNull();
  });

  it('a user token is not accepted as a portal session', () => {
    const userToken = createSessionToken('user-1'); // defaults to kind 'user'
    expect(verifySessionToken(userToken)).toEqual({ userId: 'user-1' });
    expect(verifySessionToken(userToken, 'portal')).toBeNull();
  });
});

describe('CSV import honors a declared dateFormat', () => {
  it('parses DD/MM/YYYY unambiguously', () => {
    const csv = 'Date,Description,Amount\n03/04/2024,Coffee,-5.00\n';
    const [txn] = parseCSV(csv, {
      dateCol: 'Date',
      descriptionCol: 'Description',
      amountCol: 'Amount',
      dateFormat: 'DD/MM/YYYY',
    });
    // 03/04/2024 with DD/MM/YYYY is the 3rd of April, not March 4th.
    expect(txn.date.getUTCFullYear()).toBe(2024);
    expect(txn.date.getUTCMonth()).toBe(3); // April (0-based)
    expect(txn.date.getUTCDate()).toBe(3);
  });

  it('rejects a value that does not match the declared format', () => {
    const csv = 'Date,Description,Amount\nnot-a-date,Coffee,-5.00\n';
    expect(() =>
      parseCSV(csv, {
        dateCol: 'Date',
        descriptionCol: 'Description',
        amountCol: 'Amount',
        dateFormat: 'DD/MM/YYYY',
      }),
    ).toThrowError(/cannot parse date/i);
  });
});

describe('federal withholding subtracts the standard deduction', () => {
  it('a modest single earner withholds less than the raw-bracket-on-gross amount', () => {
    // $1,000/wk single → $52,000 annual. With the $14,600 deduction the taxable base is
    // $37,400, so withholding must be materially less than 10–12% of the full $52,000.
    const r = computeWithholding({ grossPerPeriod: 1000, periodsPerYear: 52, filingStatus: 'single' });
    const annualFederal = parseFloat(r.federalIncomeTax) * 52;
    expect(annualFederal).toBeGreaterThan(0);
    // Tax on $37,400 (after deduction) ≈ $4,256; on the full $52,000 it would be ≈ $6,053.
    expect(annualFederal).toBeLessThan(5000);
  });
});
