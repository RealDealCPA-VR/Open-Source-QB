'use client';

/**
 * Monthly Profit & Loss — 12-column calendar-year view with CSV download.
 * Users pick a year; each account gets a column per month + a row total.
 */
import { useState, useCallback } from 'react';
import { BarChart2, Download } from 'lucide-react';
import {
  Button,
  Card,
  Label,
  Select,
  PageHeader,
  Table,
  Th,
  Td,
  Tr,
  toast,
} from '@/components/ui';
import { api } from '@/lib/client';
import { formatCurrency } from '@/lib/money';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MonthlyRow {
  accountId: string;
  code: string;
  name: string;
  months: string[];
  total: string;
}

interface MonthlyReport {
  year: number;
  income: MonthlyRow[];
  expenses: MonthlyRow[];
  monthlyTotalIncome: string[];
  monthlyTotalExpenses: string[];
  monthlyNetIncome: string[];
  totalIncome: string;
  totalExpenses: string;
  netIncome: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// ---------------------------------------------------------------------------
// CSV download
// ---------------------------------------------------------------------------

function buildCsv(report: MonthlyReport): string {
  const header = ['Account', ...MONTH_LABELS, 'Total'].join(',');
  const row = (name: string, months: string[], total: string) =>
    [
      `"${name}"`,
      ...months.map((m) => parseFloat(m).toFixed(2)),
      parseFloat(total).toFixed(2),
    ].join(',');

  const lines: string[] = [
    header,
    '== INCOME ==',
    ...report.income.map((r) => row(r.name, r.months, r.total)),
    row('Total Income', report.monthlyTotalIncome, report.totalIncome),
    '',
    '== EXPENSES ==',
    ...report.expenses.map((r) => row(r.name, r.months, r.total)),
    row('Total Expenses', report.monthlyTotalExpenses, report.totalExpenses),
    '',
    row('Net Income', report.monthlyNetIncome, report.netIncome),
  ];
  return lines.join('\n');
}

function downloadCsv(report: MonthlyReport) {
  const csv = buildCsv(report);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pl-monthly-${report.year}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AmountCell({ amount, bold }: { amount: string; bold?: boolean }) {
  const n = parseFloat(amount);
  return (
    <Td
      className={`text-right tabular-nums text-sm ${
        bold ? 'font-bold' : ''
      } ${n < 0 ? 'text-red-500' : ''}`}
    >
      {n === 0 ? (
        <span className="text-navy/25">—</span>
      ) : (
        formatCurrency(amount)
      )}
    </Td>
  );
}

function SectionRows({
  title,
  rows,
  monthTotals,
  grandTotal,
}: {
  title: string;
  rows: MonthlyRow[];
  monthTotals: string[];
  grandTotal: string;
}) {
  return (
    <>
      <Tr className="bg-navy/5 hover:bg-navy/5">
        <Td className="font-bold text-navy py-2 sticky left-0 bg-navy/5" colSpan={14}>
          {title}
        </Td>
      </Tr>
      {rows.map((r) => (
        <Tr key={r.accountId}>
          <Td className="pl-6 text-navy text-sm min-w-[180px] sticky left-0 bg-white">
            {r.name}
          </Td>
          {r.months.map((amt, i) => (
            <AmountCell key={i} amount={amt} />
          ))}
          <AmountCell amount={r.total} bold />
        </Tr>
      ))}
      <Tr className="border-t border-navy/20 hover:bg-transparent">
        <Td className="font-semibold text-navy/80 sticky left-0 bg-white">Total {title}</Td>
        {monthTotals.map((amt, i) => (
          <AmountCell key={i} amount={amt} bold />
        ))}
        <AmountCell amount={grandTotal} bold />
      </Tr>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PLMonthlyPage() {
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 10 }, (_, i) => currentYear - i);

  const [year, setYear] = useState(String(currentYear));
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<MonthlyReport>(`/api/reports/pl-monthly?year=${year}`);
      setReport(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load report.';
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, [year]);

  const net = report ? parseFloat(report.netIncome) : 0;

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Monthly P&amp;L"
        icon={BarChart2}
        action={
          report && (
            <Button variant="secondary" onClick={() => downloadCsv(report)}>
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          )
        }
      />

      {/* Controls */}
      <Card className="p-5 mb-6 max-w-sm">
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <Label htmlFor="year">Year</Label>
            <Select id="year" value={year} onChange={(e) => setYear(e.target.value)}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={run} disabled={loading}>
            {loading ? 'Loading…' : 'Run'}
          </Button>
        </div>
      </Card>

      {/* Report table */}
      {report && (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-navy">
              <thead>
                <tr className="border-b-2 border-navy/10">
                  <Th className="sticky left-0 bg-white min-w-[180px]">Account</Th>
                  {MONTH_LABELS.map((m) => (
                    <Th key={m} className="text-right min-w-[90px]">
                      {m} {report.year}
                    </Th>
                  ))}
                  <Th className="text-right min-w-[100px]">Total</Th>
                </tr>
              </thead>
              <tbody>
                <SectionRows
                  title="Income"
                  rows={report.income}
                  monthTotals={report.monthlyTotalIncome}
                  grandTotal={report.totalIncome}
                />
                <Tr>
                  <Td colSpan={14} className="py-1 border-none" />
                </Tr>
                <SectionRows
                  title="Expenses"
                  rows={report.expenses}
                  monthTotals={report.monthlyTotalExpenses}
                  grandTotal={report.totalExpenses}
                />
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-navy/30">
                  <td className="py-3 px-4 font-extrabold text-navy text-base sticky left-0 bg-white">
                    Net Income
                  </td>
                  {report.monthlyNetIncome.map((amt, i) => {
                    const n = parseFloat(amt);
                    return (
                      <td
                        key={i}
                        className={`py-3 px-4 text-right tabular-nums text-sm font-extrabold ${
                          n < 0 ? 'text-red-600' : n > 0 ? 'text-emerald-600' : 'text-navy/30'
                        }`}
                      >
                        {n === 0 ? '—' : formatCurrency(amt)}
                      </td>
                    );
                  })}
                  <td
                    className={`py-3 px-4 text-right tabular-nums text-base font-extrabold ${
                      net >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}
                  >
                    {formatCurrency(report.netIncome)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {!report && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-navy/30 text-sm gap-2">
          <BarChart2 className="h-12 w-12 opacity-30" />
          <p>Select a year and click Run.</p>
        </div>
      )}
    </main>
  );
}
