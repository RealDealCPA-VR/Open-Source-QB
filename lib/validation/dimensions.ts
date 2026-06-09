/**
 * Zod schemas for /api/classes and /api/locations — mirror the inline input
 * types of createClass / createLocation (lib/services/dimensions.ts).
 */
import { z } from 'zod';
import { zUuid } from './helpers';

export const createClassSchema = z.object({
  name: z.string({ required_error: 'name is required' }).trim().min(1, 'Class name is required.'),
  parentId: zUuid.nullish(),
});
export type CreateClassBody = z.infer<typeof createClassSchema>;

export const createLocationSchema = z.object({
  name: z
    .string({ required_error: 'name is required' })
    .trim()
    .min(1, 'Location name is required.'),
});
export type CreateLocationBody = z.infer<typeof createLocationSchema>;
