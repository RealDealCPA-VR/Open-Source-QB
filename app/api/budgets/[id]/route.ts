/**
 * GET   /api/budgets/[id]         — fetch a budget with all its lines.
 * PATCH /api/budgets/[id]         — upsert a budget line.
 *
 * PATCH body: { accountId: string; month: number; amount: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getBudget, setBudgetLine } from '@/lib/services/budgets';
import { ServiceError } from '@/lib/services/_base';

interface RouteParams {
  params: Promise<{ id: string }>;
}

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' ? 400
      : err.code === 'CONFLICT' ? 409
      : err.code === 'FORBIDDEN' ? 403
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[budgets/[id]] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const budget = await getBudget(ctx, id);
    return NextResponse.json(budget);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();
    const line = await setBudgetLine(ctx, {
      budgetId: id,
      accountId: body.accountId,
      month: Number(body.month),
      amount: String(body.amount),
    });
    return NextResponse.json(line);
  } catch (err) {
    return errorResponse(err);
  }
}
