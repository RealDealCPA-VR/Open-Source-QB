/** POST /api/auth/2fa/setup — generate a TOTP secret for the current user (not yet enabled). */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { getSessionUserId } from '@/lib/auth';
import { generateSecret, otpauthUrl } from '@/lib/totp';

export async function POST() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Not authenticated', code: 'FORBIDDEN' }, { status: 401 });
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) return NextResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });

  const secret = generateSecret();
  await db.update(users).set({ totpSecret: secret }).where(eq(users.id, userId));
  return NextResponse.json({ secret, otpauthUrl: otpauthUrl(secret, user.email) });
}
