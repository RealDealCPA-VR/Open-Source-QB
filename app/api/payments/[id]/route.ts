/**
 * API route: /api/payments/[id]
 *
 * GET    — fetch a single payment with its applications
 * POST   — actions on a payment:
 *            { action: 'apply',   applications: [{ invoiceId, amountApplied }] }
 *            { action: 'unapply', invoiceId, amount? }
 *            { action: 'refund',  bankAccountId, amount, date?, memo? }
 * DELETE — void the payment (reverses GL, rolls back invoice balances)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import {
  getPayment,
  voidPayment,
  applyPayment,
  unapplyFromInvoice,
  refundPayment,
} from '@/lib/services/payments';
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
    const payment = await getPayment(ctx, id);
    return NextResponse.json(payment);
  } catch (err) {
    return errorResponse(err, 'GET /api/payments/[id]');
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();

    switch (body.action) {
      case 'apply': {
        if (!Array.isArray(body.applications) || body.applications.length === 0) {
          return NextResponse.json(
            { error: 'applications must be a non-empty array.', code: 'VALIDATION' },
            { status: 400 },
          );
        }
        const result = await applyPayment(ctx, { paymentId: id, applications: body.applications });
        return NextResponse.json(result);
      }
      case 'unapply': {
        if (!body.invoiceId) {
          return NextResponse.json(
            { error: 'invoiceId is required.', code: 'VALIDATION' },
            { status: 400 },
          );
        }
        const result = await unapplyFromInvoice(ctx, {
          paymentId: id,
          invoiceId: body.invoiceId,
          amount: body.amount ?? null,
        });
        return NextResponse.json(result);
      }
      case 'refund': {
        if (!body.bankAccountId) {
          return NextResponse.json(
            { error: 'bankAccountId is required.', code: 'VALIDATION' },
            { status: 400 },
          );
        }
        if (body.amount === undefined || body.amount === null || body.amount === '') {
          return NextResponse.json(
            { error: 'amount is required.', code: 'VALIDATION' },
            { status: 400 },
          );
        }
        const result = await refundPayment(ctx, {
          paymentId: id,
          bankAccountId: body.bankAccountId,
          amount: body.amount,
          date: body.date ? new Date(body.date) : null,
          memo: body.memo ?? null,
        });
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json(
          {
            error: `Unknown action '${body.action}'. Supported: apply, unapply, refund.`,
            code: 'VALIDATION',
          },
          { status: 400 },
        );
    }
  } catch (err) {
    return errorResponse(err, 'POST /api/payments/[id]');
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const voided = await voidPayment(ctx, id);
    return NextResponse.json(voided);
  } catch (err) {
    return errorResponse(err, 'DELETE /api/payments/[id]');
  }
}
