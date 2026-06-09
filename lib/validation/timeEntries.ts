/**
 * Zod schemas for /api/time-entries — mirrors TimeEntryInput / TimeEntryUpdate
 * (lib/services/timeTracking.ts) and the /bill body.
 */
import { z } from 'zod';
import { zDate, zDecimal, zUuid } from './helpers';

export const createTimeEntrySchema = z.object({
  employeeId: zUuid.nullish(),
  customerId: zUuid.nullish(),
  jobId: zUuid.nullish(),
  serviceItemId: zUuid.nullish(),
  date: zDate,
  hours: zDecimal,
  /** Defaults to true. */
  billable: z.boolean().optional(),
  rate: zDecimal.nullish(),
  description: z.string().nullish(),
});
export type CreateTimeEntryBody = z.infer<typeof createTimeEntrySchema>;

/** PATCH — absent keys stay absent so the service only touches provided fields. */
export const updateTimeEntrySchema = z.object({
  employeeId: zUuid.nullish(),
  customerId: zUuid.nullish(),
  jobId: zUuid.nullish(),
  serviceItemId: zUuid.nullish(),
  date: zDate.optional(),
  hours: zDecimal.optional(),
  billable: z.boolean().optional(),
  rate: zDecimal.nullish(),
  description: z.string().nullish(),
});
export type UpdateTimeEntryBody = z.infer<typeof updateTimeEntrySchema>;

/** POST /api/time-entries/bill — bill unbilled time for one customer. */
export const billTimeSchema = z.object({
  customerId: zUuid,
});
export type BillTimeBody = z.infer<typeof billTimeSchema>;
