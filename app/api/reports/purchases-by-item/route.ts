/**
 * GET /api/reports/purchases-by-item
 *   ?from=YYYY-MM-DD ?to=YYYY-MM-DD (optional) — qty/cost per item from vendor bills.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { purchasesByItem } from '@/lib/services/reportsExtra';
import { parseDateParam, parseRange, reportError } from '../_lib';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const params = req.nextUrl.searchParams;
    const report = await purchasesByItem(ctx, parseRange(params));
    return NextResponse.json(report);
  } catch (err) {
    return reportError(err, 'purchases-by-item');
  }
}
