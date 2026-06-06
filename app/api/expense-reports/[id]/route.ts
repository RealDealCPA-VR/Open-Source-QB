/**
 * GET  /api/expense-reports/[id]              — get report with lines.
 * POST /api/expense-reports/[id]              — perform an action on the report.
 *
 * POST body:
 *   { action: 'submit' }     — transition draft → submitted
 *   { action: 'reimburse' }  — transition submitted → reimbursed + post GL
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getReport, submitReport, approveAndReimburse } from '@/lib/services/expenseReports';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown, prefix = 'expense-reports') {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' || err.code === 'UNBALANCED' ? 400
      : err.code === 'FORBIDDEN' ? 403
      : err.code === 'CONFLICT' ? 409
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error(`[${prefix}] unexpected error:`, err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const report = await getReport(ctx, id);
    return NextResponse.json(report);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();
    const action = body?.action;

    if (action === 'submit') {
      const updated = await submitReport(ctx, id);
      return NextResponse.json(updated);
    }

    if (action === 'reimburse') {
      const updated = await approveAndReimburse(ctx, id);
      return NextResponse.json(updated);
    }

    return NextResponse.json(
      { error: `Unknown action "${action}". Valid actions: submit, reimburse.`, code: 'VALIDATION' },
      { status: 400 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
