/**
 * API route: /api/payments
 *
 * GET  — list payments received (optionally filtered by ?customerId=)
 * POST — record a new payment received from a customer
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { receivePayment, listPayments } from '@/lib/services/payments';
import { ServiceError } from '@/lib/services/_base';
import { zodErrorBody } from '@/lib/validation/helpers';
import { receivePaymentSchema } from '@/lib/validation/payments';

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

// ---- GET /api/payments -------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;
    const customerId = searchParams.get('customerId') ?? undefined;
    const limit = searchParams.has('limit') ? Number(searchParams.get('limit')) : undefined;
    const offset = searchParams.has('offset') ? Number(searchParams.get('offset')) : undefined;

    const payments = await listPayments(ctx, { customerId, limit, offset });
    return NextResponse.json({ payments });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { error: err.message, code: err.code, details: err.details },
        { status: errorStatus(err.code) },
      );
    }
    console.error('[GET /api/payments]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---- POST /api/payments ------------------------------------------------------

/**
 * Expected request body (JSON):
 * {
 *   customerId:       string (uuid),
 *   date:             string (ISO date),
 *   method:           'cash'|'check'|'credit_card'|'ach'|'bank_transfer'|'other',
 *   reference?:       string,
 *   amount:           string (decimal, e.g. "1500.00"),
 *   depositAccountId?: string (uuid — defaults to Undeposited Funds),
 *   applications:     Array<{ invoiceId: string, amountApplied: string }>,
 *   currency?:        string (ISO 4217 — defaults to base currency),
 *   exchangeRate?:    string (base units per 1 payment-currency unit — defaults to 1)
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json().catch(() => ({}));
    const parsed = receivePaymentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(zodErrorBody(parsed.error), { status: 400 });
    }

    const result = await receivePayment(ctx, parsed.data);

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { error: err.message, code: err.code, details: err.details },
        { status: errorStatus(err.code) },
      );
    }
    console.error('[POST /api/payments]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
