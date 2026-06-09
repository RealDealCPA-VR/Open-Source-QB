/**
 * GET    /api/expenses/:id   — fetch an expense with its lines
 * DELETE /api/expenses/:id   — void the expense (reverses its GL entry)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getExpense, voidExpense } from '@/lib/services/expenses';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'VALIDATION' || err.code === 'UNBALANCED' || err.code === 'PERIOD_CLOSED'
          ? 400
          : err.code === 'FORBIDDEN'
            ? 403
            : err.code === 'CONFLICT'
              ? 409
              : 500;
    return NextResponse.json(
      { error: err.message, code: err.code, details: err.details ?? null },
      { status },
    );
  }
  console.error('[expenses/[id]/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const expense = await getExpense(ctx, id);
    return NextResponse.json(expense);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const expense = await voidExpense(ctx, id);
    return NextResponse.json({ expense });
  } catch (err) {
    return errorResponse(err);
  }
}
