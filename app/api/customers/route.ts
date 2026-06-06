/**
 * GET  /api/customers  — list customers for the active company.
 * POST /api/customers  — create a new customer.
 *
 * Query params for GET:
 *   ?includeInactive=true  — include deactivated customers.
 *   ?balanceSummary=true   — instead of the full list, return the balance summary.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import {
  listCustomers,
  createCustomer,
  customerBalanceSummary,
} from '@/lib/services/customers';
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
  console.error('[customers] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;

    if (searchParams.get('balanceSummary') === 'true') {
      const summary = await customerBalanceSummary(ctx);
      return NextResponse.json(summary);
    }

    const includeInactive = searchParams.get('includeInactive') === 'true';
    const list = await listCustomers(ctx, { includeInactive });
    return NextResponse.json(list);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();
    const customer = await createCustomer(ctx, body);
    return NextResponse.json(customer, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
