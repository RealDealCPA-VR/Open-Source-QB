/**
 * Zod schemas for /api/expenses — mirrors CreateExpenseInput / ExpenseLineInput.
 */
import { z } from 'zod';
import { zDate, zLines, zMoney, zUuid } from './helpers';

export const expenseLineSchema = z.object({
  accountId: zUuid,
  description: z.string().nullish(),
  /** Positive normally; all-negative lines flip into a credit-card credit. */
  amount: zMoney,
  classId: zUuid.nullish(),
  customerId: zUuid.nullish(),
  jobId: zUuid.nullish(),
});

export const createExpenseSchema = z
  .object({
    vendorId: zUuid.nullish(),
    payeeName: z.string().nullish(),
    date: zDate,
    method: z.enum(['check', 'cash', 'credit_card'], {
      errorMap: () => ({ message: "method must be 'check', 'cash', or 'credit_card'" }),
    }),
    reference: z.string().nullish(),
    paymentAccountId: zUuid,
    memo: z.string().nullish(),
    toPrint: z.boolean().optional(),
    isRefund: z.boolean().optional(),
    lines: zLines(expenseLineSchema),
  })
  .refine((e) => Boolean(e.vendorId) || Boolean(e.payeeName?.trim()), {
    message: 'Provide a vendorId or a payeeName.',
    path: ['payeeName'],
  });
export type CreateExpenseBody = z.infer<typeof createExpenseSchema>;
