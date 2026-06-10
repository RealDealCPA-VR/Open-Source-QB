/**
 * POST /api/unlock — open the company-file lock.
 *
 * Verifies a submitted file password (or passes straight through when the file has no password)
 * and, on success, sets the signed `bka_unlock` cookie that getServerContext + middleware require.
 * Uses the database directly (NOT getServerContext), since the whole point is to run before the
 * file is unlocked.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getFileLockStatus, verifyFilePassword } from '@/lib/services/fileLock';
import { UNLOCK_COOKIE, createUnlockToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const db = await getDb();

  let password = '';
  try {
    const body = await req.json();
    if (typeof body?.password === 'string') password = body.password;
  } catch {
    /* empty / non-JSON body → treated as an empty password (only succeeds when unprotected) */
  }

  const status = await getFileLockStatus(db);
  const ok = !status.enabled || (await verifyFilePassword(db, password));
  if (!ok) {
    return NextResponse.json(
      { ok: false, enabled: true, companyName: status.companyName },
      { status: 401 },
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(UNLOCK_COOKIE, createUnlockToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return res;
}
