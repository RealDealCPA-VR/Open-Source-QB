/**
 * Recurring / memorized transaction service.
 *
 * Templates store a docType (invoice | bill | journal_entry), a frequency, a nextRunDate,
 * and a JSON payload that mirrors the create-input of the target service.
 *
 * `runDue(ctx, asOf)` finds all active templates whose nextRunDate <= asOf, generates the
 * document by delegating to the matching service, and advances nextRunDate by the frequency.
 *
 * `runTemplateNow(ctx, id)` generates a single template immediately regardless of nextRunDate.
 */

import { and, eq, lte } from 'drizzle-orm';
import { recurringTemplates } from '@/lib/db/schema';
import {
  type ServiceContext,
  ServiceError,
  notFound,
  validation,
  writeAudit,
} from './_base';
import { createInvoice, type CreateInvoiceInput } from './invoices';
import { createBill, type CreateBillInput } from './bills';
import { createManualEntry, type ManualEntryInput } from './journal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DocType = 'invoice' | 'bill' | 'journal_entry';
export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface CreateTemplateInput {
  name: string;
  docType: DocType;
  frequency: Frequency;
  /** ISO date string or Date — the first (or next) scheduled run. */
  nextRunDate: string | Date;
  /** JSON payload matching the create-input of the docType. Date fields as ISO strings. */
  template: Record<string, unknown>;
}

