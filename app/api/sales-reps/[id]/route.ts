/**
 * PATCH  /api/sales-reps/[id]  — update mutable fields.
 * DELETE /api/sales-reps/[id]  — soft-deactivate (isActive = false).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getSalesRep, updateSalesRep, deactivateSalesRep } from '@/lib/services/salesReps';
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
  console.error('[sales-reps/[id]] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const rep = await getSalesRep(ctx, id);
    return NextResponse.json(rep);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();
    const rep = await updateSalesRep(ctx, id, {
      name: body.name,
      email: body.email,
      commissionRate: body.commissionRate,
    });
    return NextResponse.json(rep);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const rep = await deactivateSalesRep(ctx, id);
    return NextResponse.json(rep);
  } catch (err) {
    return errorResponse(err);
  }
}
