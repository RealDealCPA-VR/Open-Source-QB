/**
 * GET /api/reports/profit-loss
 *   ?from=YYYY-MM-DD ?to=YYYY-MM-DD (optional) — defaults to all time.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { profitAndLoss } from '@/lib/services/reports';
import { parseDateParam, parseRange, reportError } from '../_lib';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const params = req.nextUrl.searchParams;
    const report = await profitAndLoss(ctx, parseRange(params));
    return NextResponse.json(report);
  } catch (err) {
    return reportError(err, 'profit-loss');
  }
}
