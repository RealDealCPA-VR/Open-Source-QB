/**
 * GET /api/reports/commissions
 * Query params:
 *   ?from=YYYY-MM-DD  — start of date range (inclusive)
 *   ?to=YYYY-MM-DD    — end of date range (inclusive)
 *
 * Returns per-rep commission report rows and totals.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { commissionReport } from '@/lib/services/salesReps';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' || err.code === 'UNBALANCED' ? 400
      : err.code === 'FORBIDDEN' ? 403
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[reports/commissions] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;
    const fromStr = searchParams.get('from');
    const toStr = searchParams.get('to');

    const range =
      fromStr || toStr
        ? {
            from: fromStr ? new Date(fromStr) : undefined,
            to: toStr ? new Date(toStr) : undefined,
          }
        : undefined;

    const report = await commissionReport(ctx, range);
    return NextResponse.json(report);
  } catch (err) {
    return errorResponse(err);
  }
}
