/**
 * Shared display formatting helpers for pages. Currency lives in lib/money.ts;
 * this module covers dates so every list renders the same 'MMM d, yyyy' style.
 */
import { format } from 'date-fns';

/**
 * Format an ISO date (or full timestamp) string as e.g. "Jun 9, 2026".
 * Date-only strings are parsed as local dates (no UTC off-by-one).
 * Returns an em dash for null/empty/invalid input.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value.slice(0, 10) + 'T00:00:00') : value;
  if (Number.isNaN(d.getTime())) return '—';
  return format(d, 'MMM d, yyyy');
}
