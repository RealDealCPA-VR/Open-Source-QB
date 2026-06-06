/**
 * POST /api/invoices/:id/email
 *
 * Renders the invoice as a PDF and emails it to the customer (or to a supplied
 * `to` address). Body: { to?: string }
 *
 * Responses:
 *   200  { ok: true }
 *   400  VALIDATION error (SMTP not configured, no recipient, etc.)
 *   404  Invoice / company not found
 *   500  Internal error
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { emailInvoice } from '@/lib/services/email';
import { ServiceError } from '@/lib/services/_base';

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'VALIDATION'
          ? 400
          : err.code === 'FORBIDDEN'
            ? 403
            : err.code === 'CONFLICT'
              ? 409
              : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[invoices/[id]/email POST]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();

    let to: string | undefined;
    try {
      const body = await req.json();
      if (body && typeof body.to === 'string' && body.to.trim()) {
        to = body.to.trim();
      }
    } catch {
      // No body or non-JSON body — fall back to customer email.
    }

    await emailInvoice(ctx, id, to);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
