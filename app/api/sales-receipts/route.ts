/**
 * GET  /api/sales-receipts   — list sales receipts (optional ?customerId=&status= filters)
 * POST /api/sales-receipts   — create a sales receipt and post income + payment to the GL
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { createSalesReceipt, listSalesReceipts } from '@/lib/services/salesReceipts';
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
  console.error('[sales-receipts/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;
    const customerId = searchParams.get('customerId') ?? undefined;
    const status = searchParams.get('status') ?? undefined;
    const rows = await listSalesReceipts(ctx, { customerId, status });
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
    if (!body.date) {
      return NextResponse.json({ error: 'date is required', code: 'VALIDATION' }, { status: 400 });
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json(
        { error: 'lines must be a non-empty array', code: 'VALIDATION' },
        { status: 400 },
      );
    }

    const receipt = await createSalesReceipt(ctx, {
      customerId: body.customerId ?? null,
      date: new Date(body.date),
      taxRateId: body.taxRateId ?? null,
      depositAccountId: body.depositAccountId ?? null,
      method: body.method ?? null,
      reference: body.reference ?? null,
      memo: body.memo ?? null,
      classId: body.classId ?? null,
      lines: body.lines.map((l: Record<string, unknown>) => ({
        itemId: (l.itemId as string | undefined) ?? null,
        accountId: (l.accountId as string | undefined) ?? null,
        description: (l.description as string | undefined) ?? null,
        quantity: l.quantity as string | number,
        rate: l.rate as string | number,
        taxable: l.taxable !== undefined ? Boolean(l.taxable) : true,
        taxRateId: (l.taxRateId as string | undefined) ?? null,
      })),
    });

    return NextResponse.json(receipt, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
