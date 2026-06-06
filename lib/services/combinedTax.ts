/**
 * Combined / multi-component sales-tax rates — QuickBooks-style combined rates.
 *
 * A single `taxRates` row can be composed of multiple `taxRateComponents` (e.g.
 * state 6% + county 1% + city 0.5% = 7.5%).  Writing components always
 * recomputes and persists the parent rate so the invoicing engine sees the
 * correct combined fraction without any extra work.
 *
 * `salesTaxByAgency` splits total collected tax across components/agencies
 * proportionally by their rate share.
 */
import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { taxRates, taxRateComponents, taxAgencies, invoices } from '@/lib/db/schema';
import { Money, toAmountString } from '@/lib/money';
import { type ServiceContext, notFound, validation, writeAudit, inTransaction } from './_base';

// ---------------------------------------------------------------------------
// listComponents
// ---------------------------------------------------------------------------

export async function listComponents(ctx: ServiceContext, taxRateId: string) {
  // Verify the tax rate belongs to this company.
  const [rate] = await ctx.db
    .select()
    .from(taxRates)
    .where(and(eq(taxRates.id, taxRateId), eq(taxRates.companyId, ctx.companyId)));
  if (!rate) throw notFound('Tax rate');

  return ctx.db
    .select()
    .from(taxRateComponents)
    .where(
      and(
        eq(taxRateComponents.taxRateId, taxRateId),
        eq(taxRateComponents.companyId, ctx.companyId),
      ),
    );
}

// ---------------------------------------------------------------------------
// setComponents
// ---------------------------------------------------------------------------

export interface ComponentInput {
  name: string;
  agencyId?: string | null;
  rate: string | number;
}

/**
 * Replace all components for a tax rate and recompute the parent rate.
 * Returns the updated list of components.
 */
export async function setComponents(
  ctx: ServiceContext,
  taxRateId: string,
  components: ComponentInput[],
) {
  if (!Array.isArray(components)) throw validation('components must be an array.');

  // Validate and convert each component rate.
  const parsed = components.map((c, i) => {
    if (!c.name?.trim()) throw validation(`Component ${i + 1}: name is required.`);
    const r = Money.of(c.rate);
    if (r.isNegative() || r.greaterThan(1)) {
      throw validation(
        `Component ${i + 1}: rate must be a decimal fraction between 0 and 1 (e.g. 0.06 for 6%).`,
      );
    }
    return { name: c.name.trim(), agencyId: c.agencyId ?? null, rate: r };
  });

  return inTransaction(ctx, async (tx) => {
    // Verify ownership.
    const [rate] = await tx.db
      .select()
      .from(taxRates)
      .where(and(eq(taxRates.id, taxRateId), eq(taxRates.companyId, tx.companyId)));
    if (!rate) throw notFound('Tax rate');

    // If agencyIds supplied, verify they belong to this company.
    const agencyIds = parsed
      .map((c) => c.agencyId)
      .filter((id): id is string => id !== null && id !== undefined);
    if (agencyIds.length > 0) {
      const existing = await tx.db
        .select({ id: taxAgencies.id })
        .from(taxAgencies)
        .where(
          and(
            eq(taxAgencies.companyId, tx.companyId),
            sql`${taxAgencies.id} = ANY(ARRAY[${sql.join(
              agencyIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )}])`,
          ),
        );
      const foundIds = new Set(existing.map((r) => r.id));
      for (const id of agencyIds) {
        if (!foundIds.has(id)) throw notFound(`Tax agency ${id}`);
      }
    }

    // Delete existing components.
    await tx.db
      .delete(taxRateComponents)
      .where(
        and(
          eq(taxRateComponents.taxRateId, taxRateId),
          eq(taxRateComponents.companyId, tx.companyId),
        ),
      );

    // Insert new components.
    let combinedRate = Money.zero();
    let rows: (typeof taxRateComponents.$inferSelect)[] = [];

    if (parsed.length > 0) {
      rows = await tx.db
        .insert(taxRateComponents)
        .values(
          parsed.map((c) => ({
            companyId: tx.companyId,
            taxRateId,
            name: c.name,
            agencyId: c.agencyId,
            rate: c.rate.toFixed(6),
          })),
        )
        .returning();

      for (const c of parsed) combinedRate = combinedRate.plus(c.rate);
    }

    // Recompute parent taxRates.rate = sum of components.
    const newRate = combinedRate.toFixed(6);
    await tx.db
      .update(taxRates)
      .set({ rate: newRate })
      .where(eq(taxRates.id, taxRateId));

    await writeAudit(tx, {
      action: 'update',
      entityType: 'tax_rate_components',
      entityId: taxRateId,
      oldValues: { previousRate: rate.rate },
      newValues: { newRate, components: rows },
    });

    return rows;
  });
}

// ---------------------------------------------------------------------------
// salesTaxByAgency
// ---------------------------------------------------------------------------

export interface AgencyTaxRow {
  agencyId: string | null;
  agencyName: string | null;
  componentName: string;
  componentRate: string;
  rateShare: string; // fraction of parent rate
  taxCollected: string; // dollar amount for the period
}

export interface SalesTaxByAgencyResult {
  rows: AgencyTaxRow[];
  total: string;
}

