/**
 * Zod schemas for /api/vendor-credits — mirrors CreateVendorCreditInput.
 */
import { z } from 'zod';
import { zDate, zLines, zMoneyPositive, zUuid } from './helpers';

export const vendorCreditLineSchema = z.object({
  accountId: zUuid,
  description: z.string().nullish(),
  amount: zMoneyPositive,
});

export const createVendorCreditSchema = z.object({
  vendorId: zUuid,
  date: zDate,
  memo: z.string().nullish(),
  lines: zLines(vendorCreditLineSchema),
});
export type CreateVendorCreditBody = z.infer<typeof createVendorCreditSchema>;
