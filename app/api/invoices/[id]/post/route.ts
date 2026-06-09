/**
 * POST /api/invoices/:id/post — post a pending (draft) invoice to the GL.
 *
 * Drafts are saved without any journal entry or inventory relief; this
 * endpoint validates them again, posts the GL entry + COGS, and flips the
 * status to open/partial/paid. The fiscal-period check happens here (post
 * time) via the posting engine.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { postDraftInvoice } from '@/lib/services/invoices';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'VALIDATION' || err.code === 'UNBALANCED' || err.code === 'PERIOD_CLOSED'
          ? 400
          : err.code === 'FORBIDDEN'
            ? 403
            : err.code === 'CONFLICT'
              ? 409
              : 500;
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
  }
  console.error('[invoices/[id]/post]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const posted = await postDraftInvoice(ctx, id);
    return NextResponse.json(posted);
  } catch (err) {
    return errorResponse(err);
  }
}
