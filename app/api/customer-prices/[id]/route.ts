/**
 * DELETE /api/customer-prices/:id   — remove a custom price row
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { deleteCustomerPrice } from '@/lib/services/customerPricing';
import { ServiceError } from '@/lib/services/_base';

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

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ── DELETE /api/customer-prices/:id ──────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    await deleteCustomerPrice(ctx, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof ServiceError) return serviceErrorToResponse(err);
    console.error('[DELETE /api/customer-prices/:id]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
