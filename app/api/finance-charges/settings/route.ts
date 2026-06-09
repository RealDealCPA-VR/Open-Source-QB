/**
 * GET /api/finance-charges/settings — current finance-charge settings.
 * PUT /api/finance-charges/settings — update { annualRate?, minCharge?, graceDays? }.
 *
 * Stored in companies.settings.financeCharges (jsonb).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import {
  getFinanceChargeSettings,
  updateFinanceChargeSettings,
} from '@/lib/services/financeCharges';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' ? 400
      : err.code === 'FORBIDDEN' ? 403
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[finance-charges/settings] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await getServerContext();
    const settings = await getFinanceChargeSettings(ctx);
    return NextResponse.json(settings);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const ctx = await getServerContext();
    const settings = await updateFinanceChargeSettings(ctx, {
      annualRate: body.annualRate !== undefined ? String(body.annualRate) : undefined,
      minCharge: body.minCharge !== undefined ? String(body.minCharge) : undefined,
      graceDays: body.graceDays !== undefined ? Number(body.graceDays) : undefined,
    });
    return NextResponse.json(settings);
  } catch (err) {
    return errorResponse(err);
  }
}

/** PATCH alias — lib/client's api helper exposes patch (no put). */
export const PATCH = PUT;
