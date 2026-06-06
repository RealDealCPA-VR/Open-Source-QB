/**
 * GET /api/payroll/paystub?paycheckId=<uuid>
 *
 * Loads the paycheck, its lines, the employee, and the company, then renders
 * a pay stub PDF and returns it inline (application/pdf).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getCompany } from '@/lib/services/company';
import { ServiceError } from '@/lib/services/_base';
import { renderPaystubPdf } from '@/lib/pdf/paystub';
import { and, eq } from 'drizzle-orm';
import { paychecks, paycheckLines, employees } from '@/lib/db/schema';

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
  console.error('[payroll/paystub] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

/** Format a Date or timestamp to YYYY-MM-DD. */
function fmtDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const { searchParams } = req.nextUrl;

    const paycheckId = searchParams.get('paycheckId');
    if (!paycheckId) {
      return NextResponse.json(
        { error: 'paycheckId query parameter is required.' },
        { status: 400 },
      );
    }

    // Load the paycheck — scoped to company.
    const [paycheck] = await ctx.db
      .select()
      .from(paychecks)
      .where(and(eq(paychecks.id, paycheckId), eq(paychecks.companyId, ctx.companyId)));

    if (!paycheck) {
      return NextResponse.json({ error: 'Paycheck not found.', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Load the employee — also scoped to company.
    const [employee] = await ctx.db
      .select()
      .from(employees)
      .where(and(eq(employees.id, paycheck.employeeId), eq(employees.companyId, ctx.companyId)));

    if (!employee) {
      return NextResponse.json({ error: 'Employee not found.', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Load paycheck lines.
    const lines = await ctx.db
      .select()
      .from(paycheckLines)
      .where(eq(paycheckLines.paycheckId, paycheckId));

    // Load company.
    const company = await getCompany(ctx);
    if (!company) {
      return NextResponse.json({ error: 'Company not found.', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Render PDF.
    const pdfBytes = await renderPaystubPdf({
      company: { name: company.name },
      employee: {
        firstName: employee.firstName,
        lastName:  employee.lastName,
      },
      paycheck: {
        payDate:     fmtDate(paycheck.payDate),
        periodStart: paycheck.periodStart ? fmtDate(paycheck.periodStart) : null,
        periodEnd:   paycheck.periodEnd   ? fmtDate(paycheck.periodEnd)   : null,
        grossPay:    paycheck.grossPay,
        netPay:      paycheck.netPay,
      },
      lines: lines.map((l) => ({
        kind:   l.kind as 'earning' | 'tax' | 'deduction' | 'employer_contribution',
        name:   l.name,
        amount: l.amount,
      })),
    });

    // Slice to an owned ArrayBuffer (same pattern as the invoice PDF route).
    const arrayBuf: ArrayBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength,
    ) as ArrayBuffer;

    const empSlug = `${employee.lastName}-${employee.firstName}`.replace(/\s+/g, '-').toLowerCase();
    const filename = `paystub-${empSlug}-${fmtDate(paycheck.payDate)}.pdf`;

    return new NextResponse(arrayBuf, {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length':      String(arrayBuf.byteLength),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
