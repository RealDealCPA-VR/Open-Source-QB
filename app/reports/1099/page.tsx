'use client';

import { useEffect, useState, useCallback } from 'react';
import { Receipt, Download } from 'lucide-react';
import {
  Button,
  Card,
  Label,
  Select,
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

interface Vendor1099Row {
  vendorId: string;
  vendorName: string;
  taxId: string | null;
  total: string;
}

// ---------------------------------------------------------------------------
// CSV download
// ---------------------------------------------------------------------------

function downloadCsv(rows: Vendor1099Row[], year: number) {
  const headers = ['Vendor Name', 'Tax ID (EIN/SSN)', 'Total Payments'];
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;

  const lines = [
    `"1099 Vendor Report — Calendar Year ${year}"`,
    `"Only vendors with total payments >= $600 are listed."`,
    '',
    headers.map(escape).join(','),
    ...rows.map((r) =>
      [r.vendorName, r.taxId ?? '', r.total].map(escape).join(','),
    ),
  ];

  const csv = lines.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `1099-report-${year}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Year options (5 years back from current)
// ---------------------------------------------------------------------------

function buildYearOptions() {
  const current = new Date().getFullYear();
  const years: number[] = [];
  for (let y = current; y >= current - 5; y--) {
    years.push(y);
  }
  return years;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Report1099Page() {
  const currentYear = new Date().getFullYear();
  const yearOptions = buildYearOptions();

  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const [rows, setRows] = useState<Vendor1099Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRows(null);
    try {
      const data = await api.get<Vendor1099Row[]>(`/api/reports/1099?year=${selectedYear}`);
      setRows(data);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load 1099 report.';
      setError(msg);
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, [selectedYear]);

  // Auto-load on mount
  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalAll = rows
    ? rows.reduce((sum, r) => sum + parseFloat(r.total), 0).toFixed(2)
    : null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <Toaster />

      <PageHeader
        title="1099 Vendor Report"
        icon={Receipt}
        action={
          <div className="flex items-center gap-3">
            {rows && rows.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => downloadCsv(rows, parseInt(selectedYear, 10))}
              >
                <Download className="h-4 w-4" />
                Download CSV
              </Button>
            )}
          </div>
        }
      />

      {/* ---- Year picker ---- */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label htmlFor="year">Calendar Year</Label>
            <Select
              id="year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
            >
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={loadReport} disabled={loading}>
            {loading ? 'Loading…' : 'Run Report'}
          </Button>
        </div>

        <p className="mt-3 text-xs text-navy/50">
          Lists 1099-eligible vendors (marked as 1099 in vendor settings) with total payments of
          $600 or more in the selected calendar year. Sources: bill payments and direct expenses.
        </p>
      </Card>

      {/* ---- Results ---- */}
      {loading && (
        <Card>
          <div className="flex items-center justify-center py-16 text-navy/50 text-sm">
            Loading…
          </div>
        </Card>
      )}

      {!loading && error && (
        <Card>
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <p className="text-red-600 text-sm">{error}</p>
            <Button variant="secondary" size="sm" onClick={loadReport}>
              Retry
            </Button>
          </div>
        </Card>
      )}

      {!loading && !error && rows !== null && (
        <Card className="p-0 overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>Vendor Name</Th>
                <Th>Tax ID (EIN / SSN)</Th>
                <Th className="text-right">Total Payments</Th>
                <Th>Eligible</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <Td colSpan={4} className="py-12 text-center text-navy/40">
                    No 1099-eligible vendors with payments of $600 or more in {selectedYear}.
                  </Td>
                </tr>
              ) : (
                rows.map((row) => (
                  <Tr key={row.vendorId}>
                    <Td className="font-semibold text-navy">{row.vendorName}</Td>
                    <Td className="tabular-nums text-navy/70">
                      {row.taxId ?? (
                        <span className="italic text-amber-600 text-xs">Not on file</span>
                      )}
                    </Td>
                    <Td className="text-right tabular-nums font-semibold">
                      {formatCurrency(row.total)}
                    </Td>
                    <Td>
                      <span className="inline-flex items-center rounded-full bg-emerald/15 px-2.5 py-0.5 text-xs font-semibold text-emerald">
                        Eligible
                      </span>
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && totalAll && (
              <tfoot>
                <tr className="border-t-2 border-navy/20 bg-navy/5 font-bold text-navy">
                  <td colSpan={2} className="py-3 px-4">
                    Total — {rows.length} vendor{rows.length !== 1 ? 's' : ''}
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">
                    {formatCurrency(totalAll)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </Table>
        </Card>
      )}
    </main>
  );
}
