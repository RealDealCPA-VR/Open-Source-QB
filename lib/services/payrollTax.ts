/**
 * Federal payroll tax withholding calculator — 2024 IRS Publication 15-T figures.
 *
 * DISCLAIMER: These tables are a documented approximation of the 2024 IRS
 * percentage-method withholding brackets (Publication 15-T, Table for
 * Percentage Method Tables for Automated Payroll Systems). They are provided
 * for estimation purposes only. Always verify against the current official IRS
 * publication before filing or remitting taxes. Tax law changes frequently and
 * this code is NOT a substitute for professional tax advice.
 *
 * Sources encoded:
 *   - 2024 Federal income tax percentage-method brackets (annual, single + married)
 *   - Social Security wage base: $168,600 (2024)
 *   - Medicare rate: 1.45% (+ Additional Medicare Tax 0.9% over $200,000 annual)
 */

import { Money, toAmountString, toDecimal, type MoneyInput } from '@/lib/money';
import Decimal from 'decimal.js';

// ---------------------------------------------------------------------------
// 2024 IRS Percentage-Method Brackets (Annual, from Publication 15-T)
// Each bracket: [minimumIncome, taxOnAmountAtFloor, marginalRate]
// ---------------------------------------------------------------------------

interface TaxBracket {
  min: number;
  base: number;
  rate: number;
}

/**
 * 2024 annual federal income tax brackets — Single (and Married Filing Separately).
 * Source: IRS Publication 15-T, 2024 Percentage Method Tables.
 */
const SINGLE_BRACKETS: TaxBracket[] = [
  { min:       0, base:     0,       rate: 0.10 },
  { min:  11600, base:  1160,       rate: 0.12 },
  { min:  47150, base:  5426,       rate: 0.22 },
  { min: 100525, base: 17168.50,   rate: 0.24 },
  { min: 191950, base: 39110.50,   rate: 0.32 },
  { min: 243725, base: 55678.50,   rate: 0.35 },
  { min: 609350, base: 183647.25,  rate: 0.37 },
];

/**
 * 2024 annual federal income tax brackets — Married Filing Jointly.
 * Source: IRS Publication 15-T, 2024 Percentage Method Tables.
 */
const MARRIED_BRACKETS: TaxBracket[] = [
  { min:       0, base:     0,       rate: 0.10 },
  { min:  23200, base:  2320,       rate: 0.12 },
  { min:  94300, base: 10852,       rate: 0.22 },
  { min: 201050, base: 34337,       rate: 0.24 },
  { min: 383900, base: 78221,       rate: 0.32 },
  { min: 487450, base: 111357,      rate: 0.35 },
  { min: 731200, base: 196669.50,   rate: 0.37 },
];

/** Social Security wage base for 2024. */
const SS_WAGE_BASE = 168600;

/** Social Security employee rate (6.2%). */
const SS_RATE = new Decimal('0.062');

/** Medicare base rate (1.45%). */
const MEDICARE_BASE_RATE = new Decimal('0.0145');

/** Additional Medicare Tax rate (0.9%) above $200,000 annual wages. */
const ADDITIONAL_MEDICARE_RATE = new Decimal('0.009');

/** Annual wage threshold for Additional Medicare Tax. */
const ADDITIONAL_MEDICARE_THRESHOLD = 200000;

// ---------------------------------------------------------------------------
// Core computation functions
// ---------------------------------------------------------------------------

export type FilingStatus = 'single' | 'married';

export interface FederalIncomeTaxInput {
  /** Annual taxable wages (after any withholding allowances). */
  annualTaxable: MoneyInput;
  filingStatus: FilingStatus;
}

/**
 * Compute annual federal income tax using the IRS percentage-method brackets.
 * Returns the annual tax as a Decimal.
 */
