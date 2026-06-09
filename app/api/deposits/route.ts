/**
 * GET  /api/deposits      — list all deposits for the company
 * POST /api/deposits      — create a new deposit (Undeposited Funds -> bank)
 *   Body: {
 *     depositAccountId: string,
 *     date: string (ISO),
 *     paymentIds?: string[],        // paymentsReceived rows in UF
 *     salesReceiptIds?: string[],   // salesReceipts rows in UF
 *     extraLines?: Array<{ accountId, amount, description? }>, // e.g. owner contribution
 *     cashBack?: { accountId, amount, memo? },                 // QB "Cash back goes to"
 *     memo?: string
 *   }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { createDeposit, listDeposits } from '@/lib/services/deposits';
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
  console.error('[deposits/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await getServerContext();
    const rows = await listDeposits(ctx);
    return NextResponse.json(rows);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    if (!body.depositAccountId) {
      return NextResponse.json(
        { error: 'depositAccountId is required', code: 'VALIDATION' },
        { status: 400 },
      );
    }
    if (!body.date) {
      return NextResponse.json(
        { error: 'date is required', code: 'VALIDATION' },
        { status: 400 },
      );
    }
    const paymentIds = Array.isArray(body.paymentIds) ? (body.paymentIds as string[]) : [];
    const salesReceiptIds = Array.isArray(body.salesReceiptIds)
      ? (body.salesReceiptIds as string[])
      : [];
    const extraLines = Array.isArray(body.extraLines) ? body.extraLines : [];

    if (paymentIds.length === 0 && salesReceiptIds.length === 0 && extraLines.length === 0) {
      return NextResponse.json(
        {
          error: 'Provide at least one of paymentIds, salesReceiptIds, or extraLines.',
          code: 'VALIDATION',
        },
        { status: 400 },
      );
    }

    const deposit = await createDeposit(ctx, {
      depositAccountId: body.depositAccountId as string,
      date: new Date(body.date as string),
      paymentIds,
      salesReceiptIds,
      extraLines,
      cashBack: body.cashBack ?? null,
      memo: (body.memo as string | undefined) ?? null,
    });

    return NextResponse.json(deposit, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
