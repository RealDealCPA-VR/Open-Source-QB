/** POST /api/auth/2fa/enable — verify a code against the pending secret and turn 2FA on. */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { getSessionUserId } from '@/lib/auth';
import { verifyTotp } from '@/lib/totp';

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Not authenticated', code: 'FORBIDDEN' }, { status: 401 });
  const { token } = await req.json();
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user?.totpSecret) {
    return NextResponse.json({ error: 'Run setup first', code: 'VALIDATION' }, { status: 400 });
  }
  if (!verifyTotp(user.totpSecret, String(token ?? ''), Date.now())) {
    return NextResponse.json({ error: 'Invalid code', code: 'FORBIDDEN' }, { status: 400 });
  }
  await db.update(users).set({ totpEnabled: true }).where(eq(users.id, userId));
  return NextResponse.json({ ok: true, enabled: true });
}
