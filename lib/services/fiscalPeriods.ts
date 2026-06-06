/**
 * Fiscal periods & period close. Closing a period locks it: the posting engine refuses to post or
 * void entries dated within a closed period (prevents editing prior, reported-on books).
 */
import { and, eq, lte, gte } from 'drizzle-orm';
import { fiscalPeriods } from '@/lib/db/schema';
import { type ServiceContext, ServiceError, notFound, writeAudit } from './_base';

export async function listPeriods(ctx: ServiceContext) {
  return ctx.db
    .select()
    .from(fiscalPeriods)
    .where(eq(fiscalPeriods.companyId, ctx.companyId));
}

export async function closePeriod(
  ctx: ServiceContext,
  input: { periodStart: Date; periodEnd: Date },
) {
  const [row] = await ctx.db
    .insert(fiscalPeriods)
    .values({
      companyId: ctx.companyId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      isClosed: true,
      closedAt: new Date(),
      closedBy: ctx.userId,
    })
    .returning();
  await writeAudit(ctx, {
    action: 'update',
    entityType: 'fiscal_period',
    entityId: row.id,
    newValues: { periodStart: input.periodStart, periodEnd: input.periodEnd, isClosed: true },
  });
  return row;
}

export async function reopenPeriod(ctx: ServiceContext, id: string) {
  const [existing] = await ctx.db
    .select()
    .from(fiscalPeriods)
    .where(and(eq(fiscalPeriods.id, id), eq(fiscalPeriods.companyId, ctx.companyId)));
  if (!existing) throw notFound('Fiscal period');
  const [row] = await ctx.db
    .update(fiscalPeriods)
    .set({ isClosed: false, closedAt: null, closedBy: null })
    .where(eq(fiscalPeriods.id, id))
    .returning();
  await writeAudit(ctx, {
    action: 'update',
    entityType: 'fiscal_period',
    entityId: id,
    oldValues: { isClosed: true },
    newValues: { isClosed: false },
  });
  return row;
}

/**
 * Throw PERIOD_CLOSED if `date` falls within a closed period for this company.
 * Called by the posting engine before posting or voiding.
 */
export async function assertPeriodOpen(ctx: ServiceContext, date: Date): Promise<void> {
  const closed = await ctx.db
    .select({ id: fiscalPeriods.id })
    .from(fiscalPeriods)
    .where(
      and(
        eq(fiscalPeriods.companyId, ctx.companyId),
        eq(fiscalPeriods.isClosed, true),
        lte(fiscalPeriods.periodStart, date),
        gte(fiscalPeriods.periodEnd, date),
      ),
    )
    .limit(1);
  if (closed.length) {
    throw new ServiceError(
      'PERIOD_CLOSED',
      `The accounting period containing ${date.toISOString().slice(0, 10)} is closed. Reopen it to post.`,
    );
  }
}
