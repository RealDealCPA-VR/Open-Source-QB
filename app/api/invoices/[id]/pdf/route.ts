/**
 * GET /api/invoices/:id/pdf
 *
 * Generates a printable PDF for an invoice and returns it inline so the browser
 * can display it directly (Content-Disposition: inline). The filename is set to
 * `invoice-<number>.pdf`.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getInvoice } from '@/lib/services/invoices';
import { getCompany } from '@/lib/services/company';
import { eq, and } from 'drizzle-orm';
import { customers } from '@/lib/db/schema';
import { renderInvoicePdf } from '@/lib/pdf/invoice';
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
  console.error('[invoices/[id]/pdf]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

/** Format a Date or timestamp string as YYYY-MM-DD. */
function fmtDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();

    // Load the invoice with its lines (scoped to company via getInvoice).
    const invoice = await getInvoice(ctx, id);

    // Load the company (for the letterhead).
    const company = await getCompany(ctx);
    if (!company) {
      return NextResponse.json({ error: 'Company not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Load the customer display name.
    const [customerRow] = await ctx.db
      .select({ displayName: customers.displayName })
      .from(customers)
      .where(
        and(
          eq(customers.id, invoice.customerId),
          eq(customers.companyId, ctx.companyId),
        ),
      );

    const customerName = customerRow?.displayName ?? 'Unknown Customer';

    // Build the PDF data object.
    const pdfBytes = await renderInvoicePdf({
      company: { name: company.name },
      customerName,
      invoice: {
        number: invoice.invoiceNumber,
        date: fmtDate(invoice.date),
        dueDate: invoice.dueDate ? fmtDate(invoice.dueDate) : null,
        subtotal: invoice.subtotal,
        discount: invoice.discount,
        tax: invoice.taxAmount,
        total: invoice.total,
        balanceDue: invoice.balanceDue,
      },
      lines: invoice.lines.map((l) => ({
        description: l.description ?? '',
        quantity: l.quantity,
        rate: l.rate,
        amount: l.amount,
      })),
    });

    const filename = `invoice-${invoice.invoiceNumber}.pdf`;

    // pdf-lib returns a Uint8Array. Extract the underlying ArrayBuffer so that
    // NextResponse (which expects a BodyInit) accepts it without a type error.
    // We slice to get an owned ArrayBuffer with no byteOffset ambiguity.
    const arrayBuf: ArrayBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength,
    ) as ArrayBuffer;

    return new NextResponse(arrayBuf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': String(arrayBuf.byteLength),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
