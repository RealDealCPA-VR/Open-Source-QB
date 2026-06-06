/**
 * GET /api/integrity
 *
 * Runs all data-integrity checks for the current company and returns a
 * structured report with per-check pass/fail status.
 *
 * Response shape:
 *   { checks: [{name, ok, detail}], allOk: boolean }
 */
import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { verifyIntegrity } from '@/lib/services/integrity';
import { ServiceError } from '@/lib/services/_base';

export async function GET() {
  try {
    const ctx = await getServerContext();
    const result = await verifyIntegrity(ctx);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ServiceError) {
      const status =
        err.code === 'NOT_FOUND' ? 404
        : err.code === 'FORBIDDEN' ? 403
        : err.code === 'VALIDATION' || err.code === 'UNBALANCED' ? 400
        : err.code === 'CONFLICT' ? 409
        : 500;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('[integrity] Unexpected error', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
