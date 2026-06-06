'use client';
/**
 * Cash Flow Statement page — indirect method.
 * Fetches GET /api/reports/cash-flow (optional ?from=&to= filters).
 * Shows Operating / Investing / Financing sections and net cash change.
 * "Download CSV" exports the visible report as a Blob download.
 */
import { useState, useCallback } from 'react';
import { Button, Card, Input, Label, PageHeader, toast } from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';

interface CashFlowReport {
  from?: string;
  to?: string;
  operating: {
    netIncome: string;
    changeInAR: string;
    changeInAP: string;
    changeInInventory: string;
    total: string;
  };
  investing: {
    netFixedAssetActivity: string;
    total: string;
  };
  financing: {
    netEquityActivity: string;
    total: string;
  };
  netCashChange: string;
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function toCsvRow(...cells: (string | number)[]): string {
  return cells
    .map((c) => {
      const s = String(c);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    })
    .join(',');
}

function buildCsv(report: CashFlowReport): string {
  const lines: string[] = [
    'Section,Line Item,Amount',
    toCsvRow('Operating', 'Net Income', report.operating.netIncome),
    toCsvRow('Operating', 'Change in Accounts Receivable', report.operating.changeInAR),
    toCsvRow('Operating', 'Change in Accounts Payable', report.operating.changeInAP),
    toCsvRow('Operating', 'Change in Inventory', report.operating.changeInInventory),
    toCsvRow('Operating', 'Total Operating', report.operating.total),
    toCsvRow('Investing', 'Net Fixed Asset Activity', report.investing.netFixedAssetActivity),
    toCsvRow('Investing', 'Total Investing', report.investing.total),
    toCsvRow('Financing', 'Net Equity Activity', report.financing.netEquityActivity),
    toCsvRow('Financing', 'Total Financing', report.financing.total),
    toCsvRow('Summary', 'Net Cash Change', report.netCashChange),
  ];
  return lines.join('\n');
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AmountCell({ value }: { value: string }) {
  const n = Number(value);
  return (
    <span className={`tabular-nums ${n < 0 ? 'text-red-600' : 'text-navy'}`}>
      {formatCurrency(value)}
    </span>
  );
}

function SectionRow({ label, value, indent }: { label: string; value: string; indent?: boolean }) {
  return (
    <tr className="border-b border-slate-100 hover:bg-electric/5">
      <td className={`py-2.5 px-4 text-navy${indent ? ' pl-10' : ' font-medium'}`}>{label}</td>
      <td className="py-2.5 px-4 text-right">
        <AmountCell value={value} />
      </td>
    </tr>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <tr className="bg-navy/5">
      <td className="py-2 px-4 font-bold text-navy text-sm uppercase tracking-wide" colSpan={2}>
        {title}
      </td>
    </tr>
  );
}

function SectionTotal({ label, value }: { label: string; value: string }) {
  const n = Number(value);
  return (
    <tr className="border-t border-navy/20 font-semibold bg-slate-50">
      <td className="py-2.5 px-4 text-navy/80">{label}</td>
      <td className={`py-2.5 px-4 text-right tabular-nums font-bold ${n < 0 ? 'text-red-600' : 'text-emerald'}`}>
        {formatCurrency(value)}
      </td>
    </tr>
  );
}

function Spacer() {
  return (
    <tr>
      <td colSpan={2} className="py-1" />
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CashFlowPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<CashFlowReport | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const url = `/api/reports/cash-flow${params.size ? `?${params}` : ''}`;
      const data = await api.get<CashFlowReport>(url);
      setReport(data);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load cash flow report.', 'danger');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  // Load on first render
  const [loaded, setLoaded] = useState(false);
  if (!loaded) {
    setLoaded(true);
    load();
  }

  function handleDownload() {
    if (!report) return;
    downloadCsv(buildCsv(report), 'cash-flow.csv');
    toast('CSV downloaded.', 'success');
  }

  const netCash = report ? Number(report.netCashChange) : 0;

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Cash Flow Statement"
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={handleDownload}
            disabled={!report}
          >
            Download CSV
          </Button>
        }
      />

      {/* Filters */}
      <Card className="p-5 mb-6 flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-[160px]">
          <Label htmlFor="cf-from">From</Label>
          <Input
            id="cf-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <Label htmlFor="cf-to">To</Label>
          <Input
            id="cf-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <Button onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Run Report'}
        </Button>
      </Card>

      {/* Report */}
      <Card className="p-0 overflow-hidden max-w-3xl">
        {loading && !report && (
          <div className="py-16 text-center text-navy/40">Loading…</div>
        )}
        {!loading && !report && (
          <div className="py-16 text-center text-navy/40">No data. Run the report above.</div>
        )}
        {report && (
          <>
            {/* Period label */}
            {(report.from || report.to) && (
              <div className="px-6 pt-4 pb-1 text-sm text-navy/50">
                Period:{' '}
                {report.from ? new Date(report.from).toLocaleDateString() : 'Beginning'} –{' '}
                {report.to ? new Date(report.to).toLocaleDateString() : 'Present'}
              </div>
            )}

            <table className="w-full border-collapse">
              <colgroup>
                <col className="w-3/4" />
                <col className="w-1/4" />
              </colgroup>
              <tbody>
                {/* Operating */}
                <SectionHeader title="Operating Activities" />
                <SectionRow label="Net Income" value={report.operating.netIncome} indent />
                <SectionRow
                  label="Change in Accounts Receivable"
                  value={report.operating.changeInAR}
                  indent
                />
                <SectionRow
                  label="Change in Accounts Payable"
                  value={report.operating.changeInAP}
                  indent
                />
                <SectionRow
                  label="Change in Inventory"
                  value={report.operating.changeInInventory}
                  indent
                />
                <SectionTotal label="Net Cash from Operating" value={report.operating.total} />
                <Spacer />

                {/* Investing */}
                <SectionHeader title="Investing Activities" />
                <SectionRow
                  label="Net Fixed Asset Activity"
                  value={report.investing.netFixedAssetActivity}
                  indent
                />
                <SectionTotal label="Net Cash from Investing" value={report.investing.total} />
                <Spacer />

                {/* Financing */}
                <SectionHeader title="Financing Activities" />
                <SectionRow
                  label="Net Equity Activity"
                  value={report.financing.netEquityActivity}
                  indent
                />
                <SectionTotal label="Net Cash from Financing" value={report.financing.total} />
              </tbody>

              {/* Net total */}
              <tfoot>
                <tr className="border-t-2 border-navy/30 text-lg">
                  <td className="py-4 px-4 font-extrabold text-navy">Net Cash Change</td>
                  <td
                    className={`py-4 px-4 text-right tabular-nums font-extrabold ${
                      netCash >= 0 ? 'text-emerald' : 'text-red-600'
                    }`}
                  >
                    {formatCurrency(report.netCashChange)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </>
        )}
      </Card>
    </main>
  );
}
