/**
 * Zod schemas for /api/item-receipts — mirrors CreateItemReceiptInput /
 * ItemReceiptLineInput / ConvertReceiptToBillOptions (lib/services/itemReceipts.ts).
 */
import { z } from 'zod';
import { zDate, zDecimal, zLines, zUuid } from './helpers';

export const itemReceiptLineSchema = z.object({
  itemId: zUuid,
  description: z.string().nullish(),
  quantity: zDecimal,
  unitCost: zDecimal,
});

export const createItemReceiptSchema = z.object({
  vendorId: zUuid,
  date: zDate,
  reference: z.string().nullish(),
  memo: z.string().nullish(),
  purchaseOrderId: zUuid.nullish(),
  lines: zLines(itemReceiptLineSchema),
});
export type CreateItemReceiptBody = z.infer<typeof createItemReceiptSchema>;

/** POST /api/item-receipts/:id — { action: 'convert' | 'void', ... }. */
export const itemReceiptActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('convert'),
    billNumber: z.string().nullish(),
    date: zDate.optional(),
    dueDate: zDate.nullish(),
  }),
  z.object({ action: z.literal('void') }),
]);
export type ItemReceiptActionBody = z.infer<typeof itemReceiptActionSchema>;
