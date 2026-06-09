/**
 * Zod schemas for /api/payments — mirrors ReceivePaymentInput.
 */
import { z } from 'zod';
import { zDate, zDecimalPositive, zMoneyPositive, zUuid } from './helpers';

export const paymentApplicationSchema = z.object({
  invoiceId: zUuid,
  amountApplied: zMoneyPositive,
});

export const receivePaymentSchema = z.object({
  customerId: zUuid,
  date: zDate,
  method: z.enum(['cash', 'check', 'credit_card', 'ach', 'bank_transfer', 'other'], {
    errorMap: () => ({
      message: 'method must be cash, check, credit_card, ach, bank_transfer, or other',
    }),
  }),
  reference: z.string().nullish(),
  amount: zMoneyPositive,
  depositAccountId: zUuid.nullish(),
  /** May be empty — the un-applied remainder is recorded as a customer credit. */
  applications: z.array(paymentApplicationSchema, {
    required_error: 'applications must be an array (may be empty)',
    invalid_type_error: 'applications must be an array',
  }),
  currency: z.string().trim().length(3, 'currency must be a 3-letter ISO 4217 code').nullish(),
  /** FX rates carry more than 2 decimal places. */
  exchangeRate: zDecimalPositive.nullish(),
});
export type ReceivePaymentBody = z.infer<typeof receivePaymentSchema>;
