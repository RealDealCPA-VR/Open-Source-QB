/**
 * POST /api/companies/select  — set the active company (cookie read by getServerContext).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { companies } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { COMPANY_COOKIE } from '@/lib/context';

export async function POST(req: NextRequest) {
  const { companyId } = await req.json();
  if (!companyId) {
    return NextResponse.json({ error: 'companyId is required', code: 'VALIDATION' }, { status: 400 });
  }
  const db = await getDb();
  const [c] = await db.select().from(companies).where(eq(companies.id, companyId));
  if (!c) {
    return NextResponse.json({ error: 'Company not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  const res = NextResponse.json({ ok: true, company: c });
  res.cookies.set(COMPANY_COOKIE, companyId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
