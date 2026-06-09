/**
 * POST /api/checks/pdf
 *
 * Renders a printable check PDF. Two modes:
 *
 * 1. From a recorded expense (Write Checks print queue):
 *      { expenseId: string, checkNumber?: string }
 *    Payee, amount, date, memo, and the voucher-stub detail lines are pulled
 *    from the recorded transaction.
 *
 * 2. Ad-hoc (quick check, not recorded):
 *      { payee: string, amount: string, date: string, memo?: string, checkNumber?: string }
 *
 * Response: application/pdf (inline)
 */
import { NextRequest, NextResponse } from 'next/server';
import { inArray } from 'drizzle-orm';
import { getServerContext } from '@/lib/context';
import { getCompany } from '@/lib/services/company';
import { getExpense } from '@/lib/services/expenses';
import { accounts } from '@/lib/db/schema';
import { renderCheckPdf, numberToWords, type VoucherLine } from '@/lib/pdf/check';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown): NextResponse {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'FORBIDDEN'
          ? 403
          : err.code === 'CONFLICT'
            ? 409
            : ['VALIDATION', 'UNBALANCED', 'PERIOD_CLOSED'].includes(err.code)
              ? 400
              : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[checks/pdf]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as {
      expenseId?: unknown;
      payee?: unknown;
      amount?: unknown;
      date?: unknown;
      memo?: unknown;
      checkNumber?: unknown;
    };

    const ctx     = await getServerContext();
    const company = await getCompany(ctx);
    if (!company) {
      return NextResponse.json({ error: 'Company not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    let payee: string;
    let amount: string;
    let date: string;
    let memo: string | undefined;
    let checkNumber = body.checkNumber != null && String(body.checkNumber).trim() !== ''
      ? String(body.checkNumber).trim()
      : undefined;
    let voucher: VoucherLine[] | undefined;

    if (body.expenseId && typeof body.expenseId === 'string') {
      // --- Mode 1: render from a recorded expense (with voucher stub) ---
      const expense = await getExpense(ctx, body.expenseId);
      payee = expense.payeeName ?? 'Unknown payee';
      amount = String(Math.abs(parseFloat(expense.total)).toFixed(2));
      date = new Date(expense.date).toISOString().slice(0, 10);
      memo = expense.memo ?? undefined;
      checkNumber = checkNumber ?? expense.reference ?? undefined;

      const accountIds = [...new Set(expense.lines.map((l) => l.accountId))];
      const acctRows = accountIds.length
        ? await ctx.db
            .select({ id: accounts.id, code: accounts.code, name: accounts.name })
            .from(accounts)
            .where(inArray(accounts.id, accountIds))
        : [];
      const labelById = new Map(acctRows.map((a) => [a.id, `${a.code} – ${a.name}`]));
      voucher = expense.lines.map((l) => ({
        account: labelById.get(l.accountId) ?? 'Account',
        description: l.description,
        amount: l.amount,
      }));
    } else {
      // --- Mode 2: ad-hoc quick check ---
      if (!body.payee || typeof body.payee !== 'string' || !body.payee.trim()) {
        return NextResponse.json({ error: 'payee is required', code: 'VALIDATION' }, { status: 400 });
      }
      if (!body.amount || typeof body.amount !== 'string' || isNaN(parseFloat(body.amount as string))) {
        return NextResponse.json({ error: 'amount must be a valid decimal string', code: 'VALIDATION' }, { status: 400 });
      }
      if (!body.date || typeof body.date !== 'string' || !body.date.trim()) {
        return NextResponse.json({ error: 'date is required', code: 'VALIDATION' }, { status: 400 });
      }
      payee  = (body.payee as string).trim();
      amount = (body.amount as string).trim();
      date   = (body.date as string).trim();
      memo   = body.memo && typeof body.memo === 'string' ? body.memo.trim() : undefined;
    }

    const pdfBytes = await renderCheckPdf({
      company: { name: company.name },
      payee,
      amountNumeric: amount,
      amountWords: numberToWords(amount),
      date,
      memo,
      checkNumber,
      voucher,
    });

    // Slice to get an owned ArrayBuffer (no byteOffset ambiguity for BodyInit).
    const arrayBuf: ArrayBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength,
    ) as ArrayBuffer;

    const filename = checkNumber ? `check-${checkNumber}.pdf` : 'check.pdf';

    return new NextResponse(arrayBuf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': String(arrayBuf.byteLength),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
