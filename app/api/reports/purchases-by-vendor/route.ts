/**
 * GET /api/reports/purchases-by-vendor
 *   ?from=YYYY-MM-DD ?to=YYYY-MM-DD (optional) — billed totals per vendor.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { expensesByVendor } from '@/lib/services/reportsExtra';
import { parseDateParam, parseRange, reportError } from '../_lib';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const params = req.nextUrl.searchParams;
    const rows = await expensesByVendor(ctx, parseRange(params));
    return NextResponse.json({ rows });
  } catch (err) {
    return reportError(err, 'purchases-by-vendor');
  }
}
