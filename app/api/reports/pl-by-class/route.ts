/**
 * GET /api/reports/pl-by-class
 *
 * Profit & Loss by Class — returns a matrix of revenue/expense accounts as rows
 * and classes as columns.
 *
 * Query params:
 *   from   ISO date string — inclusive start (optional).
 *   to     ISO date string — inclusive end (optional).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { ServiceError } from '@/lib/services/_base';
import { profitAndLossByClass } from '@/lib/services/classReports';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const sp = req.nextUrl.searchParams;

    const from = sp.get('from') ? new Date(sp.get('from')!) : undefined;
    const to = sp.get('to') ? new Date(sp.get('to')!) : undefined;

    const report = await profitAndLossByClass(ctx, { from, to });
    return NextResponse.json(report);
  } catch (err) {
    return mapError(err);
  }
}

function mapError(err: unknown): NextResponse {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'VALIDATION' || err.code === 'UNBALANCED'
          ? 400
          : err.code === 'FORBIDDEN'
            ? 403
            : err.code === 'CONFLICT'
              ? 409
              : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[reports/pl-by-class] Unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
}
