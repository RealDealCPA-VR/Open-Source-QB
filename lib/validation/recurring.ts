/**
 * Zod schemas for /api/recurring — mirrors CreateTemplateInput
 * (lib/services/recurring.ts) and the /run trigger body.
 */
import { z } from 'zod';
import { zDate, zUuid } from './helpers';

export const recurringDocTypeSchema = z.enum(['invoice', 'bill', 'journal_entry', 'expense']);
export const recurringFrequencySchema = z.enum(['weekly', 'monthly', 'quarterly', 'yearly']);

export const createRecurringTemplateSchema = z.object({
  name: z.string({ required_error: 'name is required' }).min(1, 'name is required'),
  docType: recurringDocTypeSchema,
  frequency: recurringFrequencySchema,
  /** Defaults to "now" in the route when omitted. */
  nextRunDate: zDate.optional(),
  /** JSON payload matching the create-input of the docType — validated by the service. */
  template: z.record(z.unknown(), { required_error: 'template payload is required' }),
  /** Default true (auto-post on schedule); false = remind-only. */
  autoEnter: z.boolean().optional(),
});
export type CreateRecurringTemplateBody = z.infer<typeof createRecurringTemplateSchema>;

/** POST /api/recurring/run — { id } runs one template now, { asOf? } runs all due. */
export const runRecurringSchema = z.object({
  id: zUuid.nullish(),
  asOf: zDate.nullish(),
});
export type RunRecurringBody = z.infer<typeof runRecurringSchema>;
