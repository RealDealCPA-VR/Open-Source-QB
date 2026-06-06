/**
 * Sales tax setup — agencies and rates. Invoices reference a taxRateId; the invoice service
 * computes tax and credits Sales Tax Payable. This service manages the rate/agency master data
 * and a sales-tax liability summary.
 */
import { and, eq, sql } from 'drizzle-orm';
import { taxAgencies, taxRates, invoices } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import { type ServiceContext, notFound, validation, writeAudit } from './_base';

export async function listTaxAgencies(ctx: ServiceContext) {
  return ctx.db.select().from(taxAgencies).where(eq(taxAgencies.companyId, ctx.companyId));
}

export async function createTaxAgency(
  ctx: ServiceContext,
  input: { name: string; liabilityAccountId?: string | null },
) {
  if (!input.name?.trim()) throw validation('Agency name is required.');
  const [row] = await ctx.db
    .insert(taxAgencies)
    .values({
      companyId: ctx.companyId,
      name: input.name.trim(),
      liabilityAccountId: input.liabilityAccountId ?? null,
    })
    .returning();
  await writeAudit(ctx, { action: 'create', entityType: 'tax_agency', entityId: row.id, newValues: row });
  return row;
}

export async function listTaxRates(ctx: ServiceContext, opts?: { includeInactive?: boolean }) {
  const where = opts?.includeInactive
    ? eq(taxRates.companyId, ctx.companyId)
    : and(eq(taxRates.companyId, ctx.companyId), eq(taxRates.isActive, true));
  return ctx.db.select().from(taxRates).where(where);
}

export async function createTaxRate(
  ctx: ServiceContext,
  input: { name: string; rate: string | number; agencyId?: string | null },
) {
  if (!input.name?.trim()) throw validation('Rate name is required.');
  const rate = Money.of(input.rate);
  if (rate.isNegative() || rate.greaterThan(1)) {
    throw validation('Rate must be a decimal fraction between 0 and 1 (e.g. 0.0825 for 8.25%).');
  }
  const [row] = await ctx.db
    .insert(taxRates)
    .values({
      companyId: ctx.companyId,
      name: input.name.trim(),
      rate: rate.toFixed(6),
      agencyId: input.agencyId ?? null,
    })
    .returning();
  await writeAudit(ctx, { action: 'create', entityType: 'tax_rate', entityId: row.id, newValues: row });
  return row;
}

export async function getTaxRate(ctx: ServiceContext, id: string) {
  const [row] = await ctx.db
    .select()
    .from(taxRates)
    .where(and(eq(taxRates.id, id), eq(taxRates.companyId, ctx.companyId)));
  if (!row) throw notFound('Tax rate');
  return row;
}

/** Total sales tax charged on invoices in a date range (liability owed to agencies). */
export async function salesTaxLiability(ctx: ServiceContext, range?: { from?: Date; to?: Date }) {
  const conds = [eq(invoices.companyId, ctx.companyId)];
  if (range?.from) conds.push(sql`${invoices.date} >= ${range.from}`);
  if (range?.to) conds.push(sql`${invoices.date} <= ${range.to}`);
  const [row] = await ctx.db
    .select({ total: sql<string>`COALESCE(SUM(${invoices.taxAmount}), 0)` })
    .from(invoices)
    .where(and(...conds));
  return { taxCollected: toAmountString(row?.total ?? 0) };
}
