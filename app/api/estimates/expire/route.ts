/**
 * POST /api/estimates/expire
 *
 * Body (all optional):
 *   { asOf?: string }   — ISO date string; defaults to today's date.
 *
 * Response:
 *   { expired: number } — count of estimates that were set to 'rejected'.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { expireOverdueEstimates } from '@/lib/services/estimateExpiry';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' || err.code === 'UNBALANCED' ? 400
      : err.code === 'CONFLICT' ? 409
      : err.code === 'FORBIDDEN' ? 403
      : 500;
    return NextResponse.json(
      { error: err.message, code: err.code, details: err.details },
      { status },
    );
  }
  console.error('[estimates/expire] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();

    let body: { asOf?: string } = {};
    try {
      body = await req.json();
    } catch {
      // empty body is fine — we'll default asOf to today
    }

    const asOf = body.asOf ? new Date(body.asOf) : new Date();

    if (isNaN(asOf.getTime())) {
      return NextResponse.json(
        { error: 'Invalid asOf date.', code: 'VALIDATION' },
        { status: 400 },
      );
    }

    const expired = await expireOverdueEstimates(ctx, asOf);
    return NextResponse.json({ expired });
  } catch (err) {
    return errorResponse(err);
  }
}
