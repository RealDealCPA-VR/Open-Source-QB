/**
 * PATCH  /api/time-entries/:id  — update a time entry
 * DELETE /api/time-entries/:id  — delete a time entry
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { updateTimeEntry, deleteTimeEntry } from '@/lib/services/timeTracking';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'VALIDATION' || err.code === 'UNBALANCED'
          ? 400
          : err.code === 'FORBIDDEN'
            ? 403
            : err.code === 'CONFLICT'
              ? 409
              : 500;
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
  }
  console.error('[time-entries/[id]/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();

    const update: Record<string, unknown> = {};
    if (body.employeeId !== undefined) update.employeeId = body.employeeId;
    if (body.customerId !== undefined) update.customerId = body.customerId;
    if (body.jobId !== undefined) update.jobId = body.jobId;
    if (body.serviceItemId !== undefined) update.serviceItemId = body.serviceItemId;
    if (body.date !== undefined) update.date = new Date(body.date);
    if (body.hours !== undefined) update.hours = body.hours;
    if (body.billable !== undefined) update.billable = Boolean(body.billable);
    if (body.rate !== undefined) update.rate = body.rate;
    if (body.description !== undefined) update.description = body.description;

    const updated = await updateTimeEntry(ctx, id, update);
    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const result = await deleteTimeEntry(ctx, id);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
