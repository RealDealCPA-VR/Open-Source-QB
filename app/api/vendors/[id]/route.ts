/**
 * GET    /api/vendors/:id   — fetch a single vendor
 * PATCH  /api/vendors/:id   — update vendor fields
 * DELETE /api/vendors/:id   — deactivate (soft-delete) a vendor
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getVendor, updateVendor, deactivateVendor } from '@/lib/services/vendors';
import { ServiceError } from '@/lib/services/_base';
import { zodErrorBody } from '@/lib/validation/helpers';
import { updateVendorSchema } from '@/lib/validation/vendors';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'VALIDATION' || err.code === 'UNBALANCED'
          ? 400
          : err.code === 'FORBIDDEN'
            ? 403
            : err.code === 'CONFLICT'
              ? 409
              : 500;
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status });
  }
  console.error('[vendors/[id]/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const vendor = await getVendor(ctx, id);
    return NextResponse.json(vendor);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const body = await req.json().catch(() => ({}));

    // zod partial(): absent keys stay absent in the output, so the service can
    // distinguish "not supplied" from "explicitly set to null".
    const parsed = updateVendorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(zodErrorBody(parsed.error), { status: 400 });
    }

    const vendor = await updateVendor(ctx, id, parsed.data);
    return NextResponse.json(vendor);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const ctx = await getServerContext();
    const vendor = await deactivateVendor(ctx, id);
    return NextResponse.json(vendor);
  } catch (err) {
    return errorResponse(err);
  }
}
