/**
 * GET /api/reconciliations/discrepancies[?bankAccountId=<uuid>]
 *
 * Reconciliation Discrepancy report: lines cleared in a COMPLETED reconciliation
 * whose journal entry has since been voided (historical anomalies — new voids of
 * reconciled lines are blocked by the posting engine).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { ServiceError } from '@/lib/services/_base';
import { reconciliationDiscrepancies } from '@/lib/services/reconcile';

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

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const bankAccountId = req.nextUrl.searchParams.get('bankAccountId') ?? undefined;
    const rows = await reconciliationDiscrepancies(ctx, bankAccountId);
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof ServiceError) return errResponse(err);
    console.error('[GET /api/reconciliations/discrepancies]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
