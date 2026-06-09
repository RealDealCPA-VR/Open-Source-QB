/**
 * GET /api/reports/pl-percent
 *   ?from=YYYY-MM-DD ?to=YYYY-MM-DD (optional) — P&L with each line as % of income.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { profitAndLossPercentOfIncome } from '@/lib/services/reportsComparative';
import { parseDateParam, parseRange, reportError } from '../_lib';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const params = req.nextUrl.searchParams;
    const report = await profitAndLossPercentOfIncome(ctx, parseRange(params));
    return NextResponse.json(report);
  } catch (err) {
    return reportError(err, 'pl-percent');
  }
}
