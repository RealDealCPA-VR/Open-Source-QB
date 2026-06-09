/**
 * GET    /api/credit-memos/:id              — fetch credit memo with lines
 * POST   /api/credit-memos/:id              — actions:
 *           { action: 'apply',  invoiceId, amount }
 *           { action: 'refund', bankAccountId, amount, date?, memo? }
 * DELETE /api/credit-memos/:id              — void the credit memo
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import {
  getCreditMemo,
  applyToInvoice,
  refundCreditMemo,
  voidCreditMemo,
} from '@/lib/services/creditMemos';
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
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
  }
  console.error('[credit-memos/[id]/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const memo = await getCreditMemo(ctx, id);
    return NextResponse.json(memo);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();

    if (body.action === 'apply') {
      if (!body.invoiceId) {
        return NextResponse.json({ error: 'invoiceId is required', code: 'VALIDATION' }, { status: 400 });
      }
      if (body.amount === undefined || body.amount === null) {
        return NextResponse.json({ error: 'amount is required', code: 'VALIDATION' }, { status: 400 });
      }

      const result = await applyToInvoice(ctx, {
        creditMemoId: id,
        invoiceId: body.invoiceId,
        amount: body.amount,
      });

      return NextResponse.json(result);
    }

    if (body.action === 'refund') {
      if (!body.bankAccountId) {
        return NextResponse.json({ error: 'bankAccountId is required', code: 'VALIDATION' }, { status: 400 });
      }
      if (body.amount === undefined || body.amount === null) {
        return NextResponse.json({ error: 'amount is required', code: 'VALIDATION' }, { status: 400 });
      }

      const result = await refundCreditMemo(ctx, {
        creditMemoId: id,
        bankAccountId: body.bankAccountId,
        amount: body.amount,
        date: body.date ? new Date(body.date) : null,
        memo: body.memo ?? null,
      });

      return NextResponse.json(result);
    }

    return NextResponse.json(
      { error: `Unknown action '${body.action}'. Supported: apply, refund`, code: 'VALIDATION' },
      { status: 400 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const voided = await voidCreditMemo(ctx, id);
    return NextResponse.json(voided);
  } catch (err) {
    return errorResponse(err);
  }
}
