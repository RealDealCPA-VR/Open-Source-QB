/**
 * GET /api/reports/balance-sheet
 *   ?asOf=YYYY-MM-DD (optional, default today)
 *   ?compareTo=YYYY-MM-DD (optional) — returns the comparative balance sheet
 *   (current vs prior columns + change) when present.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { balanceSheet } from '@/lib/services/reports';
import { balanceSheetComparative } from '@/lib/services/reportsExtra';
import { parseDateParam, parseRange, reportError } from '../_lib';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const params = req.nextUrl.searchParams;
    const asOf = parseDateParam(params.get('asOf'), 'asOf');
    const compareTo = parseDateParam(params.get('compareTo'), 'compareTo');
    if (compareTo) {
      const report = await balanceSheetComparative(ctx, asOf ?? new Date(), compareTo);
      return NextResponse.json(report);
    }
    const report = await balanceSheet(ctx, asOf);
    return NextResponse.json(report);
  } catch (err) {
    return reportError(err, 'balance-sheet');
  }
}
