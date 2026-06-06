/**
 * POST /api/errors/:id/apply
 *
 * Applies a pending error_corrections row: marks it "applied", resolves the parent
 * error_detection, and writes an audit row. The request body must supply the
 * correction id (the id segment is the error DETECTION id, not the correction id).
 *
 * Request body: { correctionId: string }
 */
import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { ServiceError } from '@/lib/services/_base';
import { applyCorrection } from '@/lib/services/llmCorrector';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // The URL segment (:id) is the detection id — we accept the correctionId in
    // the request body so the caller can unambiguously target a specific suggestion
    // (a detection can have multiple correction suggestions over time).
    const { id: _detectionId } = await params;

    let body: { correctionId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { correctionId } = body;
    if (!correctionId) {
      return NextResponse.json(
        { error: 'correctionId is required in the request body' },
        { status: 400 },
      );
    }

    const ctx = await getServerContext();
    const correction = await applyCorrection(ctx, correctionId);
    return NextResponse.json({ correction });
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
    console.error('[POST /api/errors/:id/apply]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
