/**
 * POST /api/errors/:id/analyze
 *
 * Calls the LLM corrector to analyse a specific error_detection and returns the
 * newly-created error_corrections row with the AI suggestion.
 *
 * No request body is needed; the error id is taken from the URL segment.
 */
import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { ServiceError } from '@/lib/services/_base';
import { analyzeError } from '@/lib/services/llmCorrector';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Missing error detection id' }, { status: 400 });
    }

    const ctx = await getServerContext();
    const correction = await analyzeError(ctx, id);
    return NextResponse.json({ correction }, { status: 201 });
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
    console.error('[POST /api/errors/:id/analyze]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
