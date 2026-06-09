/**
 * GET /api/reports/check-detail
 *   ?from=YYYY-MM-DD ?to=YYYY-MM-DD (optional) — all checks written (expenses +
 *   bill payments by check) with split lines.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { checkDetail } from '@/lib/services/reportsExtra';
import { parseDateParam, parseRange, reportError } from '../_lib';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const params = req.nextUrl.searchParams;
    const report = await checkDetail(ctx, parseRange(params));
    return NextResponse.json(report);
  } catch (err) {
    return reportError(err, 'check-detail');
  }
}
