/**
 * GET /api/reconciliations/[id]/report
 *
 * Previous Reconciliation report for one session: summary (beginning balance,
 * cleared deposits/payments counts + totals, cleared balance vs statement,
 * difference) plus the cleared-transaction detail and any discrepancies
 * (cleared lines whose journal entry is now void).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { ServiceError } from '@/lib/services/_base';
import { getReconciliationReport } from '@/lib/services/reconcile';

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const report = await getReconciliationReport(ctx, id);
    return NextResponse.json(report);
  } catch (err) {
    if (err instanceof ServiceError) return errResponse(err);
    console.error('[GET /api/reconciliations/:id/report]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
