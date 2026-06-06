/**
 * POST /api/recurring/run    — run all due templates as of a given date
 *   Body: { asOf?: string }  — ISO date string; defaults to now
 *
 * POST /api/recurring/run    — also supports { id: string } to run a single template immediately
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { runDue, runTemplateNow } from '@/lib/services/recurring';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'VALIDATION' || err.code === 'UNBALANCED'
          ? 400
          : err.code === 'CONFLICT'
            ? 409
            : err.code === 'FORBIDDEN'
              ? 403
              : err.code === 'PERIOD_CLOSED'
                ? 400
                : 500;
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
  }
  console.error('[recurring/run/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json().catch(() => ({}));

    // If an explicit template id is provided, run just that one immediately.
    if (body.id) {
      const doc = await runTemplateNow(ctx, body.id);
      return NextResponse.json({ generated: [doc] });
    }

    // Otherwise run all due templates up to asOf.
    const asOf = body.asOf ? new Date(body.asOf) : new Date();
    const result = await runDue(ctx, asOf);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
