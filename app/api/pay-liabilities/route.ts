/**
 * /api/pay-liabilities
 *
 * GET  → { salesTaxDue: string, payrollLiabilitiesDue: string }
 *         Current credit balances of 2200 and 2300 derived from posted GL.
 *
 * POST body:
 *   {
 *     type:             'sales_tax' | 'payroll',
 *     amount:           string,          // decimal, e.g. "120.00"
 *     date:             string,          // ISO 8601, e.g. "2025-04-01"
 *     paymentAccountId: string,          // bank/cash account uuid
 *     agencyId?:        string,          // for sales_tax only — optional tax agency id
 *     memo?:            string,          // optional journal entry description
 *   }
 *
 * POST → 201 { entry: JournalEntry }
 *
 * ServiceError → HTTP:
 *   NOT_FOUND  → 404
 *   VALIDATION / UNBALANCED → 400
 *   FORBIDDEN  → 403
 *   else       → 500
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import {
  salesTaxDue,
  payrollLiabilitiesDue,
  paySalesTax,
  payPayrollLiabilities,
} from '@/lib/services/liabilityPayments';
import { ServiceError } from '@/lib/services/_base';

function errorStatus(code: string): number {
  switch (code) {
    case 'NOT_FOUND':   return 404;
    case 'VALIDATION':
    case 'UNBALANCED':  return 400;
    case 'FORBIDDEN':   return 403;
    case 'CONFLICT':    return 409;
    default:            return 500;
  }
}

function serviceError(err: unknown): NextResponse {
  if (err instanceof ServiceError) {
    return NextResponse.json(
      { error: err.message, code: err.code, details: err.details ?? null },
      { status: errorStatus(err.code) },
    );
  }
  console.error('[/api/pay-liabilities]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const ctx = await getServerContext();
    const [stDue, prDue] = await Promise.all([salesTaxDue(ctx), payrollLiabilitiesDue(ctx)]);
    return NextResponse.json({ salesTaxDue: stDue, payrollLiabilitiesDue: prDue });
  } catch (err) {
    return serviceError(err);
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    const { type, amount, date, paymentAccountId, agencyId, memo } = body as {
      type?: string;
      amount?: string;
      date?: string;
      paymentAccountId?: string;
      agencyId?: string;
      memo?: string;
    };

    if (type !== 'sales_tax' && type !== 'payroll') {
      return NextResponse.json(
        { error: 'type must be "sales_tax" or "payroll".' },
        { status: 400 },
      );
    }
    if (!amount || typeof amount !== 'string') {
      return NextResponse.json({ error: 'amount (decimal string) is required.' }, { status: 400 });
    }
    if (!date || typeof date !== 'string') {
      return NextResponse.json({ error: 'date (ISO string) is required.' }, { status: 400 });
    }
    if (!paymentAccountId || typeof paymentAccountId !== 'string') {
      return NextResponse.json({ error: 'paymentAccountId is required.' }, { status: 400 });
    }

    const parsedDate = new Date(date);

    let entry;
    if (type === 'sales_tax') {
      entry = await paySalesTax(ctx, {
        amount,
        date: parsedDate,
        paymentAccountId,
        agencyId: agencyId ?? null,
        memo: memo ?? null,
      });
    } else {
      entry = await payPayrollLiabilities(ctx, {
        amount,
        date: parsedDate,
        paymentAccountId,
        memo: memo ?? null,
      });
    }

    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    return serviceError(err);
  }
}
