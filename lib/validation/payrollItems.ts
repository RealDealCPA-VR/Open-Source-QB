/**
 * Zod schemas for /api/payroll-items — mirrors CreatePayrollItemInput /
 * UpdatePayrollItemInput (lib/services/payrollItems.ts).
 */
import { z } from 'zod';
import { zDecimal, zUuid } from './helpers';

export const payrollItemKindSchema = z.enum([
  'earning',
  'tax',
  'deduction',
  'employer_contribution',
  'garnishment',
]);

export const payrollCalcBasisSchema = z.enum(['fixed', 'percent']);

export const createPayrollItemSchema = z.object({
  name: z.string({ required_error: 'name is required' }).min(1, 'name is required'),
  kind: payrollItemKindSchema,
  pretax: z.boolean().optional(),
  expenseAccountId: zUuid.nullish(),
  liabilityAccountId: zUuid.nullish(),
  calcBasis: payrollCalcBasisSchema.nullish(),
  defaultRate: zDecimal.nullish(),
});
export type CreatePayrollItemBody = z.infer<typeof createPayrollItemSchema>;

export const updatePayrollItemSchema = z.object({
  name: z.string().min(1, 'name is required').optional(),
  pretax: z.boolean().optional(),
  expenseAccountId: zUuid.nullish(),
  liabilityAccountId: zUuid.nullish(),
  calcBasis: payrollCalcBasisSchema.nullish(),
  defaultRate: zDecimal.nullish(),
  isActive: z.boolean().optional(),
});
export type UpdatePayrollItemBody = z.infer<typeof updatePayrollItemSchema>;
