/**
 * PATCH  /api/companies/[id]  — rename a company file (owner/admin only).
 * DELETE /api/companies/[id]  — archive (soft-delete) a company file (owner only;
 *                               ?confirm=<exact company name> required; refuses the
 *                               caller's only active company). See manage.ts for why
 *                               this is a soft delete rather than a hard cascade.
 *
 * SECURITY: middleware excludes /api from the session check, so these handlers fail closed
 * themselves (mirrors app/api/companies/route.ts). No first-run carve-out here — managing an
 * existing company always requires a session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getSessionUserId } from '@/lib/auth';
import { ServiceError } from '@/lib/services/_base';
import { archiveCompany, renameCompany } from './manage';

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
  console.error('[companies/[id]] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized', code: 'FORBIDDEN' }, { status: 401 });
    }
    const { id } = await params;
    const body = await req.json();
    if (typeof body?.name !== 'string') {
      return NextResponse.json({ error: 'name is required', code: 'VALIDATION' }, { status: 400 });
    }
    const db = await getDb();
    const company = await renameCompany(db, userId, id, body.name);
    return NextResponse.json(company);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized', code: 'FORBIDDEN' }, { status: 401 });
    }
    const { id } = await params;
    // api.del sends no body, so the typed-name confirmation travels as ?confirm=.
    const confirm = new URL(req.url).searchParams.get('confirm') ?? '';
    const db = await getDb();
    const company = await archiveCompany(db, userId, id, confirm);
    return NextResponse.json(company);
  } catch (err) {
    return errorResponse(err);
  }
}
