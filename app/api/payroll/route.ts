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
import { zodErrorBody } from '@/lib/validation/helpers';
import { runPaycheckSchema } from '@/lib/validation/payroll';

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
    const body = await req.json().catch(() => ({}));
    // IMPORTANT: `taxes` / `employerTaxes` pass through as-is. An OMITTED array
    // triggers the service's auto-withholding (computeWithholding); an explicit
    // [] means "no taxes". The schema keeps absent keys absent.
    const parsed = runPaycheckSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(zodErrorBody(parsed.error), { status: 400 });
    }

    const paycheck = await runPaycheck(ctx, {
      ...parsed.data,
      deductions: parsed.data.deductions ?? [],
    });

    return NextResponse.json(paycheck, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
