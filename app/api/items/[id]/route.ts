/**
 * GET    /api/items/:id    — fetch a single item
 * PATCH  /api/items/:id    — update an item (partial update)
 * DELETE /api/items/:id    — soft-delete (deactivate) an item
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getItem, updateItem, deactivateItem } from '@/lib/services/items';
import { ServiceError } from '@/lib/services/_base';

// ── Error helper ──────────────────────────────────────────────────────────────

function serviceErrorToResponse(err: ServiceError): NextResponse {
  const statusMap: Record<string, number> = {
    NOT_FOUND: 404,
    VALIDATION: 400,
    UNBALANCED: 400,
    FORBIDDEN: 403,
    CONFLICT: 409,
    PERIOD_CLOSED: 409,
  };
  const status = statusMap[err.code] ?? 500;
  return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
}

// ── Route params type ─────────────────────────────────────────────────────────

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ── GET /api/items/:id ────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const item = await getItem(ctx, id);
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof ServiceError) return serviceErrorToResponse(err);
    console.error('[GET /api/items/:id]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── PATCH /api/items/:id ──────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json();

    // Only forward keys that were actually present in the request body so that
    // updateItem can distinguish "not provided" from "explicitly set to null".
    const patch: Parameters<typeof updateItem>[2] = {};
    if ('name' in body)              patch.name = body.name;
    if ('sku' in body)               patch.sku = body.sku ?? null;
    if ('type' in body)              patch.type = body.type;
    if ('description' in body)       patch.description = body.description ?? null;
    if ('salesPrice' in body)        patch.salesPrice = body.salesPrice ?? null;
    if ('purchaseCost' in body)      patch.purchaseCost = body.purchaseCost ?? null;
    if ('incomeAccountId' in body)   patch.incomeAccountId = body.incomeAccountId ?? null;
    if ('expenseAccountId' in body)  patch.expenseAccountId = body.expenseAccountId ?? null;
    if ('assetAccountId' in body)    patch.assetAccountId = body.assetAccountId ?? null;
    if ('taxable' in body)           patch.taxable = body.taxable;
    if ('isActive' in body)          patch.isActive = body.isActive;

    const item = await updateItem(ctx, id, patch);
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof ServiceError) return serviceErrorToResponse(err);
    console.error('[PATCH /api/items/:id]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── DELETE /api/items/:id ─────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const item = await deactivateItem(ctx, id);
    return NextResponse.json({ item });
  } catch (err) {
    if (err instanceof ServiceError) return serviceErrorToResponse(err);
    console.error('[DELETE /api/items/:id]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
