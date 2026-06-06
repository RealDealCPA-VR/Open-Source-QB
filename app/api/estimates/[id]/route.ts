/**
 * GET   /api/estimates/:id           — fetch estimate with lines.
 * PATCH /api/estimates/:id           — update status (body: { status }).
 * POST  /api/estimates/:id           — action dispatch (body: { action: 'convert' }).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import {
  getEstimate,
  updateEstimateStatus,
  convertToInvoice,
  type EstimateStatus,
} from '@/lib/services/estimates';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' || err.code === 'UNBALANCED' ? 400
      : err.code === 'CONFLICT' ? 409
      : err.code === 'FORBIDDEN' ? 403
      : err.code === 'PERIOD_CLOSED' ? 400
      : 500;
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
  }
  console.error('[estimates/[id]]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const estimate = await getEstimate(ctx, id);
    return NextResponse.json(estimate);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();
    const { status } = body;

    if (!status) {
      return NextResponse.json({ error: 'Missing required field: status' }, { status: 400 });
    }

    const updated = await updateEstimateStatus(ctx, id, status as EstimateStatus);
    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();
    const { action } = body;

    if (action === 'convert') {
      const invoice = await convertToInvoice(ctx, id);
      return NextResponse.json(invoice, { status: 201 });
    }

    return NextResponse.json({ error: `Unknown action: "${action}"` }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}
