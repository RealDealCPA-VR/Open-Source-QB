/**
 * GET  /api/payroll  — list all paychecks for the active company.
 * POST /api/payroll  — run a paycheck (posts GL entry, inserts paycheck + lines).
 *
 * Query params for GET:
 *   ?employeeId=<uuid>  — filter to a specific employee.
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
    const list = await listPaychecks(ctx, { employeeId });
    return NextResponse.json(list);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    const paycheck = await runPaycheck(ctx, {
      employeeId: body.employeeId,
      payDate: new Date(body.payDate),
      periodStart: body.periodStart ? new Date(body.periodStart) : null,
      periodEnd: body.periodEnd ? new Date(body.periodEnd) : null,
      grossPay: body.grossPay,
      taxes: body.taxes ?? [],
      deductions: body.deductions ?? [],
    });

    return NextResponse.json(paycheck, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
