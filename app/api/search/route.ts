/**
 * GET /api/search?q=... — global search across customers, vendors, items, invoices, bills,
 * payments (by reference), employees, accounts, journal entries, and exact amounts against
 * invoice/bill/expense totals. Powers the Cmd/Ctrl-K command palette.
 *
 * Session-checked via getServerContext (fails closed once any user exists) and scoped to the
 * caller's active company. Queries run in parallel with a per-type LIMIT to stay fast.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { ServiceError } from '@/lib/services/_base';
import { runGlobalSearch } from './queries';
import { buildResults } from './results';

export async function GET(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  if (q.length < 1) return NextResponse.json({ results: [] });
  try {
    const ctx = await getServerContext();
    const hits = await runGlobalSearch(ctx.db, ctx.companyId, q);
    return NextResponse.json({ results: buildResults(hits) });
  } catch (err) {
    if (err instanceof ServiceError && err.code === 'FORBIDDEN') {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
    }
    console.error('[search] unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
