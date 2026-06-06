/**
 * GET /api/bank-transactions?bankAccountId=<uuid>&unmatchedOnly=true|false
 *
 * Returns staged bank-feed transactions for a bank account, newest first.
 * Pass `unmatchedOnly=true` to filter to unreviewed rows only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { ServiceError } from '@/lib/services/_base';
import { listStaged } from '@/lib/services/bankCategorize';

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
    const { searchParams } = new URL(req.url);
    const bankAccountId = searchParams.get('bankAccountId');
    const unmatchedOnly = searchParams.get('unmatchedOnly') === 'true';

    if (!bankAccountId) {
      return NextResponse.json({ error: 'bankAccountId query parameter is required.' }, { status: 400 });
    }

    const rows = await listStaged(ctx, bankAccountId, { unmatchedOnly });
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof ServiceError) return errResponse(err);
    console.error('[GET /api/bank-transactions]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
