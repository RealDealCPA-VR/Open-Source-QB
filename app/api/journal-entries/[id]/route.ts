/**
 * GET    /api/journal-entries/:id   — fetch a single entry with lines + account names.
 * PATCH  /api/journal-entries/:id   — edit a posted entry (void + repost atomically).
 * DELETE /api/journal-entries/:id   — void a posted entry (reverses balances).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { ServiceError } from '@/lib/services/_base';
import { getEntry, updateEntry, voidEntry } from '@/lib/services/journal';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const entry = await getEntry(ctx, id);
    return NextResponse.json({ entry });
  } catch (err) {
    return mapError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();

    const date = body.date ? new Date(body.date) : undefined;
    if (!date || isNaN(date.getTime())) {
      return NextResponse.json({ error: 'date is required (ISO string).' }, { status: 400 });
    }

    const entry = await updateEntry(ctx, id, {
      date,
      description: body.description ?? '',
      reference: body.reference === undefined ? undefined : (body.reference ?? null),
      lines: body.lines ?? [],
    });
    return NextResponse.json({ entry });
  } catch (err) {
    return mapError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const entry = await voidEntry(ctx, id);
    return NextResponse.json({ entry });
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
            : err.code === 'CONFLICT' || err.code === 'PERIOD_CLOSED'
              ? 409
              : 500;
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
  }
  console.error('[journal-entries/[id]] Unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
}
