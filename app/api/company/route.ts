/**
 * GET  /api/company  — return the active company row
 * PATCH /api/company — update name and/or settings (fiscalYearEnd, currency, timezone)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getCompany, updateCompany } from '@/lib/services/company';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'VALIDATION'
          ? 400
          : err.code === 'CONFLICT'
            ? 409
            : err.code === 'FORBIDDEN'
              ? 403
              : 500;
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
  }
  console.error('[company/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET() {
  try {
    const ctx = await getServerContext();
    const company = await getCompany(ctx);
    if (!company) {
      return NextResponse.json({ error: 'Company not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    return NextResponse.json(company);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    const input: Parameters<typeof updateCompany>[1] = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return NextResponse.json({ error: 'name must be a non-empty string', code: 'VALIDATION' }, { status: 400 });
      }
      input.name = body.name.trim();
    }

    const settingsPatch: Record<string, string | undefined> = {};
    if (body.currency !== undefined) settingsPatch.currency = body.currency;
    if (body.fiscalYearEnd !== undefined) settingsPatch.fiscalYearEnd = body.fiscalYearEnd;
    if (body.timezone !== undefined) settingsPatch.timezone = body.timezone;

    if (Object.keys(settingsPatch).length > 0) {
      input.settings = settingsPatch;
    }

    const updated = await updateCompany(ctx, input);
    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}
