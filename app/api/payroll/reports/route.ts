/**
 * GET /api/payroll/reports?from=YYYY-MM-DD&to=YYYY-MM-DD[&employeeId=<uuid>]
 *
 * Returns the three after-the-fact payroll reports in one payload:
 *   { summary, detail, liabilities }
 *
 * - summary:     payroll summary by employee (gross, each tax, deductions,
 *                employer accruals, net) for the range.
 * - detail:      one row per posted, non-void paycheck in the range.
 * - liabilities: liability balance by item (withheld + employer accruals minus
 *                payments against 2300) as of the range end date.
 *
 * Defaults: from = Jan 1 of the current year, to = today (UTC).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import {
  payrollSummary,
  payrollDetail,
  payrollLiabilityBalances,
} from '@/lib/services/payrollReports';
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
  console.error('[payroll/reports] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;

    const fromParam = searchParams.get('from');
    const toParam = searchParams.get('to');
    const employeeId = searchParams.get('employeeId') ?? undefined;

    if (fromParam && !DATE_RE.test(fromParam)) {
      return NextResponse.json(
        { error: 'from must be YYYY-MM-DD', code: 'VALIDATION' },
        { status: 400 },
      );
    }
    if (toParam && !DATE_RE.test(toParam)) {
      return NextResponse.json(
        { error: 'to must be YYYY-MM-DD', code: 'VALIDATION' },
        { status: 400 },
      );
    }

    // Pay dates are stored as UTC midnight ('YYYY-MM-DD' parses as UTC), so build
    // the default bounds in UTC too.
    const now = new Date();
    const from = fromParam
      ? new Date(fromParam)
      : new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const to = toParam
      ? new Date(toParam)
      : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const [summary, detail, liabilities] = await Promise.all([
      payrollSummary(ctx, { from, to, employeeId }),
      payrollDetail(ctx, { from, to, employeeId }),
      payrollLiabilityBalances(ctx, { asOf: to }),
    ]);

    return NextResponse.json({ summary, detail, liabilities });
  } catch (err) {
    return errorResponse(err);
  }
}
