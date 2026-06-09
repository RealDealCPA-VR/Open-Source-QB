/**
 * Zod schemas for /api/fixed-assets — mirrors CreateAssetInput and the
 * depreciate action body (lib/services/fixedAssets.ts).
 */
import { z } from 'zod';
import { zDate, zMoney, zUuid } from './helpers';

export const createAssetSchema = z.object({
  name: z.string({ required_error: 'Missing required field: name' }).min(1, 'name is required'),
  cost: zMoney,
  salvageValue: zMoney.nullish(),
  /** The route historically coerced (Number(body.usefulLifeMonths)); keep that. */
  usefulLifeMonths: z.coerce
    .number({ invalid_type_error: 'usefulLifeMonths must be a number' })
    .int('usefulLifeMonths must be an integer')
    .positive('usefulLifeMonths must be positive'),
  placedInService: zDate,
  depreciationExpenseAccountId: zUuid.nullish(),
  accumulatedDepreciationAccountId: zUuid.nullish(),
  assetAccountId: zUuid.nullish(),
});
export type CreateAssetBody = z.infer<typeof createAssetSchema>;

/** POST /api/fixed-assets/:id — { action: 'depreciate', date }. */
export const fixedAssetActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('depreciate'),
    date: zDate,
  }),
]);
export type FixedAssetActionBody = z.infer<typeof fixedAssetActionSchema>;
