/**
 * GET /api/reports/inventory-valuation/detail?itemId=&from=&to=
 *
 * Inventory Valuation Detail: transaction-level value movements per item from
 * posted journal entries on the item's inventory asset account, with running
 * balances. All params optional — omit itemId for every item with activity.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { inventoryValuationDetail } from '@/lib/services/inventory';
import { parseDateParam, reportError } from '../../_lib';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ctx = await getServerContext();
    const sp = req.nextUrl.searchParams;
    const result = await inventoryValuationDetail(ctx, {
      itemId: sp.get('itemId') || null,
      from: parseDateParam(sp.get('from'), 'from') ?? null,
      to: parseDateParam(sp.get('to'), 'to') ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    return reportError(err, 'inventory-valuation-detail');
  }
}
