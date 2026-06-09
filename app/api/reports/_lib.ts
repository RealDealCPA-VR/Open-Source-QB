/**
 * Shared helpers for the report API routes: ServiceError -> HTTP status mapping
 * and tolerant query-string date parsing. Not a route (underscore-prefixed).
 */
import { NextResponse } from 'next/server';
import { ServiceError } from '@/lib/services/_base';

export function reportError(err: unknown, tag: string) {
  if (err instanceof ServiceError) {
    const status =
      err.code === 'NOT_FOUND' ? 404
      : err.code === 'FORBIDDEN' ? 403
      : err.code === 'VALIDATION' || err.code === 'UNBALANCED' ? 400
      : err.code === 'CONFLICT' ? 409
      : 500;
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error(`[reports/${tag}] unexpected error:`, err);
  return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
}

/** Parse an optional date query param. Returns undefined when absent; throws on garbage. */
export function parseDateParam(value: string | null, name: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new ServiceError('VALIDATION', `Invalid ${name} date.`);
  }
  return d;
}

/** Build an optional {from,to} range from query params (undefined when neither set). */
export function parseRange(params: URLSearchParams): { from?: Date; to?: Date } | undefined {
  const from = parseDateParam(params.get('from'), 'from');
  const to = parseDateParam(params.get('to'), 'to');
  return from || to ? { from, to } : undefined;
}
