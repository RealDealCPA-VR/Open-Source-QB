/**
 * GET /api/reports/deposit-detail
 *   ?from=YYYY-MM-DD ?to=YYYY-MM-DD (optional) — deposits with their line items.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { depositDetail } from '@/lib/services/reportsExtra';
import { parseDateParam, parseRange, reportError } from '../_lib';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const params = req.nextUrl.searchParams;
    const report = await depositDetail(ctx, parseRange(params));
    return NextResponse.json(report);
  } catch (err) {
    return reportError(err, 'deposit-detail');
  }
}
