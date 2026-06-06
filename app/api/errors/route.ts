/**
 * GET  /api/errors          — list error_detections (optionally filtered by ?resolved=true/false)
 * POST /api/errors          — run detectErrors() and return newly-created detections
 */
import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { ServiceError } from '@/lib/services/_base';
import { detectErrors, listErrors } from '@/lib/services/errorDetection';

export async function GET(request: Request) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = new URL(request.url);
    const resolvedParam = searchParams.get('resolved');

    let resolved: boolean | undefined;
    if (resolvedParam === 'true') resolved = true;
    else if (resolvedParam === 'false') resolved = false;

    const detections = await listErrors(ctx, { resolved });
    return NextResponse.json({ detections });
  } catch (err) {
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
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('[GET /api/errors]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const ctx = await getServerContext();
    const detections = await detectErrors(ctx);
    return NextResponse.json({ detections, count: detections.length }, { status: 201 });
  } catch (err) {
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
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('[POST /api/errors]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
