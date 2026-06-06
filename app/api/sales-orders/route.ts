/**
 * GET  /api/sales-orders   — list all sales orders for the current company
 * POST /api/sales-orders   — create a new sales order (no GL posting)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { createSalesOrder, listSalesOrders } from '@/lib/services/salesOrders';
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
  console.error('[sales-orders/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await getServerContext();
    const orders = await listSalesOrders(ctx);
    return NextResponse.json(orders);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    if (!body.customerId) {
      return NextResponse.json({ error: 'customerId is required', code: 'VALIDATION' }, { status: 400 });
    }
    if (!body.date) {
      return NextResponse.json({ error: 'date is required', code: 'VALIDATION' }, { status: 400 });
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: 'lines must be a non-empty array', code: 'VALIDATION' }, { status: 400 });
    }

    const order = await createSalesOrder(ctx, {
      customerId: body.customerId,
      date: new Date(body.date),
      memo: body.memo ?? null,
      lines: body.lines.map((l: Record<string, unknown>) => ({
        itemId: (l.itemId as string | undefined) ?? null,
        description: (l.description as string | undefined) ?? null,
        quantity: l.quantity as string | number,
        rate: l.rate as string | number,
      })),
    });

    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
