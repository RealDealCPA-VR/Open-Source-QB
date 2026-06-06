/**
 * GET  /api/fixed-assets  — list all fixed assets for the active company.
 * POST /api/fixed-assets  — create a new fixed asset.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { listAssets, createAsset } from '@/lib/services/fixedAssets';
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
  console.error('[fixed-assets] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(_req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const assets = await listAssets(ctx);
    return NextResponse.json(assets);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    const {
      name,
      cost,
      salvageValue,
      usefulLifeMonths,
      placedInService,
      depreciationExpenseAccountId,
      accumulatedDepreciationAccountId,
      assetAccountId,
    } = body;

    if (!name) {
      return NextResponse.json({ error: 'Missing required field: name' }, { status: 400 });
    }
    if (cost == null) {
      return NextResponse.json({ error: 'Missing required field: cost' }, { status: 400 });
    }
    if (!usefulLifeMonths) {
      return NextResponse.json({ error: 'Missing required field: usefulLifeMonths' }, { status: 400 });
    }
    if (!placedInService) {
      return NextResponse.json({ error: 'Missing required field: placedInService' }, { status: 400 });
    }

    const asset = await createAsset(ctx, {
      name,
      cost,
      salvageValue: salvageValue ?? null,
      usefulLifeMonths: Number(usefulLifeMonths),
      placedInService: new Date(placedInService),
      depreciationExpenseAccountId: depreciationExpenseAccountId ?? null,
      accumulatedDepreciationAccountId: accumulatedDepreciationAccountId ?? null,
      assetAccountId: assetAccountId ?? null,
    });

    return NextResponse.json(asset, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