export interface GeneratedDoc {
  templateId: string;
  templateName: string;
  docType: DocType;
  /** The id of the created document. */
  docId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOC_TYPES: DocType[] = ['invoice', 'bill', 'journal_entry'];
const FREQUENCIES: Frequency[] = ['weekly', 'monthly', 'quarterly', 'yearly'];

function advanceDate(date: Date, frequency: Frequency): Date {
  const d = new Date(date);
  switch (frequency) {
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    case 'quarterly':
      d.setMonth(d.getMonth() + 3);
      break;
    case 'yearly':
      d.setFullYear(d.getFullYear() + 1);
      break;
  }
  return d;
}

/**
 * The run date is authoritative for generated documents: a template payload built
 * from a real create-input carries the ORIGINAL document date, and reusing it would
 * post every recurrence into the same historical period. The template's dueDate is
 * only used to carry the original date→dueDate offset (i.e. the payment terms)
 * forward from the run date.
 */
function recurrenceDueDate(payload: Record<string, unknown>, runDate: Date): Date | null {
  const baseDate = payload.date ? new Date(payload.date as string) : null;
  const baseDueDate = payload.dueDate ? new Date(payload.dueDate as string) : null;
  if (!baseDueDate) return null;
  if (!baseDate) return baseDueDate; // no offset known — keep the stored dueDate
  return new Date(runDate.getTime() + (baseDueDate.getTime() - baseDate.getTime()));
}

/**
 * Parse a template payload into a typed create-input for invoices.
 * The document date is always the run date (see recurrenceDueDate).
 */
function toInvoiceInput(payload: Record<string, unknown>, runDate: Date): CreateInvoiceInput {
  return {
    ...(payload as unknown as CreateInvoiceInput),
    date: runDate,
    dueDate: recurrenceDueDate(payload, runDate),
  };
}

function toBillInput(payload: Record<string, unknown>, runDate: Date): CreateBillInput {
  return {
    ...(payload as unknown as CreateBillInput),
    date: runDate,
    dueDate: recurrenceDueDate(payload, runDate),
  };
}

function toManualEntryInput(payload: Record<string, unknown>, runDate: Date): ManualEntryInput {
  return {
    ...(payload as unknown as ManualEntryInput),
    date: runDate,
  };
}

// ---------------------------------------------------------------------------
// listTemplates
// ---------------------------------------------------------------------------

export async function listTemplates(ctx: ServiceContext) {
  return ctx.db
    .select()
    .from(recurringTemplates)
    .where(eq(recurringTemplates.companyId, ctx.companyId))
    .orderBy(recurringTemplates.createdAt);
}

// ---------------------------------------------------------------------------
// getTemplate
// ---------------------------------------------------------------------------

export async function getTemplate(ctx: ServiceContext, id: string) {
  const [row] = await ctx.db
    .select()
    .from(recurringTemplates)
    .where(
      and(eq(recurringTemplates.id, id), eq(recurringTemplates.companyId, ctx.companyId)),
    );
  if (!row) throw notFound('Recurring template');
  return row;
}

// ---------------------------------------------------------------------------
// createTemplate
// ---------------------------------------------------------------------------

export async function createTemplate(ctx: ServiceContext, input: CreateTemplateInput) {
  if (!input.name?.trim()) {
    throw validation('Template name is required.');
  }
  if (!DOC_TYPES.includes(input.docType)) {
    throw validation(`docType must be one of: ${DOC_TYPES.join(', ')}.`);
  }
  if (!FREQUENCIES.includes(input.frequency)) {
    throw validation(`frequency must be one of: ${FREQUENCIES.join(', ')}.`);
  }
  if (!input.template || typeof input.template !== 'object') {
    throw validation('template payload is required and must be an object.');
  }

  const nextRunDate = input.nextRunDate
    ? new Date(input.nextRunDate as string)
    : null;

  if (nextRunDate && isNaN(nextRunDate.getTime())) {
    throw validation('nextRunDate is not a valid date.');
  }

  const [row] = await ctx.db
    .insert(recurringTemplates)
    .values({
      companyId: ctx.companyId,
      name: input.name.trim(),
      docType: input.docType,
      frequency: input.frequency,
      nextRunDate: nextRunDate,
      template: input.template,
      isActive: true,
    })
    .returning();

  await writeAudit(ctx, {
    action: 'create',
    entityType: 'recurring_template',
    entityId: row.id,
    newValues: { name: row.name, docType: row.docType, frequency: row.frequency },
  });

  return row;
}

// ---------------------------------------------------------------------------
// generateFromTemplate — internal
// ---------------------------------------------------------------------------

async function generateFromTemplate(
  ctx: ServiceContext,
  template: Awaited<ReturnType<typeof getTemplate>>,
  runDate: Date,
): Promise<GeneratedDoc> {
  const payload = template.template as Record<string, unknown>;
  let docId: string;

  if (template.docType === 'invoice') {
    const input = toInvoiceInput(payload, runDate);
    const result = await createInvoice(ctx, input);
    docId = result.id;
  } else if (template.docType === 'bill') {
    const input = toBillInput(payload, runDate);
    const result = await createBill(ctx, input);
    docId = result.id;
  } else if (template.docType === 'journal_entry') {
    const input = toManualEntryInput(payload, runDate);
    const result = await createManualEntry(ctx, input);
    docId = result.id;
  } else {
    throw new ServiceError('VALIDATION', `Unknown docType: ${template.docType}`);
  }

  return {
    templateId: template.id,
    templateName: template.name,
    docType: template.docType as DocType,
    docId,
  };
}

// ---------------------------------------------------------------------------
// runDue
// ---------------------------------------------------------------------------

/**
 * Find all active templates with nextRunDate <= asOf, generate each document,
 * and advance nextRunDate by the frequency.
 */
export async function runDue(
  ctx: ServiceContext,
  asOf: Date = new Date(),
): Promise<{ generated: GeneratedDoc[] }> {
  const due = await ctx.db
    .select()
    .from(recurringTemplates)
    .where(
      and(
        eq(recurringTemplates.companyId, ctx.companyId),
        eq(recurringTemplates.isActive, true),
        lte(recurringTemplates.nextRunDate, asOf),
      ),
    );

  const generated: GeneratedDoc[] = [];

  for (const template of due) {
    const runDate = template.nextRunDate ?? asOf;
    const doc = await generateFromTemplate(ctx, template, runDate);
    generated.push(doc);

    // Advance nextRunDate past the reference time. For a template that is several periods
    // overdue, a single-step advance could leave nextRunDate still <= asOf, causing the very
    // next runDue() to generate the same template again. Catch up so it fires exactly once.
    let nextRun = advanceDate(runDate, template.frequency as Frequency);
    while (nextRun.getTime() <= asOf.getTime()) {
      nextRun = advanceDate(nextRun, template.frequency as Frequency);
    }
    await ctx.db
      .update(recurringTemplates)
      .set({ nextRunDate: nextRun })
      .where(eq(recurringTemplates.id, template.id));

    await writeAudit(ctx, {
      action: 'update',
      entityType: 'recurring_template',
      entityId: template.id,
      oldValues: { nextRunDate: runDate },
      newValues: { nextRunDate: nextRun, generatedDocId: doc.docId },
    });
  }

  return { generated };
}

// ---------------------------------------------------------------------------
// runTemplateNow
// ---------------------------------------------------------------------------

/** Generate a single template immediately, regardless of nextRunDate. */
export async function runTemplateNow(
  ctx: ServiceContext,
  id: string,
): Promise<GeneratedDoc> {
  const template = await getTemplate(ctx, id);
  const runDate = new Date();
  const doc = await generateFromTemplate(ctx, template, runDate);

  // Advance nextRunDate as if it ran on schedule, catching up past now so an overdue
  // template can't be immediately re-fired by a subsequent runDue().
  const fromDate = template.nextRunDate ?? runDate;
  let nextRun = advanceDate(fromDate, template.frequency as Frequency);
  while (nextRun.getTime() <= runDate.getTime()) {
    nextRun = advanceDate(nextRun, template.frequency as Frequency);
  }
  await ctx.db
    .update(recurringTemplates)
    .set({ nextRunDate: nextRun })
    .where(eq(recurringTemplates.id, template.id));

  await writeAudit(ctx, {
    action: 'update',
    entityType: 'recurring_template',
    entityId: template.id,
    oldValues: { nextRunDate: fromDate },
    newValues: { nextRunDate: nextRun, generatedDocId: doc.docId },
  });

  return doc;
}
