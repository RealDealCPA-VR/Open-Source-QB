/**
 * POST /api/merge
 *
 * Merge duplicate customers or vendors.
 *
 * Request body:
 *   {
 *     type:   'customer' | 'vendor',
 *     fromId: string,   // duplicate — will be deactivated
 *     toId:   string,   // master — survives
 *   }
 *
 * Response 200: { reassigned: {...}, deactivatedId: string }
 * Errors: 400 (validation), 404 (not found), 409 (conflict), 500.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { mergeCustomers, mergeVendors } from '@/lib/services/merge';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' ? 400
      : err.code === 'CONFLICT' ? 409
      : err.code === 'FORBIDDEN' ? 403
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[merge/route]', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getServerContext();
    const body = await req.json();

    const { type, fromId, toId } = body as {
      type?: string;
      fromId?: string;
      toId?: string;
    };

    if (!type || !fromId || !toId) {
      return NextResponse.json(
        { error: 'type, fromId, and toId are required', code: 'VALIDATION' },
        { status: 400 },
      );
    }

    if (type !== 'customer' && type !== 'vendor') {
      return NextResponse.json(
        { error: "type must be 'customer' or 'vendor'", code: 'VALIDATION' },
        { status: 400 },
      );
    }

    let result;
    if (type === 'customer') {
      result = await mergeCustomers(ctx, { fromId, toId });
    } else {
      result = await mergeVendors(ctx, { fromId, toId });
    }

    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
