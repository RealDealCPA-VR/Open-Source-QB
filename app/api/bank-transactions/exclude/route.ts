/**
 * POST /api/bank-transactions/exclude
 *
 * Exclude a staged bank transaction from review (duplicate / personal charge),
 * or restore a previously excluded one.
 *
 * Request body:
 *   {
 *     bankTransactionId: string;
 *     restore?: boolean;   // true → restore back into the review queue
 *   }
 *
 * Response 200: the updated bank transaction row
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { ServiceError } from '@/lib/services/_base';
import { excludeTransaction, restoreExcluded } from '@/lib/services/bankCategorize';

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
    const { bankTransactionId, restore } = body ?? {};

    if (!bankTransactionId) {
      return NextResponse.json({ error: 'bankTransactionId is required.' }, { status: 400 });
    }

    const updated = restore
      ? await restoreExcluded(ctx, bankTransactionId)
      : await excludeTransaction(ctx, bankTransactionId);
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof ServiceError) return errResponse(err);
    console.error('[POST /api/bank-transactions/exclude]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
