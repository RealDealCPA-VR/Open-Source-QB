/**
 * Payroll report aggregations.
 *
 * w2Data   — aggregate W-2 wages and withholdings for one employee and one tax year.
 * form941Data — aggregate Form 941 totals for one quarter and one tax year.
 *
 * Both functions query paychecks (for the period) and paycheckLines (for the
 * itemized amounts) so the numbers always stay in sync with the GL-posted records.
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { paychecks, paycheckLines } from '@/lib/db/schema';
import { type ServiceContext, notFound } from './_base';
import { getEmployee } from './payroll';
import { getCompany } from './company';

// ---------------------------------------------------------------------------
// W-2 data
// ---------------------------------------------------------------------------

export interface W2DataInput {
  employeeId: string;
  year: number;
}

export interface W2DataResult {
  company: { name: string; address: string | null };
  employee: { firstName: string; lastName: string; ssn: string | null };
  year: number;
  /** Box 1: total gross wages paid in the calendar year. */
  wages: string;
  /** Box 2: total federal income tax withheld. */
  federalWithheld: string;
  /** Box 4: total Social Security tax withheld. */
  socialSecurity: string;
  /** Box 6: total Medicare tax withheld. */
  medicare: string;
}

/**
 * Aggregate W-2 figures for an employee for a given calendar year.
 * Wages = sum of gross_pay on paychecks.
 * Federal / SS / Medicare = sum of matching paycheck_lines rows by name
 * (case-insensitive contains match on the standard names emitted by computeWithholding).
 */
export async function w2Data(
  ctx: ServiceContext,
  input: W2DataInput,
): Promise<W2DataResult> {
  const employee = await getEmployee(ctx, input.employeeId);
  const company = await getCompany(ctx);
  if (!company) throw notFound('Company');

  const yearStart = new Date(input.year,     0, 1);
  const yearEnd   = new Date(input.year + 1, 0, 1);

  // 1. Fetch paychecks for the employee in the year.
  const yearPaychecks = await ctx.db
    .select({ id: paychecks.id, grossPay: paychecks.grossPay })
    .from(paychecks)
    .where(
      and(
        eq(paychecks.companyId, ctx.companyId),
        eq(paychecks.employeeId, input.employeeId),
        gte(paychecks.payDate, yearStart),
        lte(paychecks.payDate, yearEnd),
      ),
    );

  const paycheckIds = yearPaychecks.map((p) => p.id);

  // Aggregate gross wages.
  const wages = yearPaychecks
    .reduce((sum, p) => sum + parseFloat(p.grossPay ?? '0'), 0)
    .toFixed(2);

  if (paycheckIds.length === 0) {
    return {
      company: { name: company.name, address: null },
      employee: {
        firstName: employee.firstName,
        lastName: employee.lastName,
        ssn: (employee.ssn as string | null | undefined) ?? null,
      },
      year: input.year,
      wages: '0.00',
      federalWithheld: '0.00',
      socialSecurity: '0.00',
      medicare: '0.00',
    };
  }

  // 2. Fetch all tax lines for these paychecks.
  const allLines = await ctx.db
    .select({ name: paycheckLines.name, amount: paycheckLines.amount, kind: paycheckLines.kind })
    .from(paycheckLines)
    .where(
      and(
        // Filter to only tax lines belonging to our paychecks.
        // drizzle-orm pglite supports inArray but we keep it simple with a subquery-free
        // loop to avoid adding an import.
        eq(paycheckLines.kind, 'tax'),
      ),
    );

  // Re-filter in memory by paycheckId since we fetched globally above.
  // We need paycheckId column — re-fetch with it.
  const taxLines = await ctx.db
    .select({
      paycheckId: paycheckLines.paycheckId,
      name: paycheckLines.name,
      amount: paycheckLines.amount,
    })
    .from(paycheckLines)
    .where(eq(paycheckLines.kind, 'tax'));

  const relevantTaxLines = taxLines.filter((l) => paycheckIds.includes(l.paycheckId));

  function sumByName(pattern: RegExp): string {
    return relevantTaxLines
      .filter((l) => pattern.test(l.name))
      .reduce((s, l) => s + parseFloat(l.amount ?? '0'), 0)
      .toFixed(2);
  }

  const federalWithheld = sumByName(/federal income tax/i);
  const socialSecurity  = sumByName(/social security/i);
  const medicare        = sumByName(/medicare/i);

  return {
    company: { name: company.name, address: null },
    employee: {
      firstName: employee.firstName,
      lastName:  employee.lastName,
      ssn: (employee.ssn as string | null | undefined) ?? null,
    },
    year: input.year,
    wages,
    federalWithheld,
    socialSecurity,
    medicare,
  };
}

