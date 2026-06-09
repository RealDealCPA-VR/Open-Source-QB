/**
 * Zod schemas for /api/bill-payments — mirrors PayBillsInput / BillApplication
 * (lib/services/billPayments.ts).
 */
import { z } from 'zod';
import { zDate, zLines, zMoney, zUuid } from './helpers';

export const paymentMethodSchema = z.enum([
  'cash',
  'check',
  'credit_card',
  'ach',
  'bank_transfer',
  'other',
]);

export const billApplicationSchema = z.object({
  billId: zUuid,
  amountApplied: zMoney,
  discountTaken: zMoney.nullish(),
});

export const payBillsSchema = z.object({
  vendorId: zUuid,
  date: zDate,
  method: paymentMethodSchema,
  reference: z.string().nullish(),
  paymentAccountId: zUuid,
  /** Required by the service when any application takes a discount. */
  discountAccountId: zUuid.nullish(),
  applications: zLines(billApplicationSchema),
});
export type PayBillsBody = z.infer<typeof payBillsSchema>;
