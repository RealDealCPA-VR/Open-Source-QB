/**
 * GET /api/email/status
 *
 * Returns whether SMTP is configured so the UI can show a hint when it is not.
 * Response: { configured: boolean }
 */
import { NextResponse } from 'next/server';
import { isConfigured } from '@/lib/services/email';

export async function GET() {
  return NextResponse.json({ configured: isConfigured() });
}
