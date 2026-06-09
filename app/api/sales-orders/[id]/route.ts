/**
 * GET  /api/sales-orders/:id — fetch a single sales order with lines
 *      (lines include quantityInvoiced for backorder tracking).
 * POST /api/sales-orders/:id  { action: 'convert', lines?, date? } — convert the
 *      order to an invoice. `lines` ([{ lineId, quantity }]) invoices a partial
 *      quantity per line (omitted lines stay on backorder); without `lines` the
 *      full remaining quantity of every line is invoiced.
 * POST /api/sales-orders/:id  { action: 'status', status } — manually set the
 *      status (close a backorder / void an untouched order).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getSalesOrder, convertToInvoice, updateStatus } from '@/lib/services/salesOrders';
import { ServiceError } from '@/lib/services/_base';
import { zodErrorBody } from '@/lib/validation/helpers';
import { salesOrderActionSchema } from '@/lib/validation/salesOrders';

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
  console.error('[sales-orders/[id]/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const order = await getSalesOrder(ctx, id);
    return NextResponse.json(order);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json().catch(() => ({}));
    const parsed = salesOrderActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(zodErrorBody(parsed.error), { status: 400 });
    }

    if (parsed.data.action === 'convert') {
      const invoice = await convertToInvoice(ctx, id, {
        lines: parsed.data.lines,
        date: parsed.data.date,
      });
      return NextResponse.json(invoice, { status: 201 });
    }

    // action === 'status'
    const updated = await updateStatus(ctx, id, parsed.data.status);
    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}
