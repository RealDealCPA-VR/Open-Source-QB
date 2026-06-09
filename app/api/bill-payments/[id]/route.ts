/**
 * API route: /api/bill-payments/[id]
 *
 * GET    — fetch a single bill payment with its bill applications
 * DELETE — void the bill payment (reverses GL, rolls back bill balances)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getBillPayment, voidBillPayment } from '@/lib/services/billPayments';
import { ServiceError } from '@/lib/services/_base';

// Map ServiceError codes to HTTP status codes.
function errorStatus(code: ServiceError['code']): number {
  switch (code) {
    case 'NOT_FOUND':     return 404;
    case 'VALIDATION':    return 400;
    case 'UNBALANCED':    return 400;
    case 'FORBIDDEN':     return 403;
    case 'CONFLICT':      return 409;
    case 'PERIOD_CLOSED': return 422;
    default:              return 500;
  }
}

function errorResponse(err: unknown, label: string) {
  if (err instanceof ServiceError) {
    return NextResponse.json(
      { error: err.message, code: err.code, details: err.details },
      { status: errorStatus(err.code) },
    );
  }
  console.error(`[${label}]`, err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const payment = await getBillPayment(ctx, id);
    return NextResponse.json(payment);
  } catch (err) {
    return errorResponse(err, 'GET /api/bill-payments/[id]');
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const voided = await voidBillPayment(ctx, id);
    return NextResponse.json(voided);
  } catch (err) {
    return errorResponse(err, 'DELETE /api/bill-payments/[id]');
  }
}
