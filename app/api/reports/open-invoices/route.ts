/**
 * GET /api/reports/open-invoices — every invoice with a live open balance.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { openInvoices } from '@/lib/services/reportsExtra';
import { reportError } from '../_lib';

export async function GET(_req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const report = await openInvoices(ctx);
    return NextResponse.json(report);
  } catch (err) {
    return reportError(err, 'open-invoices');
  }
}
