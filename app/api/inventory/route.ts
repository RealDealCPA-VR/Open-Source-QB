/**
 * GET  /api/inventory        — inventory valuation report
 * POST /api/inventory        — adjust inventory or record COGS
 *
 * POST body shapes:
 *   { action: 'adjust', itemId, quantityChange, unitCost?, date, memo? }
 *   { action: 'cogs',   itemId, quantity, date, memo? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { adjustInventory, recordCOGS, inventoryValuation } from '@/lib/services/inventory';
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

// ── GET /api/inventory ────────────────────────────────────────────────────────

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const ctx = await getServerContext();
    const valuation = await inventoryValuation(ctx);
    return NextResponse.json(valuation);
  } catch (err) {
    if (err instanceof ServiceError) return serviceErrorToResponse(err);
    console.error('[GET /api/inventory]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── POST /api/inventory ───────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const ctx = await getServerContext();
    const body = await req.json();
    const { action } = body as { action?: string };

    if (!action) {
      return NextResponse.json(
        { error: 'action is required: "adjust" or "cogs"', code: 'VALIDATION' },
        { status: 400 },
      );
    }

    if (action === 'adjust') {
      const { itemId, quantityChange, unitCost, date, memo } = body as {
        itemId: string;
        quantityChange: string | number;
        unitCost?: string | number | null;
        date: string;
        memo?: string | null;
      };

      if (!itemId) {
        return NextResponse.json({ error: 'itemId is required', code: 'VALIDATION' }, { status: 400 });
      }
      if (quantityChange == null) {
        return NextResponse.json(
          { error: 'quantityChange is required', code: 'VALIDATION' },
          { status: 400 },
        );
      }
      if (!date) {
        return NextResponse.json({ error: 'date is required', code: 'VALIDATION' }, { status: 400 });
      }

      const result = await adjustInventory(ctx, {
        itemId,
        quantityChange,
        unitCost: unitCost ?? null,
        date: new Date(date),
        memo: memo ?? null,
      });

      return NextResponse.json(result, { status: 201 });
    }

    if (action === 'cogs') {
      const { itemId, quantity, date, memo } = body as {
        itemId: string;
        quantity: string | number;
        date: string;
        memo?: string | null;
      };

      if (!itemId) {
        return NextResponse.json({ error: 'itemId is required', code: 'VALIDATION' }, { status: 400 });
      }
      if (quantity == null) {
        return NextResponse.json(
          { error: 'quantity is required', code: 'VALIDATION' },
          { status: 400 },
        );
      }
      if (!date) {
        return NextResponse.json({ error: 'date is required', code: 'VALIDATION' }, { status: 400 });
      }

      const result = await recordCOGS(ctx, {
        itemId,
        quantity,
        date: new Date(date),
        memo: memo ?? null,
      });

      return NextResponse.json(result, { status: 201 });
    }

    return NextResponse.json(
      { error: `Unknown action "${action}". Use "adjust" or "cogs".`, code: 'VALIDATION' },
      { status: 400 },
    );
  } catch (err) {
    if (err instanceof ServiceError) return serviceErrorToResponse(err);
    console.error('[POST /api/inventory]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
