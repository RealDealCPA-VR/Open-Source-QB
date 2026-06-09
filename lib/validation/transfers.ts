/**
 * Zod schemas for /api/transfers — mirrors CreateTransferInput.
 */
import { z } from 'zod';
import { zDate, zMoneyPositive, zUuid } from './helpers';

export const createTransferSchema = z
  .object({
    date: zDate,
    fromAccountId: zUuid,
    toAccountId: zUuid,
    amount: zMoneyPositive,
    memo: z.string().nullish(),
  })
  .refine((t) => t.fromAccountId !== t.toAccountId, {
    message: 'From account and to account must be different.',
    path: ['toAccountId'],
  });
export type CreateTransferBody = z.infer<typeof createTransferSchema>;
