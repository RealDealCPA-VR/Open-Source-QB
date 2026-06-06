/**
 * GET /api/reports/customer-statement
 *
 * Query params:
 *   customerId  (required) — UUID of the customer.
 *   from        (optional) — ISO date string, start of period.
 *   to          (optional) — ISO date string, end of period (inclusive).
 *
 * Returns a CustomerStatement with chronological invoice/payment lines
 * and a running balance.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { customerStatement } from '@/lib/services/statements';
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
  console.error('[customer-statement] Unexpected error', err);
  return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;

    const customerId = searchParams.get('customerId');
    if (!customerId) {
      return NextResponse.json(
        { error: 'customerId query parameter is required.' },
        { status: 400 },
      );
    }

    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');

    let from: Date | undefined;
    let to: Date | undefined;

    if (fromParam) {
      from = new Date(fromParam);
      if (isNaN(from.getTime())) {
        return NextResponse.json({ error: 'Invalid from date.' }, { status: 400 });
      }
    }
    if (toParam) {
      to = new Date(toParam);
      if (isNaN(to.getTime())) {
        return NextResponse.json({ error: 'Invalid to date.' }, { status: 400 });
      }
    }

    const statement = await customerStatement(ctx, customerId, { from, to });
    return NextResponse.json(statement);
  } catch (err) {
    return errorResponse(err);
  }
}
