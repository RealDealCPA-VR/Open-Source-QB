/**
 * GET  /api/companies  — list the caller's company files
 * POST /api/companies  — create a new company (seeds a default Chart of Accounts)
 *
 * SECURITY: middleware excludes /api from the session check, so these handlers must fail
 * closed themselves (mirrors app/api/companies/select/route.ts and lib/context.ts). The only
 * session-less path allowed is genuine first-run — before any user account exists — so
 * onboarding can boot (or an explicit BKA_ALLOW_DEV_FALLBACK=1).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb, type DB } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { getSessionUserId } from '@/lib/auth';
import {
  listCompanies,
  listCompaniesForUser,
  createCompany,
  ensureDevCompany,
} from '@/lib/services/company';

/** First-run carve-out: allow session-less access only before any user exists. */
async function allowFirstRun(db: DB): Promise<boolean> {
  if (process.env.BKA_ALLOW_DEV_FALLBACK === '1') return true;
  const [anyUser] = await db.select({ id: users.id }).from(users).limit(1);
  return !anyUser;
}

export async function GET() {
  const db = await getDb();
  const userId = await getSessionUserId();
  if (userId) {
    // Scope to the caller's memberships — never list other tenants' company files.
    return NextResponse.json(await listCompaniesForUser(db, userId));
  }
  if (!(await allowFirstRun(db))) {
    return NextResponse.json({ error: 'Unauthorized', code: 'FORBIDDEN' }, { status: 401 });
  }
  await ensureDevCompany(db); // first run: guarantee at least one
  return NextResponse.json(await listCompanies(db));
}

export async function POST(req: NextRequest) {
  const db = await getDb();
  const sessionUserId = await getSessionUserId();
  if (!sessionUserId && !(await allowFirstRun(db))) {
    return NextResponse.json({ error: 'Unauthorized', code: 'FORBIDDEN' }, { status: 401 });
  }
  const body = await req.json();
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: 'Company name is required', code: 'VALIDATION' }, { status: 400 });
  }
  // Owner = the authenticated user; first-run only, fall back to the seeded dev user.
  const ownerId = sessionUserId ?? (await ensureDevCompany(db)).userId;
  const company = await createCompany(db, { name: body.name.trim(), ownerId });
  return NextResponse.json(company, { status: 201 });
}
