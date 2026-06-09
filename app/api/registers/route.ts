/**
 * GET /api/registers
 *
 * Lists the accounts that get a QB-style register — bank (checking/savings),
 * credit card, A/R and A/P — with their current cached balances, for the
 * registers index page.
 */
import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { ServiceError } from '@/lib/services/_base';
import { listRegisterAccounts } from '@/lib/services/journal';

export async function GET() {
  try {
    const ctx = await getServerContext();
    const accounts = await listRegisterAccounts(ctx);
    return NextResponse.json({ accounts });
  } catch (err) {
    return mapError(err);
  }
}

// ---------------------------------------------------------------------------
// Shared error mapper (code → HTTP status).
// ---------------------------------------------------------------------------
function mapError(err: unknown): NextResponse {
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
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
  }
  console.error('[registers] Unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
}
