'use client';

/**
 * Generic flat-table report page: optional date-range or as-of controls, CSV
 * export, loading/error states, totals footer. Each concrete report page just
 * supplies columns + an endpoint builder. Underscore folder — not a route.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, EmptyState, PageHeader, Spinner, Table, Th, Td, Tr, toast } from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { AsOfControl, RangeControls, downloadCsv, todayStr, yearStartStr, type CsvCell } from './shared';

export interface SimpleColumn<R> {
  header: string;
  /** Right-align + tabular-nums (money/qty columns). */
  numeric?: boolean;
  /** Extra classes for the body cell. */
  className?: string;
  cell: (row: R) => React.ReactNode;
  csv: (row: R) => CsvCell;
}

export interface SimpleReportProps<T, R> {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  csvName: string;
  emptyText: string;
  /** 'range' renders From/To, 'asof' renders a single As-of date, 'none' renders no controls. */
  controls: 'range' | 'asof' | 'none';
  /** Defaults for the range controls (fall back to fiscal-year start / today). */
  defaultFrom?: string;
  defaultTo?: string;
  buildUrl: (q: { from: string; to: string; asOf: string }) => string;
  getRows: (data: T) => R[];
  columns: SimpleColumn<R>[];
  /** Optional subtitle derived from the loaded report (e.g. period label). */
  subtitle?: (data: T) => string;
  /** Optional totals/footer rows: label + per-column CSV-able cells, rendered in tfoot. */
  footerRows?: (data: T) => { cells: CsvCell[]; emphasized?: boolean }[];
}

export default function SimpleReport<T, R>({
  title,
  icon,
  csvName,
  emptyText,
  controls,
  defaultFrom,
  defaultTo,
  buildUrl,
  getRows,
  columns,
  subtitle,
  footerRows,
}: SimpleReportProps<T, R>) {
  const [from, setFrom] = useState(defaultFrom ?? yearStartStr());
  const [to, setTo] = useState(defaultTo ?? todayStr());
  const [asOf, setAsOf] = useState(todayStr());
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.get<T>(buildUrl({ from, to, asOf }));
      setData(result);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : `Failed to load ${title}.`;
      setError(msg);
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, asOf, buildUrl, title]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = data ? getRows(data) : [];

  const exportCsv = () => {
    if (!data) return;
    const csvRows: CsvCell[][] = rows.map((r) => columns.map((c) => c.csv(r)));
    for (const f of footerRows?.(data) ?? []) csvRows.push(f.cells);
    downloadCsv(
      csvName,
      `${title}${subtitle && data ? ` — ${subtitle(data)}` : ''}`,
      columns.map((c) => c.header),
      csvRows,
    );
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title={title}
        icon={icon}
        action={
          <Button variant="secondary" size="sm" disabled={!data || loading} onClick={exportCsv}>
            Download CSV
          </Button>
        }
      />

      {controls !== 'none' && (
        <Card className="p-4 mb-4">
          {controls === 'range' ? (
            <RangeControls from={from} to={to} onFrom={setFrom} onTo={setTo} onRun={load} />
          ) : (
            <AsOfControl asOf={asOf} onChange={setAsOf} onRun={load} />
          )}
        </Card>
      )}

      {data && subtitle && (
        <p className="text-sm text-navy/60 mb-3">{subtitle(data)}</p>
      )}

      <Card className="p-0 overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-navy/50 text-sm">
            <Spinner className="text-electric" />
            Loading…
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <p className="text-red-600 text-sm">{error}</p>
            <Button variant="secondary" size="sm" onClick={load}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && data && (
          <Table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <Th key={c.header} numeric={c.numeric} className={c.className}>
                    {c.header}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}>
                    <EmptyState icon={icon} title={emptyText} />
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <Tr key={i}>
                    {columns.map((c) => (
                      <Td key={c.header} numeric={c.numeric} className={c.className}>
                        {c.cell(row)}
                      </Td>
                    ))}
                  </Tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && footerRows && (
              <tfoot>
                {footerRows(data).map((f, i) => (
                  <tr
                    key={i}
                    className={
                      f.emphasized
                        ? 'border-t-2 border-navy/20 bg-navy/5 font-bold text-navy'
                        : 'border-t border-navy/10 font-semibold text-navy/80'
                    }
                  >
                    {f.cells.map((cell, j) => (
                      <td
                        key={j}
                        className={`py-3 px-4 ${columns[j]?.numeric || columns[j]?.className?.includes('text-right') ? 'text-right tabular-nums' : ''}`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tfoot>
            )}
          </Table>
        )}
      </Card>
    </main>
  );
}
