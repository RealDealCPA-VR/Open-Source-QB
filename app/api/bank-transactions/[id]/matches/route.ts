/**
 * GET /api/bank-transactions/[id]/matches
 *
 * Suggest existing posted journal entries that the staged bank transaction can
 * be matched to (QB Bank Feeds "Match"). Candidates hit the bank account's GL
 * account for exactly the feed amount, dated within ±14 days, ranked with exact
 * check-number/reference matches first then by date proximity.
 *
 * Response 200: MatchCandidate[]
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { ServiceError } from '@/lib/services/_base';
import { suggestMatches } from '@/lib/services/bankCategorize';

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

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const candidates = await suggestMatches(ctx, id);
    return NextResponse.json(candidates);
  } catch (err) {
    if (err instanceof ServiceError) return errResponse(err);
    console.error('[GET /api/bank-transactions/[id]/matches]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
