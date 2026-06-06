/**
 * POST /api/sales-reps/assign
 * Body: { invoiceId: string; salesRepId: string | null }
 * Assigns (or clears) a sales rep on an existing invoice.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { assignRepToInvoice } from '@/lib/services/salesReps';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' || err.code === 'UNBALANCED' ? 400
      : err.code === 'FORBIDDEN' ? 403
      : err.code === 'CONFLICT' ? 409
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[sales-reps/assign] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();
    if (!body.invoiceId) {
      return NextResponse.json({ error: 'invoiceId is required', code: 'VALIDATION' }, { status: 400 });
    }
    const invoice = await assignRepToInvoice(ctx, {
      invoiceId: body.invoiceId,
      salesRepId: body.salesRepId ?? null,
    });
    return NextResponse.json(invoice);
  } catch (err) {
    return errorResponse(err);
  }
}
