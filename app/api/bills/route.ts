/**
 * GET  /api/bills          — list bills (optional ?vendorId=&status= filters)
 * POST /api/bills          — create a new bill
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { createBill, listBills } from '@/lib/services/bills';
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
  console.error('[bills/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;
    const vendorId = searchParams.get('vendorId') ?? undefined;
    const status = searchParams.get('status') ?? undefined;
    const rows = await listBills(ctx, { vendorId, status });
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
    if (!body.vendorId) {
      return NextResponse.json({ error: 'vendorId is required', code: 'VALIDATION' }, { status: 400 });
    }
    if (!body.date) {
      return NextResponse.json({ error: 'date is required', code: 'VALIDATION' }, { status: 400 });
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: 'lines must be a non-empty array', code: 'VALIDATION' }, { status: 400 });
    }

    const bill = await createBill(ctx, {
      vendorId: body.vendorId,
      billNumber: body.billNumber ?? null,
      date: new Date(body.date),
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      memo: body.memo ?? null,
      lines: body.lines.map((l: Record<string, unknown>) => ({
        accountId: l.accountId as string,
        description: (l.description as string | undefined) ?? null,
        quantity: l.quantity as string | number | undefined,
        amount: l.amount as string | number,
      })),
    });

    return NextResponse.json(bill, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
