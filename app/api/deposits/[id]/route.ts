/**
 * API route: /api/deposits/[id]
 *
 * GET    — fetch a single deposit with its lines
 * DELETE — void the deposit (reverses GL; payments/sales receipts return to
 *          the Undeposited Funds picker)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getDeposit, voidDeposit } from '@/lib/services/deposits';
import { ServiceError } from '@/lib/services/_base';

function errorStatus(code: ServiceError['code']): number {
  switch (code) {
    case 'NOT_FOUND':     return 404;
    case 'VALIDATION':    return 400;
    case 'UNBALANCED':    return 400;
    case 'FORBIDDEN':     return 403;
    case 'CONFLICT':      return 409;
    case 'PERIOD_CLOSED': return 422;
    default:              return 500;
  }
}

function errorResponse(err: unknown, label: string) {
  if (err instanceof ServiceError) {
    return NextResponse.json(
      { error: err.message, code: err.code, details: err.details },
      { status: errorStatus(err.code) },
    );
  }
  console.error(`[${label}]`, err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const deposit = await getDeposit(ctx, id);
    return NextResponse.json(deposit);
  } catch (err) {
    return errorResponse(err, 'GET /api/deposits/[id]');
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const voided = await voidDeposit(ctx, id);
    return NextResponse.json(voided);
  } catch (err) {
    return errorResponse(err, 'DELETE /api/deposits/[id]');
  }
}
