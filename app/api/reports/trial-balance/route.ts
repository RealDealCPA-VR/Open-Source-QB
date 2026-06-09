/**
 * GET /api/reports/trial-balance
 *   ?asOf=YYYY-MM-DD (optional) — defaults to all time.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { trialBalance } from '@/lib/services/reports';
import { parseDateParam, parseRange, reportError } from '../_lib';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const params = req.nextUrl.searchParams;
    const report = await trialBalance(ctx, parseDateParam(params.get('asOf'), 'asOf'));
    return NextResponse.json(report);
  } catch (err) {
    return reportError(err, 'trial-balance');
  }
}
