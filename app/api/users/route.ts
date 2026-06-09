/**
 * GET /api/users — list members of the active company (id, email, name, role).
 * Role changes go through PATCH /api/users/[id].
 */
import { NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { listMembers } from '@/lib/services/rbac';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' ? 400
      : err.code === 'FORBIDDEN' ? 403
      : err.code === 'CONFLICT' ? 409
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[users/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await getServerContext();
    const members = await listMembers(ctx);
    return NextResponse.json(members);
  } catch (err) {
    return errorResponse(err);
  }
}
