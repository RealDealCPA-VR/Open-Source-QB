/**
 * GET /api/billables?customerId=…  — unbilled billable time & costs for a customer
 *                                    (reimbursable bill/expense lines + unbilled time).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { listUnbilled } from '@/lib/services/billables';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' || err.code === 'UNBALANCED' || err.code === 'PERIOD_CLOSED' ? 400
      : err.code === 'FORBIDDEN' ? 403
      : err.code === 'CONFLICT' ? 409
      : 500;
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
  }
  console.error('[billables/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const customerId = req.nextUrl.searchParams.get('customerId');
    if (!customerId) {
      return NextResponse.json({ error: 'customerId is required', code: 'VALIDATION' }, { status: 400 });
    }
    const billables = await listUnbilled(ctx, customerId);
    return NextResponse.json(billables);
  } catch (err) {
    return errorResponse(err);
  }
}
