/**
 * GET /api/reports/sales-by-item
 *   ?from=YYYY-MM-DD ?to=YYYY-MM-DD (optional) — qty/revenue/COGS/margin per item.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { salesByItem } from '@/lib/services/reportsExtra';
import { parseDateParam, parseRange, reportError } from '../_lib';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const params = req.nextUrl.searchParams;
    const report = await salesByItem(ctx, parseRange(params));
    return NextResponse.json(report);
  } catch (err) {
    return reportError(err, 'sales-by-item');
  }
}
