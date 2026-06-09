'use client';

/**
 * useFocusParam — reads the `focus` query param produced by global-search
 * result hrefs (e.g. /invoices?focus=<id>) and, once the record list has
 * loaded, invokes `onFocus` with the matching record exactly once.
 *
 * Callers use useSearchParams, so the page component must be rendered inside
 * a <Suspense> boundary.
 */

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

export function useFocusParam<T extends { id: string }>(
  records: T[],
  loading: boolean,
  onFocus: (record: T) => void,
): void {
  const searchParams = useSearchParams();
  const focusId = searchParams.get('focus');

  const consumedRef = useRef(false);
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;

  useEffect(() => {
    if (consumedRef.current || !focusId || loading) return;
    // Consume once the list has loaded — even when the id is absent
    // (e.g. record deactivated), so later refetches don't re-trigger.
    consumedRef.current = true;
    const match = records.find((r) => r.id === focusId);
    if (match) onFocusRef.current(match);
  }, [focusId, loading, records]);
}
