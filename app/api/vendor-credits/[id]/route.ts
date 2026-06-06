/**
 * GET    /api/vendor-credits/:id                      — fetch a credit with its lines
 * POST   /api/vendor-credits/:id  { action: 'apply', billId, amount }  — apply to a bill
 * DELETE /api/vendor-credits/:id                      — void the credit
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getVendorCredit, applyToBill, voidVendorCredit } from '@/lib/services/vendorCredits';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'VALIDATION' || err.code === 'UNBALANCED' || err.code === 'PERIOD_CLOSED'
          ? 400
          : err.code === 'FORBIDDEN'
            ? 403
            : err.code === 'CONFLICT'
              ? 409
              : 500;
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
  }
  console.error('[vendor-credits/[id]/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const credit = await getVendorCredit(ctx, id);
    return NextResponse.json(credit);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();

    if (body.action !== 'apply') {
      return NextResponse.json(
        { error: 'Unknown action. Expected action: "apply".', code: 'VALIDATION' },
        { status: 400 },
      );
    }
    if (!body.billId) {
      return NextResponse.json({ error: 'billId is required', code: 'VALIDATION' }, { status: 400 });
    }
    if (!body.amount) {
      return NextResponse.json({ error: 'amount is required', code: 'VALIDATION' }, { status: 400 });
    }

    const result = await applyToBill(ctx, {
      vendorCreditId: id,
      billId: body.billId,
      amount: body.amount,
    });

    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const voided = await voidVendorCredit(ctx, id);
    return NextResponse.json(voided);
  } catch (err) {
    return errorResponse(err);
  }
}
