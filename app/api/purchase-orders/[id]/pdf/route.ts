/**
 * GET /api/purchase-orders/:id/pdf
 *
 * Renders a PDF for the given purchase order and returns it inline as
 * application/pdf. Opens directly in the browser when called via window.open().
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getPurchaseOrder } from '@/lib/services/purchaseOrders';
import { getCompany } from '@/lib/services/company';
import { vendors, accounts } from '@/lib/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { renderPurchaseOrderPdf } from '@/lib/pdf/purchaseOrder';
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
  console.error('[purchase-orders/[id]/pdf]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();

    // Load PO + lines
    const po = await getPurchaseOrder(ctx, id);

    // Load vendor display name
    const [vendor] = await ctx.db
      .select({ displayName: vendors.displayName })
      .from(vendors)
      .where(and(eq(vendors.companyId, ctx.companyId), eq(vendors.id, po.vendorId)));

    const vendorName = vendor?.displayName ?? 'Unknown Vendor';

    // Load account codes for line items (batch query)
    const accountIds = [...new Set(po.lines.map((l) => l.accountId).filter(Boolean))] as string[];
    const accountMap = new Map<string, string>();

    if (accountIds.length > 0) {
      const acctRows = await ctx.db
        .select({ id: accounts.id, code: accounts.code })
        .from(accounts)
        .where(inArray(accounts.id, accountIds));
      for (const a of acctRows) accountMap.set(a.id, a.code);
    }

    // Load company
    const company = await getCompany(ctx);
    const companyName = company?.name ?? 'Your Company';

    const pdfBytes = await renderPurchaseOrderPdf({
      company: { name: companyName },
      vendorName,
      po: {
        number: po.poNumber,
        date: new Date(po.date).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        expectedDate: po.expectedDate
          ? new Date(po.expectedDate).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : null,
        total: po.total,
        status: po.status,
        memo: po.memo ?? null,
      },
      lines: po.lines.map((l) => ({
        description: l.description ?? '',
        accountCode: l.accountId ? accountMap.get(l.accountId) ?? null : null,
        quantity: l.quantity,
        rate: l.rate,
        amount: l.amount,
      })),
    });

    const buffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength,
    ) as ArrayBuffer;

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="po-${po.poNumber}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
