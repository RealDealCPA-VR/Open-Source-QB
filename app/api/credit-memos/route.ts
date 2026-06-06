/**
 * GET  /api/credit-memos          — list credit memos (optional ?customerId=&status=)
 * POST /api/credit-memos          — create a credit memo and post to the GL
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { createCreditMemo, listCreditMemos } from '@/lib/services/creditMemos';
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
  console.error('[credit-memos/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;
    const customerId = searchParams.get('customerId') ?? undefined;
    const status = searchParams.get('status') ?? undefined;
    const rows = await listCreditMemos(ctx, { customerId, status });
    return NextResponse.json(rows);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
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

    const memo = await createCreditMemo(ctx, {
      customerId: body.customerId,
      date: new Date(body.date),
      memo: body.memo ?? null,
      lines: body.lines.map((l: Record<string, unknown>) => ({
        description: (l.description as string | undefined) ?? null,
        quantity: l.quantity as string | number,
        rate: l.rate as string | number,
        accountId: (l.accountId as string | undefined) ?? null,
      })),
    });

    return NextResponse.json(memo, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
