/**
 * DELETE /api/payroll/[id] — void a paycheck.
 *
 * Voids the underlying GL journal entry (blocked when a line was cleared in a
 * completed reconciliation, or the period is closed) and stamps
 * paychecks.voided_at so W-2 / 941 / pay-stub aggregations exclude the check.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { voidPaycheck } from '@/lib/services/payroll';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' || err.code === 'UNBALANCED' ? 400
      : err.code === 'FORBIDDEN' ? 403
      : err.code === 'CONFLICT' ? 409
      : err.code === 'PERIOD_CLOSED' ? 409
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[payroll/[id]] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getServerContext();
    const { id } = await params;
    const voided = await voidPaycheck(ctx, id);
    return NextResponse.json(voided);
  } catch (err) {
    return errorResponse(err);
  }
}
