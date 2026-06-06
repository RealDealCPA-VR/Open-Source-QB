/**
 * GET  /api/companies  — list all company files in this database
 * POST /api/companies  — create a new company (seeds a default Chart of Accounts)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listCompanies, createCompany, ensureDevCompany } from '@/lib/services/company';

export async function GET() {
  const db = await getDb();
  await ensureDevCompany(db); // guarantee at least one
  return NextResponse.json(await listCompanies(db));
}

export async function POST(req: NextRequest) {
  const db = await getDb();
  const body = await req.json();
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: 'Company name is required', code: 'VALIDATION' }, { status: 400 });
  }
  // Owner = the current/first user (auth will refine this later).
  const { userId } = await ensureDevCompany(db);
  const company = await createCompany(db, { name: body.name.trim(), ownerId: userId });
  return NextResponse.json(company, { status: 201 });
}
