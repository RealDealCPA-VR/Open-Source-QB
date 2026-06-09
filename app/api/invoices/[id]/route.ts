/**
 * GET    /api/invoices/:id   — fetch an invoice with its lines
 * PUT    /api/invoices/:id   — edit an open, unpaid invoice (void + re-post in one transaction)
 * PATCH  /api/invoices/:id   — alias of PUT (the shared api client exposes patch)
 * DELETE /api/invoices/:id   — void an invoice (reverses its GL entry)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getInvoice, updateInvoice, voidInvoice } from '@/lib/services/invoices';
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
  console.error('[invoices/[id]/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const invoice = await getInvoice(ctx, id);
    return NextResponse.json(invoice);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();

    if (!body.customerId) {
      return NextResponse.json({ error: 'customerId is required', code: 'VALIDATION' }, { status: 400 });
    }
    if (!body.date) {
      return NextResponse.json({ error: 'date is required', code: 'VALIDATION' }, { status: 400 });
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: 'lines must be a non-empty array', code: 'VALIDATION' }, { status: 400 });
    }
    if (body.discountType != null && body.discountType !== 'amount' && body.discountType !== 'percent') {
      return NextResponse.json(
        { error: "discountType must be 'amount' or 'percent'", code: 'VALIDATION' },
        { status: 400 },
      );
    }

    const updated = await updateInvoice(ctx, id, {
      customerId: body.customerId,
      date: new Date(body.date),
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      taxRateId: body.taxRateId ?? null,
      classId: body.classId ?? null,
      jobId: body.jobId ?? null,
      discount: body.discount ?? null,
      discountType: body.discountType ?? null,
      currency: body.currency ?? null,
      exchangeRate: body.exchangeRate ?? null,
      retainagePercent: body.retainagePercent ?? null,
      memo: body.memo ?? null,
      lines: body.lines.map((l: Record<string, unknown>) => ({
        itemId: (l.itemId as string | undefined) ?? null,
        accountId: (l.accountId as string | undefined) ?? null,
        description: (l.description as string | undefined) ?? null,
        quantity: l.quantity as string | number,
        rate: l.rate as string | number,
        taxable: l.taxable !== undefined ? Boolean(l.taxable) : true,
        taxRateId: (l.taxRateId as string | undefined) ?? null,
        classId: (l.classId as string | undefined) ?? null,
        jobId: (l.jobId as string | undefined) ?? null,
      })),
    });

    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}

/** Alias of PUT — the shared api client only exposes get/post/patch/del. */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return PUT(req, ctx);
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const voided = await voidInvoice(ctx, id);
    return NextResponse.json(voided);
  } catch (err) {
    return errorResponse(err);
  }
}
