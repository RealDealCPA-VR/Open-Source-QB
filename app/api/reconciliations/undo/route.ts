/**
 * POST /api/reconciliations/undo
 *
 * Undo the most recent COMPLETED reconciliation for a bank account
 * (QB Banking ▸ Reconcile ▸ Undo Last Reconciliation).
 *
 * Body: { bankAccountId: string }
 * Response: the reconciliation row, now with status "undone".
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { ServiceError } from '@/lib/services/_base';
import { undoLastReconciliation } from '@/lib/services/reconcile';

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

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();
    const { bankAccountId } = body ?? {};
    if (!bankAccountId) {
      return NextResponse.json({ error: 'bankAccountId is required.' }, { status: 400 });
    }
    const undone = await undoLastReconciliation(ctx, bankAccountId);
    return NextResponse.json(undone);
  } catch (err) {
    if (err instanceof ServiceError) return errResponse(err);
    console.error('[POST /api/reconciliations/undo]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
