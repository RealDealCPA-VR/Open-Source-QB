/**
 * POST /api/auth/request-reset — issue a password-reset token.
 * Body: { email }. Desktop app has no mail server, so the token is returned directly (in a hosted
 * deployment you would email a link instead). Always 200 to avoid email enumeration.
 */
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users } from '@/lib/db/schema';

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  const db = await getDb();
  const generic = { ok: true, message: 'If that account exists, a reset token has been generated.' };
  if (!email?.trim()) return NextResponse.json(generic);

  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!user) return NextResponse.json(generic);

  const token = crypto.randomBytes(24).toString('hex');
  await db
    .update(users)
    .set({ resetToken: token, resetExpires: new Date(Date.now() + 60 * 60 * 1000) })
    .where(eq(users.id, user.id));

  // Desktop: surface the token so the user can complete the reset locally.
  return NextResponse.json({ ...generic, token });
}
