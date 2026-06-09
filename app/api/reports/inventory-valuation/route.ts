/**
 * GET /api/reports/inventory-valuation
 *   — no params: current valuation summary (item fields / FIFO layers; ties to GL 1300)
 *   — ?asOf=YYYY-MM-DD: GL-reconstructed valuation at a past date (see
 *     inventoryValuationAsOf for the documented approximations)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { inventoryValuation, inventoryValuationAsOf } from '@/lib/services/inventory';
import { parseDateParam, reportError } from '../_lib';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ctx = await getServerContext();
    const asOf = parseDateParam(req.nextUrl.searchParams.get('asOf'), 'asOf');

    if (asOf) {
      const result = await inventoryValuationAsOf(ctx, asOf);
      return NextResponse.json({ mode: 'asOf', ...result });
    }

    const current = await inventoryValuation(ctx);
    return NextResponse.json({ mode: 'current', asOf: null, ...current });
  } catch (err) {
    return reportError(err, 'inventory-valuation');
  }
}
