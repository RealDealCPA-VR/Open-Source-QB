/**
 * GET /api/reports/missing-checks
 *   ?accountId=<uuid> (optional) — gaps in the check-number sequence per bank account.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { missingChecks } from '@/lib/services/reportsExtra';
import { parseDateParam, parseRange, reportError } from '../_lib';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const params = req.nextUrl.searchParams;
    const report = await missingChecks(ctx, params.get('accountId') ?? undefined);
    return NextResponse.json(report);
  } catch (err) {
    return reportError(err, 'missing-checks');
  }
}
