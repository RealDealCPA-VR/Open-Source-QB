/**
 * GET  /api/accounts            — list chart of accounts (?includeInactive=true, ?tree=true)
 * POST /api/accounts            — create an account
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { listAccounts, createAccount, getAccountTree } from '@/lib/services/accounts';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' || err.code === 'UNBALANCED' ? 400
      : err.code === 'FORBIDDEN' ? 403
      : err.code === 'CONFLICT' ? 409
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[accounts] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = new URL(req.url);
    if (searchParams.get('tree') === 'true') {
      return NextResponse.json(await getAccountTree(ctx));
    }
    const includeInactive = searchParams.get('includeInactive') === 'true';
    return NextResponse.json(await listAccounts(ctx, { includeInactive }));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();
    const account = await createAccount(ctx, body);
    return NextResponse.json(account, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
