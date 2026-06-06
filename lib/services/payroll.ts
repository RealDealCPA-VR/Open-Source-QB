/**
 * Payroll service.
 *
 * Employees + paychecks (with itemized paycheck lines). Every runPaycheck call posts
 * a balanced journal entry via postJournalEntry:
 *
 *   Dr  6500 Payroll Expense      grossPay
 *   Cr  2300 Payroll Liabilities  totalTaxes + totalDeductions
 *   Cr  1000 Checking             netPay
 *
 * Because grossPay = netPay + totalTaxes + totalDeductions the entry always balances.
 * postedEntryId is stamped on the paycheck row after posting.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { Money, toAmountString } from '@/lib/money';
import { accounts, employees, paychecks, paycheckLines } from '@/lib/db/schema';
import {
  type ServiceContext,
  inTransaction,
  notFound,
  validation,
  writeAudit,
} from './_base';
import { postJournalEntry } from './posting';
import { computeWithholding, type FilingStatus } from '@/lib/services/payrollTax';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PayType = 'hourly' | 'salary' | 'commission';

export interface CreateEmployeeInput {
  firstName: string;
  lastName: string;
  email?: string | null;
  payType: PayType;
  payRate: string | number;
}

export interface PaycheckLineInput {
  kind: 'earning' | 'tax' | 'deduction' | 'employer_contribution';
  name: string;
  amount: string | number;
}

export interface RunPaycheckInput {
  employeeId: string;
  payDate: Date;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  grossPay: string | number;
  /**
   * Itemized tax withholdings. When OMITTED (undefined), taxes are AUTO-COMPUTED via
   * computeWithholding using the employee's filing status and periodsPerYear. An explicit
   * empty array (`[]`) means "no taxes" and is respected (e.g. contractor / reimbursement).
   */
  taxes?: PaycheckLineInput[];
  /** Itemized deductions (e.g. 401k, health insurance). */
  deductions?: PaycheckLineInput[];
  /**
   * Filing status used for auto-computed taxes (default: 'single').
   * Ignored when taxes are explicitly supplied.
   */
  filingStatus?: FilingStatus;
  /**
   * Number of pay periods per year used for annualizing wages (default: 26 biweekly).
   * Ignored when taxes are explicitly supplied.
   */
  periodsPerYear?: number;
}

// ---------------------------------------------------------------------------
// Internal helper: resolve account id by COA code, scoped to company
// ---------------------------------------------------------------------------

async function accountIdByCode(ctx: ServiceContext, code: string): Promise<string> {
  const [row] = await ctx.db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ctx.companyId), eq(accounts.code, code)));
  if (!row) throw notFound(`Account with code ${code}`);
  return row.id;
}

// ---------------------------------------------------------------------------
// Employees
// ---------------------------------------------------------------------------

export async function listEmployees(ctx: ServiceContext, opts?: { includeInactive?: boolean }) {
  const rows = await ctx.db
    .select()
    .from(employees)
    .where(eq(employees.companyId, ctx.companyId))
    .orderBy(employees.lastName, employees.firstName);

  if (opts?.includeInactive) return rows;
  return rows.filter((e) => e.isActive);
}

export async function getEmployee(ctx: ServiceContext, id: string) {
  const [row] = await ctx.db
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, ctx.companyId), eq(employees.id, id)));
  if (!row) throw notFound('Employee');
  return row;
}

export async function createEmployee(ctx: ServiceContext, input: CreateEmployeeInput) {
  if (!input.firstName?.trim()) throw validation('First name is required.');
  if (!input.lastName?.trim()) throw validation('Last name is required.');
  if (!input.payType) throw validation('Pay type is required.');
  const payRate = Money.of(input.payRate ?? 0);
  if (payRate.isNegative()) throw validation('Pay rate cannot be negative.');

  const [row] = await ctx.db
    .insert(employees)
    .values({
      companyId: ctx.companyId,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email?.trim() ?? null,
      payType: input.payType,
      payRate: toAmountString(payRate),
    })
    .returning();

  await writeAudit(ctx, {
    action: 'create',
    entityType: 'employee',
    entityId: row.id,
    newValues: row,
  });

  return row;
}

// ---------------------------------------------------------------------------
// Paychecks
// ---------------------------------------------------------------------------

export async function listPaychecks(ctx: ServiceContext, opts?: { employeeId?: string }) {
  const rows = await ctx.db
    .select()
    .from(paychecks)
    .where(eq(paychecks.companyId, ctx.companyId))
    .orderBy(desc(paychecks.payDate));

  if (opts?.employeeId) return rows.filter((p) => p.employeeId === opts.employeeId);
  return rows;
}

