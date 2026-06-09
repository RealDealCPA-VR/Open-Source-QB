/**
 * GET   /api/company/closing-date — current closing date + whether a password is set.
 * PATCH /api/company/closing-date — set/clear the closing date and password (admin/owner).
 *   Body: { closingDate: 'YYYY-MM-DD' | null, password?: string | null }
 *   (closingDate null clears both; password undefined keeps existing, null/'' removes it)
 *
 * QB Desktop parity: Company > Set Closing Date + Closing Date Password. Postings dated
 * on/before the closing date are blocked unless the request carries a valid
 * x-closing-password header (verified in getServerContext).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getClosingDateSettings, setClosingDate } from '@/lib/services/company';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' ? 400
      : err.code === 'FORBIDDEN' ? 403
      : err.code === 'CONFLICT' ? 409
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[company/closing-date]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await getServerContext();
    const settings = await getClosingDateSettings(ctx);
    return NextResponse.json(settings);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();
    if (body.closingDate !== null && typeof body.closingDate !== 'string') {
      return NextResponse.json(
        { error: "closingDate must be 'YYYY-MM-DD' or null", code: 'VALIDATION' },
        { status: 400 },
      );
    }
    if (body.password !== undefined && body.password !== null && typeof body.password !== 'string') {
      return NextResponse.json(
        { error: 'password must be a string or null', code: 'VALIDATION' },
        { status: 400 },
      );
    }
    const settings = await setClosingDate(ctx, {
      closingDate: body.closingDate,
      password: body.password,
    });
    return NextResponse.json(settings);
  } catch (err) {
    return errorResponse(err);
  }
}
