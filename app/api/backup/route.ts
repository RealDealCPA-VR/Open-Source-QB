/**
 * GET  /api/backup  — download a .bka backup of the active company data dir.
 * POST /api/backup  — restore from a .bka file (raw bytes in request body).
 *
 * NOTE (POST): After a successful restore the running PGlite instance is NOT
 * automatically restarted. The restored data files are now on disk but the
 * in-memory database still reflects the old state. A server restart (or an
 * explicit closeDb + openDb call) is required before queries will see the
 * restored data. In the Electron build, the main process should relaunch the
 * renderer/server after receiving a restore confirmation.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerContext } from '@/lib/context';
import { getCompany } from '@/lib/services/company';
import { createBackup, restoreBackup } from '@/lib/services/backup';
import { ServiceError } from '@/lib/services/_base';

function errorResponse(err: unknown) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'VALIDATION' ? 400
      : err.code === 'FORBIDDEN' ? 403
      : err.code === 'CONFLICT' ? 409
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  console.error('[backup] unexpected error:', err);
  return NextResponse.json({ error: message }, { status: 500 });
}

// ---------------------------------------------------------------------------
// GET — download backup
// ---------------------------------------------------------------------------

export async function GET(_req: NextRequest) {
  try {
    // Resolve the active company name for the filename.
    let companyName: string | undefined;
    try {
      const ctx = await getServerContext();
      const company = await getCompany(ctx);
      companyName = company?.name ?? undefined;
    } catch {
      // If context resolution fails (e.g. first run), proceed without a name.
    }

    const { buffer, filename } = createBackup(companyName);

    // NextResponse body must be a BodyInit-compatible type. Copy the Buffer
    // bytes into a fresh concrete ArrayBuffer to satisfy the type constraint.
    const arrayBuf: ArrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    return new NextResponse(arrayBuf, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// POST — restore backup
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const arrayBuffer = await req.arrayBuffer();
    if (!arrayBuffer.byteLength) {
      return NextResponse.json({ error: 'Request body is empty.' }, { status: 400 });
    }

    const buffer = Buffer.from(arrayBuffer);
    const result = restoreBackup(buffer);

    // NOTE: A restart/db reopen is needed before the restored data is visible.
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
