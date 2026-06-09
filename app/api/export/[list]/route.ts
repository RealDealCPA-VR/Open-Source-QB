/**
 * GET /api/export/<list>.csv — export a core list as CSV.
 *
 * <list> ∈ customers | vendors | items | accounts | employees
 * (the .csv suffix is optional; /api/export/customers also works).
 *
 * Returns text/csv as an attachment download.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { exportListCsv } from '@/lib/services/listExport';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' ? 400
      : err.code === 'FORBIDDEN' ? 403
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error('[export/[list]] unexpected error:', err);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

interface RouteParams {
  params: Promise<{ list: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { list } = await params;
    const name = decodeURIComponent(list).replace(/\.csv$/i, '').toLowerCase();

    const ctx = await getServerContext();
    const { filename, csv } = await exportListCsv(ctx, name);

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
