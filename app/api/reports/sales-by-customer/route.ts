/**
 * GET /api/reports/sales-by-customer
 *   ?from=YYYY-MM-DD ?to=YYYY-MM-DD (optional) — invoiced totals per customer.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { salesByCustomer } from '@/lib/services/reportsExtra';
import { parseDateParam, parseRange, reportError } from '../_lib';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const params = req.nextUrl.searchParams;
    const rows = await salesByCustomer(ctx, parseRange(params));
    return NextResponse.json({ rows });
  } catch (err) {
    return reportError(err, 'sales-by-customer');
  }
}
