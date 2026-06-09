/**
 * API route: /api/expenses — Write Checks / direct expenses / credit card charges.
 *
 * GET  /api/expenses[?vendorId=&method=&paymentAccountId=&toPrint=true&includeVoided=true&limit=&offset=]
 *   → 200 { expenses: Expense[] }   (vendorName/paymentAccountName joined in)
 *
 * POST /api/expenses
 *   Body: {
 *     vendorId?:        string,
 *     payeeName?:       string,              // required when no vendorId
 *     date:             string (ISO),
 *     method:           'check'|'cash'|'credit_card',
 *     reference?:       string,              // check no.; auto-assigned when omitted (method=check)
 *     paymentAccountId: string,              // bank/cash or credit-card account
 *     memo?:            string,
 *     toPrint?:         boolean,             // queue for Print Checks (method=check)
 *     isRefund?:        boolean,             // credit-card credit
 *     lines: Array<{ accountId, description?, amount, classId?, customerId?, jobId? }>
 *   }
 *   → 201 { expense: Expense }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import {
  createExpense,
  listExpenses,
  type ExpenseMethod,
} from '@/lib/services/expenses';
import { ServiceError } from '@/lib/services/_base';

function errorStatus(code: string): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'VALIDATION':
    case 'UNBALANCED':
    case 'PERIOD_CLOSED':
      return 400;
    case 'FORBIDDEN':
      return 403;
    case 'CONFLICT':
      return 409;
    default:
      return 500;
  }
}

function errorResponse(err: unknown, route: string) {
  if (err instanceof ServiceError) {
    return NextResponse.json(
      { error: err.message, code: err.code, details: err.details ?? null },
      { status: errorStatus(err.code) },
    );
  }
  console.error(`[${route}]`, err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;

    const method = searchParams.get('method') ?? undefined;
    const rows = await listExpenses(ctx, {
      vendorId: searchParams.get('vendorId') ?? undefined,
      method: method as ExpenseMethod | undefined,
      paymentAccountId: searchParams.get('paymentAccountId') ?? undefined,
      toPrint: searchParams.get('toPrint') === 'true' || undefined,
      includeVoided: searchParams.get('includeVoided') === 'true',
      limit: searchParams.has('limit') ? Number(searchParams.get('limit')) : undefined,
      offset: searchParams.has('offset') ? Number(searchParams.get('offset')) : undefined,
    });
    return NextResponse.json({ expenses: rows });
  } catch (err) {
    return errorResponse(err, 'GET /api/expenses');
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    if (!body.date || typeof body.date !== 'string') {
      return NextResponse.json({ error: 'date (ISO string) is required.' }, { status: 400 });
    }
    if (!body.method || !['check', 'cash', 'credit_card'].includes(body.method)) {
      return NextResponse.json(
        { error: "method must be 'check', 'cash', or 'credit_card'." },
        { status: 400 },
      );
    }
    if (!body.paymentAccountId || typeof body.paymentAccountId !== 'string') {
      return NextResponse.json({ error: 'paymentAccountId is required.' }, { status: 400 });
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: 'lines must be a non-empty array.' }, { status: 400 });
    }

    const expense = await createExpense(ctx, {
      vendorId: body.vendorId ?? null,
      payeeName: body.payeeName ?? null,
      date: new Date(body.date),
      method: body.method,
      reference: body.reference ?? null,
      paymentAccountId: body.paymentAccountId,
      memo: body.memo ?? null,
      toPrint: Boolean(body.toPrint),
      isRefund: Boolean(body.isRefund),
      lines: body.lines,
    });

    return NextResponse.json({ expense }, { status: 201 });
  } catch (err) {
    return errorResponse(err, 'POST /api/expenses');
  }
}
