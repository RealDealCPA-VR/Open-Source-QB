/**
 * GET    /api/sales-receipts/:id   — fetch a sales receipt with its lines
 * DELETE /api/sales-receipts/:id   — void a sales receipt (reverses GL + restores inventory)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getSalesReceipt, voidSalesReceipt } from '@/lib/services/salesReceipts';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'VALIDATION' || err.code === 'UNBALANCED'
          ? 400
          : err.code === 'FORBIDDEN'
            ? 403
            : err.code === 'CONFLICT'
              ? 409
              : 500;
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
  }
  console.error('[sales-receipts/[id]/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const receipt = await getSalesReceipt(ctx, id);
    return NextResponse.json(receipt);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const voided = await voidSalesReceipt(ctx, id);
    return NextResponse.json(voided);
  } catch (err) {
    return errorResponse(err);
  }
}
