/**
 * GET  /api/estimates  — list estimates for the active company.
 * POST /api/estimates  — create a new estimate.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { listEstimates, createEstimate } from '@/lib/services/estimates';
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
  console.error('[estimates] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(_req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const data = await listEstimates(ctx);
    return NextResponse.json(data);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    const { customerId, date, expirationDate, lines, memo, taxRateId } = body;

    const estimate = await createEstimate(ctx, {
      customerId,
      date: new Date(date),
      expirationDate: expirationDate ? new Date(expirationDate) : null,
      lines: lines ?? [],
      taxRateId: taxRateId ?? null,
      memo: memo ?? null,
    });

    return NextResponse.json(estimate, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
