/**
 * GET /api/plaid/status
 * Returns { configured: boolean } so the UI can show the appropriate state
 * without exposing any credentials.
 */
import { NextResponse } from 'next/server';
import { isConfigured } from '@/lib/services/plaid';

export async function GET() {
  return NextResponse.json({ configured: isConfigured() });
}
