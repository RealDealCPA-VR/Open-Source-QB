/**
 * Zod schemas for /api/credit-memos — mirrors CreateCreditMemoInput / CreditMemoLineInput.
 */
import { z } from 'zod';
import { zDate, zDecimal, zLines, zUuid } from './helpers';

export const creditMemoLineSchema = z.object({
  itemId: zUuid.nullish(),
  description: z.string().nullish(),
  quantity: zDecimal,
  rate: zDecimal,
  accountId: zUuid.nullish(),
  /** Defaults to true in the service. */
  taxable: z.boolean().optional(),
  /** Inventory items only: true (default) restocks; false = damaged write-off. */
  restock: z.boolean().optional(),
});

export const createCreditMemoSchema = z.object({
  customerId: zUuid,
  date: zDate,
  taxRateId: zUuid.nullish(),
  memo: z.string().nullish(),
  lines: zLines(creditMemoLineSchema),
});
export type CreateCreditMemoBody = z.infer<typeof createCreditMemoSchema>;
