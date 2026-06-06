/**
 * GET  /api/fixed-assets/:id  — fetch asset with depreciation entries and schedule.
 * POST /api/fixed-assets/:id  — action dispatch.
 *   body: { action: 'depreciate', date: ISO date string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getAsset, depreciationSchedule, postDepreciation } from '@/lib/services/fixedAssets';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' || err.code === 'UNBALANCED' ? 400
      : err.code === 'CONFLICT' ? 409
      : err.code === 'FORBIDDEN' ? 403
      : err.code === 'PERIOD_CLOSED' ? 400
      : 500;
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
  }
  console.error('[fixed-assets/[id]] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const asset = await getAsset(ctx, id);

    // Attach the full computed depreciation schedule to the response.
    const schedule = depreciationSchedule({
      cost: asset.cost,
      salvageValue: asset.salvageValue,
      usefulLifeMonths: asset.usefulLifeMonths,
      placedInService: new Date(asset.placedInService),
    });

    return NextResponse.json({ ...asset, schedule });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();
    const { action, date } = body;

    if (action === 'depreciate') {
      if (!date) {
        return NextResponse.json({ error: 'Missing required field: date' }, { status: 400 });
      }
      const result = await postDepreciation(ctx, {
        assetId: id,
        date: new Date(date),
      });
      return NextResponse.json(result, { status: 201 });
    }

    return NextResponse.json({ error: `Unknown action: "${action}"` }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}
