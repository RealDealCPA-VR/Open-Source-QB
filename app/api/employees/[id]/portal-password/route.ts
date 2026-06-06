/**
 * POST /api/employees/[id]/portal-password — owner/admin sets an employee's self-service password.
 * Body: { password }. Requires a main app session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getServerContext } from '@/lib/context';
import { getSessionUserId, hashPassword } from '@/lib/auth';
import { employees } from '@/lib/db/schema';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: 'Not authenticated', code: 'FORBIDDEN' }, { status: 401 });
  const { id } = await params;
  const { password } = await req.json();
  if (!password || password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters.', code: 'VALIDATION' }, { status: 400 });
  }
  const ctx = await getServerContext();
  const [emp] = await ctx.db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.id, id), eq(employees.companyId, ctx.companyId)));
  if (!emp) return NextResponse.json({ error: 'Employee not found', code: 'NOT_FOUND' }, { status: 404 });
  await ctx.db.update(employees).set({ portalPasswordHash: await hashPassword(password) }).where(eq(employees.id, id));
  return NextResponse.json({ ok: true });
}
