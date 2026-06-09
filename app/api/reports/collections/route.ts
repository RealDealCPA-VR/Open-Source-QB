/**
 * GET /api/reports/collections
 *   ?asOf=YYYY-MM-DD (optional, default today) — overdue invoices grouped by
 *   customer with contact details.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { collectionsReport } from '@/lib/services/reportsExtra';
import { parseDateParam, parseRange, reportError } from '../_lib';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const params = req.nextUrl.searchParams;
    const report = await collectionsReport(ctx, parseDateParam(params.get('asOf'), 'asOf'));
    return NextResponse.json(report);
  } catch (err) {
    return reportError(err, 'collections');
  }
}
