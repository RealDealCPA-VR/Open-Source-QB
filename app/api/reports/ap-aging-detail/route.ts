/**
 * GET /api/reports/ap-aging-detail
 *   ?asOf=YYYY-MM-DD (optional, default today) — per-bill AP aging rows.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { apAgingDetail } from '@/lib/services/reportsExtra';
import { parseDateParam, parseRange, reportError } from '../_lib';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const params = req.nextUrl.searchParams;
    const report = await apAgingDetail(ctx, parseDateParam(params.get('asOf'), 'asOf'));
    return NextResponse.json(report);
  } catch (err) {
    return reportError(err, 'ap-aging-detail');
  }
}
