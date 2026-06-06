/** GET /api/auth/me — the current authenticated user (or null). */
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

export async function GET() {
  return NextResponse.json(await getCurrentUser());
}