/**
 * Total sales tax collected on invoices in the date range, split across
 * components/agencies proportionally by their rate share.
 *
 * For invoices that reference a tax rate composed of multiple components, this
 * allocates `invoice.taxAmount` to each component proportional to `component.rate
 * / sum(component.rates)`.  Invoices that reference a rate with no components
 * are reported as a single "uncategorized" bucket.
 */
export async function salesTaxByAgency(
  ctx: ServiceContext,
  range?: { from?: Date; to?: Date },
): Promise<SalesTaxByAgencyResult> {
  // 1. Fetch invoices in range for this company.
  const conds = [eq(invoices.companyId, ctx.companyId)];
  if (range?.from) conds.push(gte(invoices.date, range.from));
  if (range?.to) conds.push(lte(invoices.date, range.to));

  const invoiceRows = await ctx.db
    .select({
      id: invoices.id,
      taxRateId: invoices.taxRateId,
      taxAmount: invoices.taxAmount,
    })
    .from(invoices)
    .where(and(...conds));

  // 2. Collect all unique taxRateIds.
  const taxRateIds = [...new Set(invoiceRows.map((i) => i.taxRateId).filter(Boolean))] as string[];

  // 3. Load components for those rates (with agency name via join).
  type ComponentRow = {
    id: string;
    taxRateId: string;
    name: string;
    agencyId: string | null;
    agencyName: string | null;
    rate: string;
  };

  let componentRows: ComponentRow[] = [];
  if (taxRateIds.length > 0) {
    componentRows = await ctx.db
      .select({
        id: taxRateComponents.id,
        taxRateId: taxRateComponents.taxRateId,
        name: taxRateComponents.name,
        agencyId: taxRateComponents.agencyId,
        agencyName: taxAgencies.name,
        rate: taxRateComponents.rate,
      })
      .from(taxRateComponents)
      .leftJoin(taxAgencies, eq(taxRateComponents.agencyId, taxAgencies.id))
      .where(
        and(
          eq(taxRateComponents.companyId, ctx.companyId),
          sql`${taxRateComponents.taxRateId} = ANY(ARRAY[${sql.join(
            taxRateIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}])`,
        ),
      );
  }

  // 4. Group components by taxRateId.
  const componentsByRate = new Map<string, ComponentRow[]>();
  for (const c of componentRows) {
    const list = componentsByRate.get(c.taxRateId) ?? [];
    list.push(c);
    componentsByRate.set(c.taxRateId, list);
  }

  // 5. Allocate each invoice's taxAmount across its components.
  // Accumulate per (agencyId, componentName, componentRate).
  type Key = string; // agencyId|componentName|rate
  const accumulated = new Map<
    Key,
    {
      agencyId: string | null;
      agencyName: string | null;
      componentName: string;
      componentRate: string;
      rateShare: string;
      collected: ReturnType<typeof Money.zero>;
    }
  >();

  let grandTotal = Money.zero();

  for (const inv of invoiceRows) {
    const taxAmt = Money.of(inv.taxAmount);
    if (taxAmt.isZero()) continue;
    grandTotal = grandTotal.plus(taxAmt);

    if (!inv.taxRateId) {
      // No tax rate — lump into uncategorized.
      const key = '__none__|uncategorized|0.000000';
      const entry = accumulated.get(key) ?? {
        agencyId: null,
        agencyName: null,
        componentName: 'Uncategorized',
        componentRate: '0.000000',
        rateShare: '1.000000',
        collected: Money.zero(),
      };
      entry.collected = entry.collected.plus(taxAmt);
      accumulated.set(key, entry);
      continue;
    }

    const comps = componentsByRate.get(inv.taxRateId) ?? [];

    if (comps.length === 0) {
      // Rate exists but no components — report as single row.
      const key = `${inv.taxRateId}|ungrouped|0.000000`;
      const entry = accumulated.get(key) ?? {
        agencyId: null,
        agencyName: null,
        componentName: 'Tax',
        componentRate: '0.000000',
        rateShare: '1.000000',
        collected: Money.zero(),
      };
      entry.collected = entry.collected.plus(taxAmt);
      accumulated.set(key, entry);
      continue;
    }

    // Compute total rate for proportional allocation.
    const totalRate = comps.reduce((s, c) => s.plus(Money.of(c.rate)), Money.zero());

    for (const comp of comps) {
      const share = totalRate.isZero()
        ? Money.of(1).dividedBy(comps.length)
        : Money.of(comp.rate).dividedBy(totalRate);

      const portion = taxAmt.times(share);
      const key = `${comp.agencyId ?? '__none__'}|${comp.name}|${comp.rate}`;
      const rateShare = totalRate.isZero()
        ? (1 / comps.length).toFixed(6)
        : share.toFixed(6);

      const entry = accumulated.get(key) ?? {
        agencyId: comp.agencyId,
        agencyName: comp.agencyName ?? null,
        componentName: comp.name,
        componentRate: comp.rate,
        rateShare,
        collected: Money.zero(),
      };
      entry.collected = entry.collected.plus(portion);
      accumulated.set(key, entry);
    }
  }

  const rows: AgencyTaxRow[] = [...accumulated.values()].map((e) => ({
    agencyId: e.agencyId,
    agencyName: e.agencyName,
    componentName: e.componentName,
    componentRate: e.componentRate,
    rateShare: e.rateShare,
    taxCollected: toAmountString(e.collected),
  }));

  return { rows, total: toAmountString(grandTotal) };
}
