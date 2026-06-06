/**
 * GET  /api/vendors   — list vendors (optional ?includeInactive=true)
 * POST /api/vendors   — create a new vendor
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { createVendor, listVendors } from '@/lib/services/vendors';
import { ServiceError } from '@/lib/services/_base';

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
  console.error('[vendors/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const includeInactive = req.nextUrl.searchParams.get('includeInactive') === 'true';
    const rows = await listVendors(ctx, { includeInactive });
    return NextResponse.json(rows);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    // Minimal shape check — the service validates further.
    if (!body.displayName) {
      return NextResponse.json(
        { error: 'displayName is required', code: 'VALIDATION' },
        { status: 400 },
      );
    }

    const vendor = await createVendor(ctx, {
      displayName: body.displayName,
      companyName: body.companyName ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      address: body.address ?? null,
      terms: body.terms ?? null,
      is1099: typeof body.is1099 === 'boolean' ? body.is1099 : undefined,
      taxId: body.taxId ?? null,
      defaultExpenseAccountId: body.defaultExpenseAccountId ?? null,
      notes: body.notes ?? null,
    });

    return NextResponse.json(vendor, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
