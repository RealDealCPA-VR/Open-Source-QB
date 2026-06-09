/**
 * PATCH /api/users/[id] — change a member's role in the active company.
 * Body: { role: 'owner' | 'admin' | 'accountant' | 'viewer' }
 * Admin/owner only (granting 'owner' requires being the owner); the company owner's
 * role can never be changed. Enforced in lib/services/rbac.ts setMemberRole.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { setMemberRole, type Role } from '@/lib/services/rbac';
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
  console.error('[users/[id]/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();
    if (typeof body.role !== 'string') {
      return NextResponse.json({ error: 'role is required', code: 'VALIDATION' }, { status: 400 });
    }
    const member = await setMemberRole(ctx, id, body.role as Role);
    return NextResponse.json(member);
  } catch (err) {
    return errorResponse(err);
  }
}
