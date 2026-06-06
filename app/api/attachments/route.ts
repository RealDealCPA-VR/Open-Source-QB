/**
 * GET  /api/attachments?entityType=&entityId=  — list attachments for an entity.
 * POST /api/attachments                         — upload a new attachment (base64 encoded).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { listAttachments, saveAttachment } from '@/lib/services/attachments';
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
  console.error('[attachments] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;
    const entityType = searchParams.get('entityType') ?? '';
    const entityId = searchParams.get('entityId') ?? '';

    if (!entityType || !entityId) {
      return NextResponse.json(
        { error: 'entityType and entityId query params are required', code: 'VALIDATION' },
        { status: 400 },
      );
    }

    const list = await listAttachments(ctx, { entityType, entityId });
    return NextResponse.json(list);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    const { entityType, entityId, filename, mimeType, base64 } = body ?? {};

    if (!entityType || !entityId || !filename || !base64) {
      return NextResponse.json(
        { error: 'entityType, entityId, filename, and base64 are required', code: 'VALIDATION' },
        { status: 400 },
      );
    }

    const row = await saveAttachment(ctx, { entityType, entityId, filename, mimeType, base64 });
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
