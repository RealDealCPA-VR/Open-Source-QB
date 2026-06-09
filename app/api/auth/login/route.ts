/**
 * POST /api/auth/login — verify credentials, start a session, select the user's company.
 * Body: { email, password }
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { users, userCompanies, companies } from '@/lib/db/schema';
import { verifyPassword, createSessionToken, SESSION_COOKIE } from '@/lib/auth';
import { verifyTotp } from '@/lib/totp';
import { COMPANY_COOKIE } from '@/lib/context';

export async function POST(req: NextRequest) {
  const { email, password, totp } = await req.json();
  if (!email?.trim() || !password) {
    return NextResponse.json({ error: 'Email and password are required.', code: 'VALIDATION' }, { status: 400 });
  }
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase()));
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json({ error: 'Invalid email or password.', code: 'FORBIDDEN' }, { status: 401 });
  }

  // Second factor (TOTP) when enabled.
  if (user.totpEnabled && user.totpSecret) {
    if (!totp) {
      return NextResponse.json({ requires2fa: true });
    }
    if (!verifyTotp(user.totpSecret, String(totp), Date.now())) {
      return NextResponse.json({ error: 'Invalid authentication code.', code: 'FORBIDDEN' }, { status: 401 });
    }
  }

  // Find a company for this user (membership first, else owned).
  const [membership] = await db
    .select({ companyId: userCompanies.companyId })
    .from(userCompanies)
    .where(eq(userCompanies.userId, user.id))
    .limit(1);
  let companyId = membership?.companyId;
  if (!companyId) {
    const [owned] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, user.id)).limit(1);
    companyId = owned?.id;
  }

  const res = NextResponse.json({ id: user.id, name: user.name, email: user.email, companyId });
  const opts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 24 * 30 };
  res.cookies.set(SESSION_COOKIE, createSessionToken(user.id), opts);
  if (companyId) res.cookies.set(COMPANY_COOKIE, companyId, opts);
  return res;
}
