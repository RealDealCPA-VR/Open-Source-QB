/**
 * GET /api/search?q=... — global search across customers, vendors, items, and invoices.
 * Powers the Cmd/Ctrl-K command palette.
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { getServerContext } from '@/lib/context';
import { customers, vendors, items, invoices } from '@/lib/db/schema';
import { buildResults } from './results';

export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < 1) return NextResponse.json({ results: [] });
  const ctx = await getServerContext();
  const like = `%${q}%`;
  const limit = 6;

  const [cust, vend, itm, inv] = await Promise.all([
    ctx.db
      .select({ id: customers.id, label: customers.displayName })
      .from(customers)
      .where(and(eq(customers.companyId, ctx.companyId), ilike(customers.displayName, like)))
      .limit(limit),
    ctx.db
      .select({ id: vendors.id, label: vendors.displayName })
      .from(vendors)
      .where(and(eq(vendors.companyId, ctx.companyId), ilike(vendors.displayName, like)))
      .limit(limit),
    ctx.db
      .select({ id: items.id, label: items.name })
      .from(items)
      .where(and(eq(items.companyId, ctx.companyId), or(ilike(items.name, like), ilike(items.sku, like))))
      .limit(limit),
    ctx.db
      .select({ id: invoices.id, num: invoices.invoiceNumber })
      .from(invoices)
      .where(and(eq(invoices.companyId, ctx.companyId), sql`CAST(${invoices.invoiceNumber} AS TEXT) ILIKE ${like}`))
      .limit(limit),
  ]);

  return NextResponse.json({ results: buildResults({ cust, vend, itm, inv }) });
}
