/**
 * GET  /api/items          — list items (query: includeInactive, type, search)
 * POST /api/items          — create a new item
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { listItems, createItem } from '@/lib/services/items';
import { setReorderPoint } from '@/lib/services/inventory';
import { ServiceError } from '@/lib/services/_base';
import type { ItemType } from '@/lib/services/items';

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

// ── GET /api/items ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const ctx = await getServerContext();
    const sp = req.nextUrl.searchParams;

    const opts = {
      includeInactive: sp.get('includeInactive') === 'true',
      type: (sp.get('type') as ItemType | null) ?? undefined,
      search: sp.get('search') ?? undefined,
    };

    const rows = await listItems(ctx, opts);
    return NextResponse.json({ items: rows });
  } catch (err) {
    if (err instanceof ServiceError) return serviceErrorToResponse(err);
    console.error('[GET /api/items]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── POST /api/items ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    let item = await createItem(ctx, {
      name: body.name,
      sku: body.sku ?? null,
      type: body.type ?? 'service',
      description: body.description ?? null,
      salesPrice: body.salesPrice ?? null,
      purchaseCost: body.purchaseCost ?? null,
      incomeAccountId: body.incomeAccountId ?? null,
      expenseAccountId: body.expenseAccountId ?? null,
      assetAccountId: body.assetAccountId ?? null,
      taxable: body.taxable ?? true,
    });

    // Reorder point is managed by the inventory service (it drives the
    // reorder report and low-stock alerts) rather than the item master data.
    if (body.reorderPoint != null && body.reorderPoint !== '') {
      item = await setReorderPoint(ctx, item.id, body.reorderPoint);
    }

    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) return serviceErrorToResponse(err);
    console.error('[POST /api/items]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
