/**
 * GET  /api/payroll  — list all paychecks for the active company.
 * POST /api/payroll  — run a paycheck (posts GL entry, inserts paycheck + lines).
 *
 * Query params for GET:
 *   ?employeeId=<uuid>      — filter to a specific employee.
 *   ?includeVoided=true     — include voided paychecks (flagged isVoid: true).
 *
 * POST body accepts EITHER a single `grossPay` amount OR itemized `earnings`:
 *   earnings: [{ kind: 'regular'|'overtime'|'bonus'|'commission', hours?, rate?, amount }]
 * Gross = sum of earning lines when provided.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { listPaychecks, runPaycheck } from '@/lib/services/payroll';
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
  console.error('[payroll] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;
    const employeeId = searchParams.get('employeeId') ?? undefined;
    const includeVoided = searchParams.get('includeVoided') === 'true';
    const list = await listPaychecks(ctx, { employeeId, includeVoided });
    return NextResponse.json(list);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    // Optional withholding parameters — validate when present.
    if (body.filingStatus !== undefined && body.filingStatus !== 'single' && body.filingStatus !== 'married') {
      return NextResponse.json(
        { error: "filingStatus must be 'single' or 'married'", code: 'VALIDATION' },
        { status: 400 },
      );
    }
    if (body.periodsPerYear !== undefined &&
        (!Number.isInteger(body.periodsPerYear) || body.periodsPerYear <= 0)) {
      return NextResponse.json(
        { error: 'periodsPerYear must be a positive integer', code: 'VALIDATION' },
        { status: 400 },
      );
    }

    if (body.earnings !== undefined && !Array.isArray(body.earnings)) {
      return NextResponse.json(
        { error: 'earnings must be an array of earning lines', code: 'VALIDATION' },
        { status: 400 },
      );
    }

    const paycheck = await runPaycheck(ctx, {
      employeeId: body.employeeId,
      payDate: new Date(body.payDate),
      periodStart: body.periodStart ? new Date(body.periodStart) : null,
      periodEnd: body.periodEnd ? new Date(body.periodEnd) : null,
      grossPay: body.grossPay,
      earnings: body.earnings,
      // IMPORTANT: pass `taxes` through as-is. An OMITTED array triggers the service's
      // auto-withholding (computeWithholding); an explicit [] means "no taxes".
      // Coercing undefined to [] here would silently disable auto-withholding.
      taxes: body.taxes,
      employerTaxes: body.employerTaxes,
      deductions: body.deductions ?? [],
      filingStatus: body.filingStatus,
      periodsPerYear: body.periodsPerYear,
    });

    return NextResponse.json(paycheck, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
