/**
 * POST /api/checks/pdf
 *
 * Renders a printable check PDF for the given payee, amount, date, and
 * optional memo / check number. The company name is pulled from the active
 * company context (same pattern as the invoice PDF route).
 *
 * Request body (JSON):
 *   { payee: string, amount: string, date: string, memo?: string, checkNumber?: string }
 *
 * Response: application/pdf (inline)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getCompany } from '@/lib/services/company';
import { renderCheckPdf, numberToWords } from '@/lib/pdf/check';
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
      payee?: unknown;
      amount?: unknown;
      date?: unknown;
      memo?: unknown;
      checkNumber?: unknown;
    };

    // --- Validate required fields ---
    if (!body.payee || typeof body.payee !== 'string' || !body.payee.trim()) {
      return NextResponse.json({ error: 'payee is required', code: 'VALIDATION' }, { status: 400 });
    }
    if (!body.amount || typeof body.amount !== 'string' || isNaN(parseFloat(body.amount as string))) {
      return NextResponse.json({ error: 'amount must be a valid decimal string', code: 'VALIDATION' }, { status: 400 });
    }
    if (!body.date || typeof body.date !== 'string' || !body.date.trim()) {
      return NextResponse.json({ error: 'date is required', code: 'VALIDATION' }, { status: 400 });
    }

    const payee       = (body.payee as string).trim();
    const amount      = (body.amount as string).trim();
    const date        = (body.date as string).trim();
    const memo        = body.memo && typeof body.memo === 'string' ? body.memo.trim() : undefined;
    const checkNumber = body.checkNumber != null ? String(body.checkNumber) : undefined;

    const ctx     = await getServerContext();
    const company = await getCompany(ctx);
    if (!company) {
      return NextResponse.json({ error: 'Company not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const pdfBytes = await renderCheckPdf({
      company: { name: company.name },
      payee,
      amountNumeric: amount,
      amountWords: numberToWords(amount),
      date,
      memo,
      checkNumber,
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
