/**
 * GET  /api/purchase-orders/:id              — fetch a purchase order with its lines
 * POST /api/purchase-orders/:id  { action }  — dispatch actions on a PO
 *   action = 'convert'  → convertToBill (creates bill, posts A/P, closes PO)
 *   action = 'void'     → updateStatus to 'void'
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import {
  getPurchaseOrder,
  updateStatus,
  convertToBill,
} from '@/lib/services/purchaseOrders';
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
    return NextResponse.json(
      { error: err.message, code: err.code, details: err.details },
      { status },
    );
  }
  console.error('[purchase-orders/[id]/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const po = await getPurchaseOrder(ctx, id);
    return NextResponse.json(po);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();
    const action = body?.action as string | undefined;

    if (action === 'convert') {
      const bill = await convertToBill(ctx, id);
      return NextResponse.json(bill);
    }

    if (action === 'void') {
      const po = await updateStatus(ctx, id, 'void');
      return NextResponse.json(po);
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}. Expected 'convert' or 'void'.`, code: 'VALIDATION' },
      { status: 400 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
