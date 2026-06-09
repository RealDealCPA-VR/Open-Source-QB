/**
 * Shared date formatting for the UI. Keeps every page on the same
 * 'MMM d, yyyy' (en-US) rendering regardless of the machine locale.
 */
import { format, parseISO } from 'date-fns';

/** Format an ISO date/datetime string as e.g. 'Jun 9, 2026'. Returns '—' for empty input. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'MMM d, yyyy');
  } catch {
    return iso;
  }
}
