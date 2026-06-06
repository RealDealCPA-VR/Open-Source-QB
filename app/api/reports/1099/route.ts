/**
 * GET /api/reports/1099
 *
 * Query params:
 *   year  (required) — 4-digit calendar year, e.g. 2025.
 *
 * Returns an array of Vendor1099Row for is_1099 vendors with total payments
 * >= $600 in the given year.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { vendor1099Report } from '@/lib/services/statements';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' || err.code === 'UNBALANCED' ? 400
      : err.code === 'FORBIDDEN' ? 403
      : err.code === 'CONFLICT' ? 409
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[1099] Unexpected error', err);
  return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;

    const yearParam = searchParams.get('year');
    if (!yearParam) {
      return NextResponse.json({ error: 'year query parameter is required.' }, { status: 400 });
    }

    const year = parseInt(yearParam, 10);
    if (isNaN(year) || year < 1900 || year > 2100) {
      return NextResponse.json({ error: 'Invalid year value.' }, { status: 400 });
    }

    const rows = await vendor1099Report(ctx, { year });
    return NextResponse.json(rows);
  } catch (err) {
    return errorResponse(err);
  }
}
