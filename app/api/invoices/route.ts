/**
 * GET  /api/invoices          — list invoices (optional ?customerId=&status= filters)
 * POST /api/invoices          — create a new invoice and post to the GL.
 *                               Optional body.billables = { billLineIds, expenseLineIds,
 *                               timeEntryIds, markupPercent } pulls unbilled billable
 *                               time & costs onto the invoice and stamps them billed
 *                               in the same transaction.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { createInvoice, listInvoices, type CreateInvoiceInput } from '@/lib/services/invoices';
import { createInvoiceWithBillables, type BillableSelection } from '@/lib/services/billables';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'VALIDATION' || err.code === 'UNBALANCED'
          ? 400
          : err.code === 'FORBIDDEN'
            ? 403
            : err.code === 'CONFLICT'
              ? 409
              : 500;
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
  }
  console.error('[invoices/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;
    const customerId = searchParams.get('customerId') ?? undefined;
    const status = searchParams.get('status') ?? undefined;
    const rows = await listInvoices(ctx, { customerId, status });
    return NextResponse.json(rows);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    // Basic shape check — detailed validation happens inside the service.
    if (!body.customerId) {
      return NextResponse.json({ error: 'customerId is required', code: 'VALIDATION' }, { status: 400 });
    }
    if (!body.date) {
      return NextResponse.json({ error: 'date is required', code: 'VALIDATION' }, { status: 400 });
    }
    // Billable time & costs selection (optional). When present, manual lines may
    // be empty — the billables become the lines.
    const billables: BillableSelection | null =
      body.billables &&
      ((body.billables.billLineIds?.length ?? 0) +
        (body.billables.expenseLineIds?.length ?? 0) +
        (body.billables.timeEntryIds?.length ?? 0) >
        0)
        ? {
            billLineIds: body.billables.billLineIds ?? [],
            expenseLineIds: body.billables.expenseLineIds ?? [],
            timeEntryIds: body.billables.timeEntryIds ?? [],
            markupPercent: body.billables.markupPercent ?? null,
          }
        : null;

    if (!Array.isArray(body.lines) || (body.lines.length === 0 && !billables)) {
      return NextResponse.json({ error: 'lines must be a non-empty array', code: 'VALIDATION' }, { status: 400 });
    }
    if (body.discountType != null && body.discountType !== 'amount' && body.discountType !== 'percent') {
      return NextResponse.json(
        { error: "discountType must be 'amount' or 'percent'", code: 'VALIDATION' },
        { status: 400 },
      );
    }

    const input: CreateInvoiceInput = {
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
    };

    const invoice = billables
      ? await createInvoiceWithBillables(ctx, input, billables)
      : await createInvoice(ctx, input);

    return NextResponse.json(invoice, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