export async function runPaycheck(ctx: ServiceContext, input: RunPaycheckInput) {
  // --- Validate employee ---
  const employee = await getEmployee(ctx, input.employeeId);
  if (!employee.isActive) throw validation('Cannot run paycheck for an inactive employee.');

  // --- Compute amounts ---
  const gross = Money.round2(input.grossPay);
  if (gross.lessThanOrEqualTo(0)) throw validation('Gross pay must be greater than zero.');

  // --- Auto-compute taxes only when the caller did not pass a taxes array at all.
  // An explicit empty array means "no taxes" (contractor/reimbursement) and is respected. ---
  const callerSuppliedTaxes = Array.isArray(input.taxes);

  let taxLines: PaycheckLineInput[];

  if (callerSuppliedTaxes) {
    taxLines = input.taxes!;
  } else {
    // Derive taxes automatically from the gross pay using 2024 IRS tables.
    const withholding = computeWithholding({
      grossPerPeriod: gross.toNumber(),
      periodsPerYear: input.periodsPerYear ?? 26,
      filingStatus: input.filingStatus ?? 'single',
    });
    taxLines = [
      { kind: 'tax' as const, name: 'Federal Income Tax', amount: withholding.federalIncomeTax },
      { kind: 'tax' as const, name: 'Social Security',    amount: withholding.socialSecurity },
      { kind: 'tax' as const, name: 'Medicare',            amount: withholding.medicare },
    ].filter((t) => parseFloat(t.amount) > 0);
  }

  const deductionLines: PaycheckLineInput[] = input.deductions ?? [];

  let totalTaxes = Money.zero();
  for (const t of taxLines) {
    const amt = Money.of(t.amount);
    if (amt.isNegative()) throw validation(`Tax line "${t.name}" cannot be negative.`);
    totalTaxes = totalTaxes.plus(amt);
  }

  let totalDeductions = Money.zero();
  for (const d of deductionLines) {
    const amt = Money.of(d.amount);
    if (amt.isNegative()) throw validation(`Deduction line "${d.name}" cannot be negative.`);
    totalDeductions = totalDeductions.plus(amt);
  }

  const netPay = Money.round2(gross.minus(totalTaxes).minus(totalDeductions));
  if (netPay.isNegative()) {
    throw validation('Net pay cannot be negative — taxes + deductions exceed gross pay.');
  }

  // --- Resolve GL accounts ---
  const payrollExpenseId = await accountIdByCode(ctx, '6500'); // Payroll Expense
  const payrollLiabId = await accountIdByCode(ctx, '2300');    // Payroll Liabilities
  const checkingId = await accountIdByCode(ctx, '1000');       // Checking

  // --- Persist in a single transaction ---
  return inTransaction(ctx, async (tx) => {
    // 1) Insert paycheck header.
    const [paycheck] = await tx.db
      .insert(paychecks)
      .values({
        companyId: tx.companyId,
        employeeId: input.employeeId,
        payDate: input.payDate,
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        grossPay: toAmountString(gross),
        totalTaxes: toAmountString(totalTaxes),
        totalDeductions: toAmountString(totalDeductions),
        netPay: toAmountString(netPay),
        // postedEntryId set below
      })
      .returning();

    // 2) Insert paycheck lines (gross earning + taxes + deductions).
    const lineValues: Array<{
      paycheckId: string;
      kind: string;
      name: string;
      amount: string;
    }> = [
      { paycheckId: paycheck.id, kind: 'earning', name: 'Gross Pay', amount: toAmountString(gross) },
      ...taxLines.map((t) => ({
        paycheckId: paycheck.id,
        kind: 'tax' as const,
        name: t.name,
        amount: toAmountString(Money.of(t.amount)),
      })),
      ...deductionLines.map((d) => ({
        paycheckId: paycheck.id,
        kind: 'deduction' as const,
        name: d.name,
        amount: toAmountString(Money.of(d.amount)),
      })),
    ];

    if (lineValues.length > 0) {
      await tx.db.insert(paycheckLines).values(lineValues);
    }

    // 3) Build and post the balanced journal entry.
    //
    //   Dr 6500 Payroll Expense   = grossPay
    //   Cr 2300 Payroll Liab.     = totalTaxes + totalDeductions  (only if > 0)
    //   Cr 1000 Checking          = netPay
    //
    // Proof: grossPay = netPay + totalTaxes + totalDeductions  ✓
    const liabAmount = Money.round2(totalTaxes.plus(totalDeductions));
    const fullName = `${employee.firstName} ${employee.lastName}`;
    const payDateStr = input.payDate.toISOString().slice(0, 10);

    const postingLines: Array<{ accountId: string; debit?: string; credit?: string; memo?: string }> = [
      {
        accountId: payrollExpenseId,
        debit: toAmountString(gross),
        memo: `Payroll — ${fullName} (${payDateStr})`,
      },
    ];

    if (liabAmount.greaterThan(0)) {
      postingLines.push({
        accountId: payrollLiabId,
        credit: toAmountString(liabAmount),
        memo: `Taxes & deductions — ${fullName}`,
      });
    }

    postingLines.push({
      accountId: checkingId,
      credit: toAmountString(netPay),
      memo: `Net pay — ${fullName}`,
    });

    const entry = await postJournalEntry(tx, {
      date: input.payDate,
      description: `Payroll — ${fullName}`,
      reference: paycheck.id.slice(0, 8),
      sourceRef: `paycheck:${paycheck.id}`,
      lines: postingLines,
    });

    // 4) Stamp postedEntryId.
    const [updated] = await tx.db
      .update(paychecks)
      .set({ postedEntryId: entry.id })
      .where(eq(paychecks.id, paycheck.id))
      .returning();

    // 5) Audit trail.
    await writeAudit(tx, {
      action: 'create',
      entityType: 'paycheck',
      entityId: paycheck.id,
      newValues: {
        employeeId: input.employeeId,
        payDate: input.payDate,
        grossPay: toAmountString(gross),
        netPay: toAmountString(netPay),
        postedEntryId: entry.id,
      },
    });

    return { ...updated, lines: lineValues };
  });
}
