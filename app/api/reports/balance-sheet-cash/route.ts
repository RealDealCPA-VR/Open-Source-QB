/**
 * GET /api/reports/balance-sheet-cash
 *
 * Query params:
 *   asOf  ISO date string (optional) — defaults to all-time.
 *
 * Returns a cash-basis Balance Sheet: accrual balances with Accounts Receivable (1200) and
 * Accounts Payable (2000) removed, and equity reduced by (arRemoved − apRemoved) so that
 * Assets = Liabilities + Equity continues to hold.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { balanceSheetCashBasis } from '@/lib/services/balanceSheetCashBasis';
import { ServiceError } from '@/lib/services/_base';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();

    const asOfParam = req.nextUrl.searchParams.get('asOf');
    let asOf: Date | undefined;
    if (asOfParam) {
      asOf = new Date(asOfParam);
      if (isNaN(asOf.getTime())) {
        return NextResponse.json({ error: 'Invalid asOf date.' }, { status: 400 });
      }
    }

    const report = await balanceSheetCashBasis(ctx, asOf);
    return NextResponse.json(report);
  } catch (err) {
    if (err instanceof ServiceError) {
      const status =
        err.code === 'NOT_FOUND' ? 404
        : err.code === 'FORBIDDEN' ? 403
        : err.code === 'VALIDATION' || err.code === 'UNBALANCED' ? 400
        : err.code === 'CONFLICT' ? 409
        : 500;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('[balance-sheet-cash] Unexpected error', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
