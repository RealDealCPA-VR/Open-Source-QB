/**
 * GET /api/reports/budget-vs-actual
 *   ?budgetId=<uuid> (required)
 *   ?periods=monthly|quarterly (optional) — adds per-period budget/actual/
 *   variance columns to every row plus net per-period totals.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { budgetVsActual, type BudgetPeriodMode } from '@/lib/services/budgets';
import { reportError } from '../_lib';

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const params = req.nextUrl.searchParams;
    const budgetId = params.get('budgetId');
    if (!budgetId) {
      return NextResponse.json({ error: 'budgetId query parameter is required.' }, { status: 400 });
    }
    const periodsRaw = params.get('periods');
    let periods: BudgetPeriodMode | undefined;
    if (periodsRaw) {
      if (periodsRaw !== 'monthly' && periodsRaw !== 'quarterly') {
        return NextResponse.json(
          { error: "periods must be 'monthly' or 'quarterly'." },
          { status: 400 },
        );
      }
      periods = periodsRaw;
    }
    const report = await budgetVsActual(ctx, budgetId, { periods });
    return NextResponse.json(report);
  } catch (err) {
    return reportError(err, 'budget-vs-actual');
  }
}