// ---------------------------------------------------------------------------
// Form 941 data
// ---------------------------------------------------------------------------

export interface Form941DataInput {
  /** Calendar quarter: 1, 2, 3, or 4. */
  quarter: 1 | 2 | 3 | 4;
  year: number;
}

export interface Form941DataResult {
  company: { name: string; address: string | null };
  quarter: 1 | 2 | 3 | 4;
  year: number;
  totals: {
    wages: string;
    federalWithheld: string;
    socialSecurity: string;
    medicare: string;
  };
}

/** Compute the start and end Date for a given quarter in a given year. */
function quarterRange(quarter: 1 | 2 | 3 | 4, year: number): { start: Date; end: Date } {
  const qStartMonth = (quarter - 1) * 3; // 0, 3, 6, 9
  const start = new Date(year, qStartMonth, 1);
  const end   = new Date(year, qStartMonth + 3, 1); // exclusive upper bound
  return { start, end };
}

/**
 * Aggregate Form 941 totals for a specific quarter and year.
 * Covers all employees in the company for that period.
 */
export async function form941Data(
  ctx: ServiceContext,
  input: Form941DataInput,
): Promise<Form941DataResult> {
  const company = await getCompany(ctx);
  if (!company) throw notFound('Company');

  const { start, end } = quarterRange(input.quarter, input.year);

  // Fetch all paychecks in the quarter.
  const quarterPaychecks = await ctx.db
    .select({ id: paychecks.id, grossPay: paychecks.grossPay })
    .from(paychecks)
    .where(
      and(
        eq(paychecks.companyId, ctx.companyId),
        gte(paychecks.payDate, start),
        lte(paychecks.payDate, end),
      ),
    );

  const paycheckIds = quarterPaychecks.map((p) => p.id);

  const wages = quarterPaychecks
    .reduce((sum, p) => sum + parseFloat(p.grossPay ?? '0'), 0)
    .toFixed(2);

  if (paycheckIds.length === 0) {
    return {
      company: { name: company.name, address: null },
      quarter: input.quarter,
      year: input.year,
      totals: { wages: '0.00', federalWithheld: '0.00', socialSecurity: '0.00', medicare: '0.00' },
    };
  }

  const taxLines = await ctx.db
    .select({
      paycheckId: paycheckLines.paycheckId,
      name: paycheckLines.name,
      amount: paycheckLines.amount,
    })
    .from(paycheckLines)
    .where(eq(paycheckLines.kind, 'tax'));

  const relevantTaxLines = taxLines.filter((l) => paycheckIds.includes(l.paycheckId));

  function sumByName(pattern: RegExp): string {
    return relevantTaxLines
      .filter((l) => pattern.test(l.name))
      .reduce((s, l) => s + parseFloat(l.amount ?? '0'), 0)
      .toFixed(2);
  }

  return {
    company: { name: company.name, address: null },
    quarter: input.quarter,
    year: input.year,
    totals: {
      wages,
      federalWithheld: sumByName(/federal income tax/i),
      socialSecurity:  sumByName(/social security/i),
      medicare:        sumByName(/medicare/i),
    },
  };
}
