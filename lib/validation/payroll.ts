/**
 * Zod schemas for /api/payroll and /api/payroll/pay-runs — mirror
 * RunPaycheckInput / EarningLineInput / PaycheckLineInput / CreatePayRunInput
 * (lib/services/payroll.ts).
 *
 * IMPORTANT: `taxes` / `employerTaxes` must keep the absent-vs-[] distinction —
 * an OMITTED array triggers auto-withholding in the service, an explicit []
 * means "no taxes". Both schemas therefore use plain `.optional()`.
 */
import { z } from 'zod';
import { zDate, zDecimal, zMoney, zUuid } from './helpers';

export const paycheckLineSchema = z.object({
  kind: z.enum(['earning', 'tax', 'deduction', 'employer_contribution']),
  name: z.string().min(1, 'line name is required'),
  amount: zMoney,
  payrollItemId: zUuid.nullish(),
});

export const earningLineSchema = z.object({
  kind: z.enum(['regular', 'overtime', 'bonus', 'commission']),
  hours: zDecimal.nullish(),
  rate: zDecimal.nullish(),
  amount: zMoney.nullish(),
  payrollItemId: zUuid.nullish(),
});

export const runPaycheckSchema = z.object({
  employeeId: zUuid,
  payDate: zDate,
  periodStart: zDate.nullish(),
  periodEnd: zDate.nullish(),
  /** Ignored when `earnings` has lines; required by the service otherwise. */
  grossPay: zMoney.optional(),
  earnings: z.array(earningLineSchema).optional(),
  taxes: z.array(paycheckLineSchema).optional(),
  employerTaxes: z.array(paycheckLineSchema).optional(),
  deductions: z.array(paycheckLineSchema).optional(),
  filingStatus: z.enum(['single', 'married']).optional(),
  periodsPerYear: z.number().int().positive('periodsPerYear must be a positive integer').optional(),
});
export type RunPaycheckBody = z.infer<typeof runPaycheckSchema>;

export const payRunEmployeeSchema = z.object({
  employeeId: zUuid,
  hours: zDecimal.nullish(),
  amount: zMoney.nullish(),
  deductions: z.array(paycheckLineSchema).optional(),
  timeEntryIds: z.array(zUuid).optional(),
});

export const createPayRunSchema = z.object({
  payDate: zDate,
  periodStart: zDate.nullish(),
  periodEnd: zDate.nullish(),
  memo: z.string().nullish(),
  periodsPerYear: z.number().int().positive('periodsPerYear must be a positive integer').optional(),
  employees: z
    .array(payRunEmployeeSchema, {
      required_error: 'employees must be a non-empty array',
      invalid_type_error: 'employees must be a non-empty array',
    })
    .min(1, 'employees must be a non-empty array'),
});
export type CreatePayRunBody = z.infer<typeof createPayRunSchema>;
