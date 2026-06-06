'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock } from 'lucide-react';
import {
  Button,
  Card,
  Table,
  Th,
  Td,
  Tr,
  PageHeader,
  toast,
  Toaster,
} from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgingBucket {
  id: string;
  name: string;
  current: string;
  days1_30: string;
  days31_60: string;
  days61_90: string;
  days91plus: string;
  total: string;
}

interface AgingTotals {
  current: string;
  days1_30: string;
  days31_60: string;
  days61_90: string;
  days91plus: string;
  total: string;
}

interface AgingReport {
  asOf: string;
  rows: AgingBucket[];
  totals: AgingTotals;
}

// ---------------------------------------------------------------------------
// CSV download helper
// ---------------------------------------------------------------------------

function downloadCsv(report: AgingReport, filename: string) {
  const headers = ['Customer', 'Current', '1-30 Days', '31-60 Days', '61-90 Days', '91+ Days', 'Total'];
  const asOfDate = new Date(report.asOf).toLocaleDateString('en-US');

  const dataRows = report.rows.map((r) => [
    r.name,
    r.current,
    r.days1_30,
    r.days31_60,
    r.days61_90,
    r.days91plus,
    r.total,
  ]);

  const totalsRow = [
    'TOTAL',
    report.totals.current,
    report.totals.days1_30,
    report.totals.days31_60,
    report.totals.days61_90,
    report.totals.days91plus,
    report.totals.total,
  ];

  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = [
    `"A/R Aging Report — As Of ${asOfDate}"`,
    '',
    headers.map(escape).join(','),
    ...dataRows.map((row) => row.map(escape).join(',')),
    totalsRow.map(escape).join(','),
  ];

  const csv = lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function ArAgingPage() {
  const [report, setReport] = useState<AgingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<AgingReport>('/api/reports/ar-aging');
      setReport(data);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load AR aging report.';
      setError(msg);
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const asOfLabel = report
    ? new Date(report.asOf).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <Toaster />

      <PageHeader
        title="A/R Aging"
        icon={Clock}
        action={
          <div className="flex items-center gap-3">
            {asOfLabel && (
              <span className="text-sm text-navy/60">As of {asOfLabel}</span>
            )}
            <Button
              variant="secondary"
              size="sm"
              disabled={!report || loading}
              onClick={() => {
                if (report) downloadCsv(report, 'ar-aging.csv');
              }}
            >
              Download CSV
            </Button>
          </div>
        }
      />

      <Card className="p-0 overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center py-16 text-navy/50 text-sm">
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

        {!loading && !error && report && (
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th className="text-right">Current</Th>
                <Th className="text-right">1–30 Days</Th>
                <Th className="text-right">31–60 Days</Th>
                <Th className="text-right">61–90 Days</Th>
                <Th className="text-right">91+ Days</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {report.rows.length === 0 ? (
                <tr>
                  <Td colSpan={7} className="py-12 text-center text-navy/40">
                    No outstanding receivables.
                  </Td>
                </tr>
              ) : (
                report.rows.map((row) => (
                  <Tr key={row.id}>
                    <Td className="font-medium">{row.name}</Td>
                    <Td className="text-right tabular-nums">
                      {formatCurrency(row.current)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatCurrency(row.days1_30)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatCurrency(row.days31_60)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatCurrency(row.days61_90)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatCurrency(row.days91plus)}
                    </Td>
                    <Td className="text-right tabular-nums font-semibold">
                      {formatCurrency(row.total)}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
            {report.rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-navy/20 bg-navy/5 font-bold text-navy">
                  <td className="py-3 px-4">Total</td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {formatCurrency(report.totals.current)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {formatCurrency(report.totals.days1_30)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {formatCurrency(report.totals.days31_60)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {formatCurrency(report.totals.days61_90)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {formatCurrency(report.totals.days91plus)}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {formatCurrency(report.totals.total)}
                  </td>
                </tr>
              </tfoot>
            )}
          </Table>
        )}
      </Card>
    </main>
  );
}
