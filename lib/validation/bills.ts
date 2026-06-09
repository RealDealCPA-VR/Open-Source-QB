/**
 * Zod schemas for /api/bills — mirrors CreateBillInput / BillLineInput
 * (lib/services/bills.ts). PATCH /api/bills/:id reuses the same shape
 * (updateBill is a full replace taking CreateBillInput).
 */
import { z } from 'zod';
import { zDate, zDecimal, zLines, zMoney, zUuid } from './helpers';

export const billLineSchema = z.object({
  accountId: zUuid.nullish(),
  itemId: zUuid.nullish(),
  description: z.string().nullish(),
  quantity: zDecimal.nullish(),
  unitCost: zDecimal.nullish(),
  amount: zMoney.nullish(),
  classId: zUuid.nullish(),
  customerId: zUuid.nullish(),
  jobId: zUuid.nullish(),
});

export const createBillSchema = z.object({
  vendorId: zUuid,
  billNumber: z.string().nullish(),
  date: zDate,
  dueDate: zDate.nullish(),
  memo: z.string().nullish(),
  classId: zUuid.nullish(),
  lines: zLines(billLineSchema),
});
export type CreateBillBody = z.infer<typeof createBillSchema>;
