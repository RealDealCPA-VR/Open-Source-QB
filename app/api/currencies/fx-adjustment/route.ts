/**
 * POST /api/currencies/fx-adjustment
 *
 * Record an FX gain or loss as a balanced journal entry.
 * Body: { accountId, amount, gain, date, memo? }
 *
 *   gain=true  → Dr accountId / Cr 4900 Other Income
 *   gain=false → Dr 6100 Bank & Merchant Fees / Cr accountId
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { recordFxAdjustment } from '@/lib/services/currencies';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' || err.code === 'UNBALANCED' ? 400
      : err.code === 'FORBIDDEN' ? 403
      : err.code === 'CONFLICT' ? 409
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[currencies/fx-adjustment] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();
    const { accountId, amount, gain, date, memo } = body as {
      accountId: string;
      amount: string | number;
      gain: boolean;
      date: string;
      memo?: string;
    };

    if (!accountId) return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
    if (amount === undefined || amount === null || amount === '')
      return NextResponse.json({ error: 'amount is required' }, { status: 400 });
    if (gain === undefined || gain === null)
      return NextResponse.json({ error: 'gain (boolean) is required' }, { status: 400 });
    if (!date) return NextResponse.json({ error: 'date is required' }, { status: 400 });

    const result = await recordFxAdjustment(ctx, {
      accountId,
      amount,
      gain: Boolean(gain),
      date: new Date(date),
      memo,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
