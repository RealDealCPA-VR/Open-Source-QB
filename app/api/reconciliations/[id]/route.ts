/**
 * GET  /api/reconciliations/[id]  — fetch reconciliation progress.
 * PATCH /api/reconciliations/[id] — complete the reconciliation, or toggle a line.
 *
 * PATCH request body variants:
 *
 *   Complete the reconciliation:
 *     { action: "complete" }
 *
 *   Toggle a journal entry line as cleared / un-cleared:
 *     { action: "toggleCleared", journalEntryLineId: string, isCleared: boolean }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { ServiceError } from '@/lib/services/_base';
import {
  getProgress,
  completeReconciliation,
  toggleCleared,
  listClearable,
} from '@/lib/services/reconcile';

/** Map ServiceErrorCode to an HTTP status. */
function errResponse(err: ServiceError): NextResponse {
  const statusMap: Record<string, number> = {
    NOT_FOUND: 404,
    VALIDATION: 400,
    UNBALANCED: 400,
    FORBIDDEN: 403,
    CONFLICT: 409,
    PERIOD_CLOSED: 400,
  };
  return NextResponse.json(
    { error: err.message, code: err.code, details: err.details ?? null },
    { status: statusMap[err.code] ?? 500 },
  );
}

// ---------------------------------------------------------------------------
// GET /api/reconciliations/[id]
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const progress = await getProgress(ctx, id);
    return NextResponse.json(progress);
  } catch (err) {
    if (err instanceof ServiceError) return errResponse(err);
    console.error('[GET /api/reconciliations/:id]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/reconciliations/[id]
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();
    const { action } = body ?? {};

    if (action === 'complete') {
      const completed = await completeReconciliation(ctx, id);
      return NextResponse.json(completed);
    }

    if (action === 'toggleCleared') {
      const { journalEntryLineId, isCleared } = body ?? {};
      if (!journalEntryLineId) {
        return NextResponse.json({ error: 'journalEntryLineId is required.' }, { status: 400 });
      }
      if (typeof isCleared !== 'boolean') {
        return NextResponse.json({ error: 'isCleared (boolean) is required.' }, { status: 400 });
      }
      await toggleCleared(ctx, id, journalEntryLineId, isCleared);
      // Return updated progress so the client can refresh in one round-trip.
      const progress = await getProgress(ctx, id);
      return NextResponse.json(progress);
    }

    return NextResponse.json(
      { error: `Unknown action "${action}". Expected "complete" or "toggleCleared".` },
      { status: 400 },
    );
  } catch (err) {
    if (err instanceof ServiceError) return errResponse(err);
    console.error('[PATCH /api/reconciliations/:id]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
