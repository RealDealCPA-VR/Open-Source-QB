/**
 * GET  /api/vendor-credits          — list vendor credits (optional ?vendorId=&status= filters)
 * POST /api/vendor-credits          — create a new vendor credit
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { createVendorCredit, listVendorCredits } from '@/lib/services/vendorCredits';
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
  console.error('[vendor-credits/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;
    const vendorId = searchParams.get('vendorId') ?? undefined;
    const status = searchParams.get('status') ?? undefined;
    const rows = await listVendorCredits(ctx, { vendorId, status });
    return NextResponse.json(rows);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    if (!body.vendorId) {
      return NextResponse.json({ error: 'vendorId is required', code: 'VALIDATION' }, { status: 400 });
    }
    if (!body.date) {
      return NextResponse.json({ error: 'date is required', code: 'VALIDATION' }, { status: 400 });
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json(
        { error: 'lines must be a non-empty array', code: 'VALIDATION' },
        { status: 400 },
      );
    }

    const credit = await createVendorCredit(ctx, {
      vendorId: body.vendorId,
      date: new Date(body.date),
      memo: body.memo ?? null,
      lines: body.lines.map((l: Record<string, unknown>) => ({
        accountId: l.accountId as string,
        description: (l.description as string | undefined) ?? null,
        amount: l.amount as string | number,
      })),
    });

    return NextResponse.json(credit, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
