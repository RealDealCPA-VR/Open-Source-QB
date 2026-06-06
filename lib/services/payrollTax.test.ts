/**
 * Unit tests for payrollTax.ts — pure computation, no DB required.
 */
import { describe, it, expect } from 'vitest';
import { computeFederalIncomeTax, computeWithholding } from './payrollTax';
import Decimal from 'decimal.js';

// ---------------------------------------------------------------------------
// computeFederalIncomeTax
// ---------------------------------------------------------------------------

describe('computeFederalIncomeTax', () => {
  it('returns zero for zero income', () => {
    const result = computeFederalIncomeTax({ annualTaxable: 0, filingStatus: 'single' });
    expect(result.toNumber()).toBe(0);
  });

  it('returns zero for negative income', () => {
    const result = computeFederalIncomeTax({ annualTaxable: -500, filingStatus: 'single' });
    expect(result.toNumber()).toBe(0);
  });

  it('single: income in 10% bracket', () => {
    // $10,000 is below the 12% threshold ($11,600), so flat 10%
    const result = computeFederalIncomeTax({ annualTaxable: 10000, filingStatus: 'single' });
    expect(result.toNumber()).toBeCloseTo(1000, 1);
  });

  it('single: income in 22% bracket produces more tax than the floor', () => {
    // $60,000 is in the 22% bracket (min: $47,150, base: $5,426)
    const result = computeFederalIncomeTax({ annualTaxable: 60000, filingStatus: 'single' });
    const expected = 5426 + (60000 - 47150) * 0.22; // $8,263
    expect(result.toNumber()).toBeCloseTo(expected, 1);
  });

  it('married: lower tax than single on the same income', () => {
    const single  = computeFederalIncomeTax({ annualTaxable: 100000, filingStatus: 'single' });
    const married = computeFederalIncomeTax({ annualTaxable: 100000, filingStatus: 'married' });
    expect(married.lessThan(single)).toBe(true);
  });

  it('brackets are monotonically increasing (single): higher income → higher tax', () => {
    const incomes = [0, 10000, 50000, 100000, 200000, 250000, 650000, 800000];
    let previous = new Decimal(0);
    for (const income of incomes) {
      const tax = computeFederalIncomeTax({ annualTaxable: income, filingStatus: 'single' });
      expect(tax.greaterThanOrEqualTo(previous)).toBe(true);
      previous = tax;
    }
  });

  it('brackets are monotonically increasing (married): higher income → higher tax', () => {
    const incomes = [0, 20000, 50000, 100000, 200000, 400000, 500000, 750000, 1000000];
    let previous = new Decimal(0);
    for (const income of incomes) {
      const tax = computeFederalIncomeTax({ annualTaxable: income, filingStatus: 'married' });
      expect(tax.greaterThanOrEqualTo(previous)).toBe(true);
      previous = tax;
    }
  });

  it('effective rate increases with income (single)', () => {
    const incomes = [20000, 60000, 150000, 300000];
    let previousRate = -1;
    for (const income of incomes) {
      const tax = computeFederalIncomeTax({ annualTaxable: income, filingStatus: 'single' });
      const effectiveRate = tax.dividedBy(income).toNumber();
      expect(effectiveRate).toBeGreaterThan(previousRate);
      previousRate = effectiveRate;
    }
  });
});

// ---------------------------------------------------------------------------
// computeWithholding — FICA checks
// ---------------------------------------------------------------------------

describe('computeWithholding — Social Security', () => {
  it('SS = grossPerPeriod * 0.062 when annual wages are below the wage base', () => {
    // $3,000/period × 26 periods = $78,000 annual (below $168,600 wage base)
    const result = computeWithholding({ grossPerPeriod: 3000, periodsPerYear: 26, filingStatus: 'single' });
    const expectedSS = (3000 * 0.062).toFixed(2); // $186.00
    expect(result.socialSecurity).toBe(expectedSS);
  });

  it('SS is capped at wage base — very high earner pays less than 6.2% of gross', () => {
    // $20,000/period × 26 = $520,000 annual (well above $168,600 wage base)
    const result = computeWithholding({ grossPerPeriod: 20000, periodsPerYear: 26, filingStatus: 'single' });
    // Capped annual SS = 168600 * 0.062 = $10,453.20; per period = $10,453.20 / 26 = $402.05
    const annualSSCapped = 168600 * 0.062;
    const expectedSS = (annualSSCapped / 26).toFixed(2);
    expect(result.socialSecurity).toBe(expectedSS);
  });
});

describe('computeWithholding — Medicare', () => {
  it('Medicare = grossPerPeriod * 0.0145 for wages below $200,000 annual', () => {
    // $5,000/period × 12 = $60,000 annual
    const result = computeWithholding({ grossPerPeriod: 5000, periodsPerYear: 12, filingStatus: 'single' });
    const expectedMedicare = (5000 * 0.0145).toFixed(2); // $72.50
    expect(result.medicare).toBe(expectedMedicare);
  });

  it('Medicare includes Additional Medicare Tax (0.9%) on wages above $200,000', () => {
    // $250,000 annual (single payment, 1 period per year)
    // Base: 250000 * 0.0145 = $3,625
    // Additional: (250000 - 200000) * 0.009 = $450
    // Total: $4,075
    const result = computeWithholding({ grossPerPeriod: 250000, periodsPerYear: 1, filingStatus: 'single' });
    expect(parseFloat(result.medicare)).toBeCloseTo(4075, 1);
  });
});

describe('computeWithholding — integration', () => {
  it('federal income tax > 0 for a typical earner (single, $5,000/period biweekly)', () => {
    const result = computeWithholding({ grossPerPeriod: 5000, periodsPerYear: 26, filingStatus: 'single' });
    expect(parseFloat(result.federalIncomeTax)).toBeGreaterThan(0);
  });

  it('net = grossPerPeriod - totalPerPeriod', () => {
    const gross = 4500;
    const result = computeWithholding({ grossPerPeriod: gross, periodsPerYear: 24, filingStatus: 'married' });
    const expectedNet = (gross - parseFloat(result.totalPerPeriod)).toFixed(2);
    expect(result.net).toBe(expectedNet);
  });

  it('totalPerPeriod = federalIncomeTax + socialSecurity + medicare', () => {
    const result = computeWithholding({ grossPerPeriod: 3500, periodsPerYear: 52, filingStatus: 'single' });
    const sum = (
      parseFloat(result.federalIncomeTax) +
      parseFloat(result.socialSecurity) +
      parseFloat(result.medicare)
    ).toFixed(2);
    expect(result.totalPerPeriod).toBe(sum);
  });

  it('married filing has less federal income tax than single at the same income', () => {
    const single  = computeWithholding({ grossPerPeriod: 6000, periodsPerYear: 26, filingStatus: 'single' });
    const married = computeWithholding({ grossPerPeriod: 6000, periodsPerYear: 26, filingStatus: 'married' });
    expect(parseFloat(married.federalIncomeTax)).toBeLessThan(parseFloat(single.federalIncomeTax));
  });

  it('returns decimal strings with 2 decimal places', () => {
    const result = computeWithholding({ grossPerPeriod: 2750, periodsPerYear: 26, filingStatus: 'single' });
    const twoDecimalPattern = /^\d+\.\d{2}$/;
    expect(result.federalIncomeTax).toMatch(twoDecimalPattern);
    expect(result.socialSecurity).toMatch(twoDecimalPattern);
    expect(result.medicare).toMatch(twoDecimalPattern);
    expect(result.totalPerPeriod).toMatch(twoDecimalPattern);
    expect(result.net).toMatch(twoDecimalPattern);
  });
});