export function computeFederalIncomeTax({
  annualTaxable,
  filingStatus,
}: FederalIncomeTaxInput): Decimal {
  const taxable = toDecimal(annualTaxable);
  if (taxable.lessThanOrEqualTo(0)) return new Decimal(0);

  const brackets = filingStatus === 'married' ? MARRIED_BRACKETS : SINGLE_BRACKETS;
  const taxableNum = taxable.toNumber();

  // Walk brackets from highest to find the applicable one
  for (let i = brackets.length - 1; i >= 0; i--) {
    const bracket = brackets[i];
    if (taxableNum >= bracket.min) {
      const excess = taxable.minus(bracket.min);
      const tax = new Decimal(bracket.base).plus(excess.times(bracket.rate));
      return Money.round2(tax);
    }
  }

  return new Decimal(0);
}

export interface WithholdingInput {
  /** Gross wages for this pay period (before any deductions), as a decimal string or number. */
  grossPerPeriod: number | string;
  /** Number of pay periods in the year (e.g. 26 = biweekly, 24 = semimonthly, 12 = monthly, 52 = weekly). */
  periodsPerYear: number;
  filingStatus: FilingStatus;
}

export interface WithholdingResult {
  /** Federal income tax withheld this period. */
  federalIncomeTax: string;
  /** Social Security tax withheld this period (6.2%, up to SS wage base). */
  socialSecurity: string;
  /** Medicare tax withheld this period (1.45% + 0.9% over $200,000 annual). */
  medicare: string;
  /** Total withholding (federalIncomeTax + socialSecurity + medicare). */
  totalPerPeriod: string;
  /** Net take-home pay this period after all withholding. */
  net: string;
}

/**
 * Compute per-period federal withholding for an employee.
 *
 * Steps:
 *  1. Annualize grossPerPeriod (× periodsPerYear).
 *  2. Apply the 2024 IRS percentage-method brackets for federalIncomeTax.
 *  3. Compute Social Security at 6.2% up to the $168,600 annual wage base.
 *  4. Compute Medicare at 1.45% base + 0.9% Additional Medicare Tax over $200,000.
 *  5. Divide each annual figure by periodsPerYear to get a per-period amount.
 *
 * All returned values are 2-decimal-place strings suitable for DB decimal columns.
 */
export function computeWithholding({
  grossPerPeriod,
  periodsPerYear,
  filingStatus,
}: WithholdingInput): WithholdingResult {
  if (periodsPerYear <= 0) {
    throw new Error('periodsPerYear must be greater than 0');
  }

  const grossPer = new Decimal(grossPerPeriod);
  const periods = new Decimal(periodsPerYear);

  // 1. Annualize
  const annualGross = grossPer.times(periods);

  // 2. Federal income tax (annual, then divide)
  const annualFederal = computeFederalIncomeTax({ annualTaxable: annualGross, filingStatus });
  const federalPerPeriod = Money.round2(annualFederal.dividedBy(periods));

  // 3. Social Security — capped at annual wage base
  //    Apply the cap at the annual level, then prorate per period.
  const ssWageBase = new Decimal(SS_WAGE_BASE);
  const annualSSTaxable = Decimal.min(annualGross, ssWageBase);
  const annualSS = annualSSTaxable.times(SS_RATE);
  const ssPerPeriod = Money.round2(annualSS.dividedBy(periods));

  // 4. Medicare — base rate on all wages; additional rate on wages above threshold
  const annualMedicareBase = annualGross.times(MEDICARE_BASE_RATE);
  const additionalThreshold = new Decimal(ADDITIONAL_MEDICARE_THRESHOLD);
  const annualAdditional = Decimal.max(new Decimal(0), annualGross.minus(additionalThreshold))
    .times(ADDITIONAL_MEDICARE_RATE);
  const annualMedicare = annualMedicareBase.plus(annualAdditional);
  const medicarePerPeriod = Money.round2(annualMedicare.dividedBy(periods));

  // 5. Total and net
  const total = Money.round2(federalPerPeriod.plus(ssPerPeriod).plus(medicarePerPeriod));
  const net = Money.round2(grossPer.minus(total));

  return {
    federalIncomeTax: toAmountString(federalPerPeriod),
    socialSecurity:   toAmountString(ssPerPeriod),
    medicare:         toAmountString(medicarePerPeriod),
    totalPerPeriod:   toAmountString(total),
    net:              toAmountString(net),
  };
}
