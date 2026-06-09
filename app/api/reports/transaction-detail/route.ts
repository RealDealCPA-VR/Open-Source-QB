/**
 * GET /api/reports/transaction-detail
 *   ?from= ?to= ?accountId= ?classId= ?search= ?limit= (all optional) —
 *   filterable posted journal-line listing with running totals.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { transactionDetail } from '@/lib/services/reportsExtra';
import { parseDateParam, parseRange, reportError } from '../_lib';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const params = req.nextUrl.searchParams;
    const limitStr = params.get('limit');
    const report = await transactionDetail(ctx, {
      from: parseDateParam(params.get('from'), 'from'),
      to: parseDateParam(params.get('to'), 'to'),
      accountId: params.get('accountId') ?? undefined,
      classId: params.get('classId') ?? undefined,
      search: params.get('search') ?? undefined,
      limit: limitStr ? Number(limitStr) : undefined,
    });
    return NextResponse.json(report);
  } catch (err) {
    return reportError(err, 'transaction-detail');
  }
}
