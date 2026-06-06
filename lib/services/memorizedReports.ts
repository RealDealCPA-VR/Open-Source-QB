/**
 * Memorized (saved) reports — store a report type + its filter config so users can re-run
 * a customized report later (QuickBooks "Memorized Reports").
 */
import { and, eq } from 'drizzle-orm';
import { memorizedReports } from '@/lib/db/schema';
import { type ServiceContext, notFound, validation } from './_base';

export async function listMemorizedReports(ctx: ServiceContext) {
  return ctx.db
    .select()
    .from(memorizedReports)
    .where(eq(memorizedReports.companyId, ctx.companyId));
}

export async function saveMemorizedReport(
  ctx: ServiceContext,
  input: { name: string; reportType: string; config: Record<string, unknown> },
) {
  if (!input.name?.trim()) throw validation('Report name is required.');
  if (!input.reportType?.trim()) throw validation('Report type is required.');
  const [row] = await ctx.db
    .insert(memorizedReports)
    .values({
      companyId: ctx.companyId,
      name: input.name.trim(),
      reportType: input.reportType,
      config: input.config ?? {},
    })
    .returning();
  return row;
}

export async function deleteMemorizedReport(ctx: ServiceContext, id: string) {
  const [row] = await ctx.db
    .select()
    .from(memorizedReports)
    .where(and(eq(memorizedReports.id, id), eq(memorizedReports.companyId, ctx.companyId)));
  if (!row) throw notFound('Memorized report');
  await ctx.db.delete(memorizedReports).where(eq(memorizedReports.id, id));
  return { deleted: true };
}
