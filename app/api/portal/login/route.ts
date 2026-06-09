/** POST /api/portal/login — employee self-service login. Body: { email, password } */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { employees } from '@/lib/db/schema';
import { verifyPassword, createSessionToken, PORTAL_COOKIE } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email?.trim() || !password) {
    return NextResponse.json({ error: 'Email and password are required.', code: 'VALIDATION' }, { status: 400 });
  }
  const db = await getDb();
  const matches = await db.select().from(employees).where(eq(employees.email, email.trim().toLowerCase()));
  for (const emp of matches) {
    if (emp.portalPasswordHash && emp.isActive && (await verifyPassword(password, emp.portalPasswordHash))) {
      const res = NextResponse.json({ id: emp.id, name: `${emp.firstName} ${emp.lastName}` });
      res.cookies.set(PORTAL_COOKIE, createSessionToken(emp.id, 'portal'), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      });
      return res;
    }
  }
  return NextResponse.json({ error: 'Invalid email or password.', code: 'FORBIDDEN' }, { status: 401 });
}
