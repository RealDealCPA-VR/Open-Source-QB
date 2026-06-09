/**
 * API route: /api/bill-payments
 *
 * GET  /api/bill-payments[?vendorId=&limit=&offset=]
 *   → 200 { payments: BillPayment[] }
 *
 * POST /api/bill-payments
 *   Body: {
 *     vendorId:         string,
 *     date:             string (ISO),
 *     method:           'cash'|'check'|'credit_card'|'ach'|'bank_transfer'|'other',
 *     reference?:       string,
 *     paymentAccountId: string,
 *     discountAccountId?: string,   // required if any application takes a discount
 *     applications: Array<{ billId: string, amountApplied: string, discountTaken?: string }>
 *   }
 *   → 201 { payment: BillPayment }
 *
 * ServiceError codes → HTTP:
 *   NOT_FOUND   → 404
 *   VALIDATION
 *   UNBALANCED  → 400
 *   FORBIDDEN   → 403
 *   CONFLICT    → 409
 *   else        → 500
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { payBills, listBillPayments } from '@/lib/services/billPayments';
import { ServiceError } from '@/lib/services/_base';

// Map ServiceError codes to HTTP status codes.
function errorStatus(code: string): number {
  switch (code) {
    case 'NOT_FOUND':    return 404;
    case 'VALIDATION':
    case 'UNBALANCED':   return 400;
    case 'FORBIDDEN':    return 403;
    case 'CONFLICT':     return 409;
    default:             return 500;
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;

    const vendorId = searchParams.get('vendorId') ?? undefined;
    const limit    = searchParams.has('limit')  ? Number(searchParams.get('limit'))  : undefined;
    const offset   = searchParams.has('offset') ? Number(searchParams.get('offset')) : undefined;

    const payments = await listBillPayments(ctx, { vendorId, limit, offset });
    return NextResponse.json({ payments });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { error: err.message, code: err.code, details: err.details ?? null },
        { status: errorStatus(err.code) },
      );
    }
    console.error('[GET /api/bill-payments]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const ctx  = await getServerContext();
    const body = await req.json();

    // Light structural validation before handing off to the service.
    if (!body.vendorId || typeof body.vendorId !== 'string') {
      return NextResponse.json({ error: 'vendorId is required.' }, { status: 400 });
    }
    if (!body.date || typeof body.date !== 'string') {
      return NextResponse.json({ error: 'date (ISO string) is required.' }, { status: 400 });
    }
    if (!body.method || typeof body.method !== 'string') {
      return NextResponse.json({ error: 'method is required.' }, { status: 400 });
    }
    if (!body.paymentAccountId || typeof body.paymentAccountId !== 'string') {
      return NextResponse.json({ error: 'paymentAccountId is required.' }, { status: 400 });
    }
    if (!Array.isArray(body.applications) || body.applications.length === 0) {
      return NextResponse.json(
        { error: 'applications must be a non-empty array.' },
        { status: 400 },
      );
    }

    const payment = await payBills(ctx, {
      vendorId:         body.vendorId,
      date:             new Date(body.date),
      method:           body.method,
      reference:        body.reference ?? null,
      paymentAccountId: body.paymentAccountId,
      discountAccountId: body.discountAccountId ?? null,
      applications:     body.applications,
    });

    return NextResponse.json({ payment }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json(
        { error: err.message, code: err.code, details: err.details ?? null },
        { status: errorStatus(err.code) },
      );
    }
    console.error('[POST /api/bill-payments]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
