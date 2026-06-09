/**
 * Zod schemas for /api/accounts — mirrors lib/services/accounts.ts inputs.
 * Subtype normalization (blank -> per-type default, enum check) stays in the service.
 */
import { z } from 'zod';
import { zDate, zMoney, zUuid } from './helpers';

export const createAccountSchema = z.object({
  code: z.string().trim().min(1, 'code is required'),
  name: z.string().trim().min(1, 'name is required'),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense'], {
    errorMap: () => ({ message: 'type must be asset, liability, equity, revenue, or expense' }),
  }),
  /** Blank is allowed — the service maps it to a sensible per-type default. */
  subtype: z.string().default(''),
  parentId: zUuid.nullish(),
  openingBalance: zMoney.nullish(),
  openingBalanceDate: zDate.optional(),
  description: z.string().nullish(),
});
export type CreateAccountBody = z.infer<typeof createAccountSchema>;

export const updateAccountSchema = z.object({
  name: z.string().trim().min(1, 'name cannot be empty').optional(),
  subtype: z.string().optional(),
  parentId: zUuid.nullable().optional(),
  description: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateAccountBody = z.infer<typeof updateAccountSchema>;
