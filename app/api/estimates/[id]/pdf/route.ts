/**
 * GET /api/estimates/:id/pdf
 *
 * Renders a PDF for the given estimate and returns it inline as
 * application/pdf. Opens directly in the browser when called via window.open().
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getEstimate } from '@/lib/services/estimates';
import { getCompany } from '@/lib/services/company';
import { customers } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { renderEstimatePdf } from '@/lib/pdf/estimate';
import { ServiceError } from '@/lib/services/_base';

type RouteContext = { params: Promise<{ id: string }> };

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'FORBIDDEN' ? 403
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[estimates/[id]/pdf]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();

    // Load estimate + lines
    const estimate = await getEstimate(ctx, id);

    // Load customer display name
    const [customer] = await ctx.db
      .select({ displayName: customers.displayName })
      .from(customers)
      .where(and(eq(customers.companyId, ctx.companyId), eq(customers.id, estimate.customerId)));

    const customerName = customer?.displayName ?? 'Unknown Customer';

    // Load company
    const company = await getCompany(ctx);
    const companyName = company?.name ?? 'Your Company';

    // Build PDF data
    const pdfBytes = await renderEstimatePdf({
      company: { name: companyName },
      customerName,
      estimate: {
        number: estimate.estimateNumber,
        date: new Date(estimate.date).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        expirationDate: estimate.expirationDate
          ? new Date(estimate.expirationDate).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : null,
        subtotal: estimate.subtotal,
        taxAmount: estimate.taxAmount,
        total: estimate.total,
        memo: estimate.memo ?? null,
      },
      lines: estimate.lines.map((l) => ({
        description: l.description ?? '',
        quantity: l.quantity,
        rate: l.rate,
        amount: l.amount,
      })),
    });

    // Slice Uint8Array -> ArrayBuffer for the response BodyInit
    const buffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength,
    ) as ArrayBuffer;

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="estimate-${estimate.estimateNumber}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
