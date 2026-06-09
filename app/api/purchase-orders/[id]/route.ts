/**
 * GET  /api/purchase-orders/:id              — fetch a purchase order with its lines
 *   (lines include quantityBilled for billed/remaining display)
 * POST /api/purchase-orders/:id  { action }  — dispatch actions on a PO
 *   action = 'convert'  → convertToBill (creates bill, posts A/P)
 *     Optional body fields for partial billing:
 *       lines:      [{ lineId, quantity }]  — per-line quantities to bill
 *                   (omitted → bill the full remaining quantity of every line)
 *       date:       bill date (defaults to the PO date)
 *       billNumber: vendor bill / reference number
 *     PO status moves open → partial → closed as quantities are billed.
 *   action = 'void'     → updateStatus to 'void'
 *   action = 'close'    → updateStatus to 'closed' (stop further billing)
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
      let lines: { lineId: string; quantity: string | number }[] | undefined;
      if (body.lines !== undefined) {
        if (!Array.isArray(body.lines) || body.lines.length === 0) {
          return NextResponse.json(
            { error: 'lines must be a non-empty array of { lineId, quantity }', code: 'VALIDATION' },
            { status: 400 },
          );
        }
        for (const l of body.lines) {
          if (!l || typeof l.lineId !== 'string' || l.quantity == null) {
            return NextResponse.json(
              { error: 'Each billing line requires lineId and quantity', code: 'VALIDATION' },
              { status: 400 },
            );
          }
        }
        lines = body.lines.map((l: { lineId: string; quantity: string | number }) => ({
          lineId: l.lineId,
          quantity: l.quantity,
        }));
      }

      const bill = await convertToBill(ctx, id, {
        lines,
        date: body.date ? new Date(body.date) : undefined,
        billNumber: body.billNumber ?? null,
      });
      return NextResponse.json(bill);
    }

    if (action === 'void') {
      const po = await updateStatus(ctx, id, 'void');
      return NextResponse.json(po);
    }

    if (action === 'close') {
      const po = await updateStatus(ctx, id, 'closed');
      return NextResponse.json(po);
    }

    return NextResponse.json(
      {
        error: `Unknown action: ${action}. Expected 'convert', 'void', or 'close'.`,
        code: 'VALIDATION',
      },
      { status: 400 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
