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

/**
 * 2024 standard deduction by filing status. The IRS percentage method for automated payroll
 * systems builds the standard deduction into its withholding wage brackets; since the bracket
 * tables above are the income-tax-return brackets (10% from $0), we approximate by deducting
 * the standard deduction from annual wages before applying them.
 */
const STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  single: 14600,
  married: 29200,
};

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

/** FUTA wage base — the first $7,000 of wages paid to each employee per year. */
const FUTA_WAGE_BASE = 7000;

/** Net FUTA rate (6.0% statutory minus the full 5.4% state unemployment credit). */
const FUTA_NET_RATE = new Decimal('0.006');

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
  /**
   * Gross wages already paid to the employee this calendar year, EXCLUDING the current
   * check (default 0). The Social Security wage base and the Additional Medicare Tax
   * threshold are applied against actual YTD wages — not an annualized projection of
   * the current period — matching how the IRS (and QuickBooks) apply both limits.
   */
  ytdGrossBefore?: MoneyInput;
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
 *  1. Annualize grossPerPeriod (× periodsPerYear) — used for federal income tax ONLY.
 *  2. Apply the 2024 IRS percentage-method brackets for federalIncomeTax.
 *  3. Compute Social Security at 6.2% on this check, capped by actual YTD wages
 *     against the $168,600 annual wage base (NOT an annualized projection).
 *  4. Compute Medicare at 1.45% on this check + 0.9% Additional Medicare Tax on the
 *     portion of this check that pushes actual YTD wages above $200,000.
 *
 * All returned values are 2-decimal-place strings suitable for DB decimal columns.
 */
export function computeWithholding({
  grossPerPeriod,
  periodsPerYear,
  filingStatus,
  ytdGrossBefore = 0,
}: WithholdingInput): WithholdingResult {
  if (periodsPerYear <= 0) {
    throw new Error('periodsPerYear must be greater than 0');
  }

  const grossPer = new Decimal(grossPerPeriod);
  const periods = new Decimal(periodsPerYear);
  const ytdBefore = Decimal.max(new Decimal(0), toDecimal(ytdGrossBefore));

  // 1. Annualize
  const annualGross = grossPer.times(periods);

  // 2. Federal income tax (annual, then divide).
  //    The bracket tables are income-tax-return brackets (10% from $0), which on their own
  //    would over-withhold. The IRS percentage method builds in the standard deduction, so
  //    subtract it from annual wages before applying the brackets. (FICA below still uses the
  //    FULL gross — Social Security / Medicare are not reduced by the standard deduction.)
  const annualTaxableFederal = Decimal.max(
    new Decimal(0),
    annualGross.minus(STANDARD_DEDUCTION[filingStatus]),
  );
  const annualFederal = computeFederalIncomeTax({ annualTaxable: annualTaxableFederal, filingStatus });
  const federalPerPeriod = Money.round2(annualFederal.dividedBy(periods));

  // 3. Social Security — 6.2% on the portion of THIS check that fits under the annual
  //    wage base after actual YTD wages. A $20k bonus with low YTD withholds the full
  //    6.2%; once YTD wages reach the base, SS withholding stops entirely.
  const ssWageBase = new Decimal(SS_WAGE_BASE);
  const ssTaxableThisPeriod = Decimal.max(
    new Decimal(0),
    Decimal.min(grossPer, ssWageBase.minus(ytdBefore)),
  );
  const ssPerPeriod = Money.round2(ssTaxableThisPeriod.times(SS_RATE));

  // 4. Medicare — 1.45% base rate on all wages of this check; the 0.9% additional rate
  //    applies only to the portion of this check above the actual YTD $200,000 threshold.
  const additionalThreshold = new Decimal(ADDITIONAL_MEDICARE_THRESHOLD);
  const additionalTaxableThisPeriod = Decimal.min(
    grossPer,
    Decimal.max(new Decimal(0), ytdBefore.plus(grossPer).minus(additionalThreshold)),
  );
  const medicarePerPeriod = Money.round2(
    grossPer.times(MEDICARE_BASE_RATE)
      .plus(additionalTaxableThisPeriod.times(ADDITIONAL_MEDICARE_RATE)),
  );

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

// ---------------------------------------------------------------------------
// Employer payroll taxes (employer FICA match + FUTA)
// ---------------------------------------------------------------------------

export interface EmployerTaxInput {
  /** Gross wages for this pay period. */
  grossPerPeriod: number | string;
  /** Gross wages already paid this calendar year, excluding the current check (default 0). */
  ytdGrossBefore?: MoneyInput;
}

export interface EmployerTaxResult {
  /** Employer Social Security match — 6.2% of SS-taxable wages this check. */
  socialSecurity: string;
  /** Employer Medicare match — 1.45% of gross (no employer match on the 0.9% additional tax). */
  medicare: string;
  /** Federal Unemployment (FUTA) — 0.6% net rate on the first $7,000 of YTD wages. */
  futa: string;
  /** Total employer payroll taxes for this check. */
  total: string;
}

/**
 * Compute employer-side payroll taxes for one paycheck. These are an EXPENSE of the
 * employer (Dr Payroll Tax Expense / Cr Payroll Liabilities) and never reduce the
 * employee's net pay. Both the SS wage base and the FUTA wage base are applied against
 * actual YTD wages, mirroring computeWithholding.
 */
export function computeEmployerTaxes({
  grossPerPeriod,
  ytdGrossBefore = 0,
}: EmployerTaxInput): EmployerTaxResult {
  const grossPer = new Decimal(grossPerPeriod);
  const ytdBefore = Decimal.max(new Decimal(0), toDecimal(ytdGrossBefore));

  // Employer Social Security — same 6.2% / $168,600 YTD cap as the employee share.
  const ssTaxable = Decimal.max(
    new Decimal(0),
    Decimal.min(grossPer, new Decimal(SS_WAGE_BASE).minus(ytdBefore)),
  );
  const socialSecurity = Money.round2(ssTaxable.times(SS_RATE));

  // Employer Medicare — 1.45% of all wages; the 0.9% Additional Medicare Tax is
  // employee-withheld only and has NO employer match.
  const medicare = Money.round2(grossPer.times(MEDICARE_BASE_RATE));

  // FUTA — 0.6% net rate on the portion of this check within the first $7,000 of YTD wages.
  const futaTaxable = Decimal.max(
    new Decimal(0),
    Decimal.min(grossPer, new Decimal(FUTA_WAGE_BASE).minus(ytdBefore)),
  );
  const futa = Money.round2(futaTaxable.times(FUTA_NET_RATE));

  const total = Money.round2(socialSecurity.plus(medicare).plus(futa));

  return {
    socialSecurity: toAmountString(socialSecurity),
    medicare:       toAmountString(medicare),
    futa:           toAmountString(futa),
    total:          toAmountString(total),
  };
}
