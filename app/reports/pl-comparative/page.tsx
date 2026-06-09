'use client';

/**
 * Comparative Profit & Loss — current period vs prior period.
 * Users pick two date ranges; the table shows current / prior / variance / variance %.
 */
import { useState, useCallback, useEffect } from 'react';
import { TrendingUp } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Label,
  PageHeader,
  Table,
  Th,
  Td,
  Tr,
  toast,
} from '@/components/ui';
import { api } from '@/lib/client';
import { formatCurrency } from '@/lib/money';
import ReportToolbar, { type ExportTable } from '../_components/ReportToolbar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ComparativeRow {
  accountId: string;
  code: string;
  name: string;
  current: string;
  prior: string;
  variance: string;
  variancePct: string | null;
}

interface ComparativeTotals {
  currentTotalIncome: string;
  priorTotalIncome: string;
  varianceTotalIncome: string;
  variancePctTotalIncome: string | null;
  currentTotalExpenses: string;
  priorTotalExpenses: string;
  varianceTotalExpenses: string;
  variancePctTotalExpenses: string | null;
  currentNetIncome: string;
  priorNetIncome: string;
  varianceNetIncome: string;
  variancePctNetIncome: string | null;
}

interface ComparativeReport {
  income: ComparativeRow[];
  expenses: ComparativeRow[];
  totals: ComparativeTotals;
  from: string;
  to: string;
  priorFrom: string;
  priorTo: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pctLabel(pct: string | null): string {
  if (pct === null) return '—';
  const n = parseFloat(pct);
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

/**
 * Color a variance by whether it is favorable. For income, an increase is
 * favorable (emerald); for expenses, an increase in spending is unfavorable
 * (red) and a decrease is favorable (emerald).
 */
function varianceClass(variance: string, direction: 'income' | 'expense' = 'income'): string {
  const n = parseFloat(variance);
  if (n === 0) return 'text-navy/50';
  const favorable = direction === 'expense' ? n < 0 : n > 0;
  return favorable ? 'text-emerald' : 'text-red-500';
}

// ---------------------------------------------------------------------------
// Section component
// ---------------------------------------------------------------------------

function Section({
  title,
  rows,
  currentTotal,
  priorTotal,
  varianceTotal,
  variancePctTotal,
  direction,
}: {
  title: string;
  rows: ComparativeRow[];
  currentTotal: string;
  priorTotal: string;
  varianceTotal: string;
  variancePctTotal: string | null;
  direction: 'income' | 'expense';
}) {
  return (
    <>
      <Tr className="bg-navy/5 hover:bg-navy/5">
        <Td className="font-bold text-navy py-2" colSpan={5}>
          {title}
        </Td>
      </Tr>
      {rows.map((r) => (
        <Tr key={r.accountId}>
          <Td className="pl-8 text-navy">{r.name}</Td>
          <Td className="text-right tabular-nums">{formatCurrency(r.current)}</Td>
          <Td className="text-right tabular-nums text-navy/60">{formatCurrency(r.prior)}</Td>
          <Td className={`text-right tabular-nums ${varianceClass(r.variance, direction)}`}>
            {formatCurrency(r.variance)}
          </Td>
          <Td className={`text-right tabular-nums text-sm ${varianceClass(r.variance, direction)}`}>
            {pctLabel(r.variancePct)}
          </Td>
        </Tr>
      ))}
      <Tr className="border-t border-navy/20 font-semibold text-navy/80 hover:bg-transparent">
        <Td className="py-2">Total {title}</Td>
        <Td className="text-right tabular-nums">{formatCurrency(currentTotal)}</Td>
        <Td className="text-right tabular-nums text-navy/60">{formatCurrency(priorTotal)}</Td>
        <Td className={`text-right tabular-nums ${varianceClass(varianceTotal, direction)}`}>
          {formatCurrency(varianceTotal)}
        </Td>
        <Td className={`text-right tabular-nums text-sm ${varianceClass(varianceTotal, direction)}`}>
          {pctLabel(variancePctTotal)}
        </Td>
      </Tr>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PLComparativePage() {
  const currentYear = new Date().getFullYear();

  // Current period defaults: this year Jan 1 – today
  const [from, setFrom] = useState(`${currentYear}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  // Prior period defaults: last year same range
  const [priorFrom, setPriorFrom] = useState(`${currentYear - 1}-01-01`);
  const [priorTo, setPriorTo] = useState(`${currentYear - 1}-12-31`);

  const [report, setReport] = useState<ComparativeReport | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    if (!from || !to || !priorFrom || !priorTo) {
      toast('Please fill in all four date fields.', 'danger');
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to, priorFrom, priorTo });
      const data = await api.get<ComparativeReport>(
        `/api/reports/pl-comparative?${params.toString()}`,
      );
      setReport(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load report.';
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, [from, to, priorFrom, priorTo]);

  // Auto-load the pre-filled default ranges on mount.
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const net = report ? parseFloat(report.totals.currentNetIncome) : 0;

  const sectionRows = (rows: ComparativeRow[]) =>
    rows.map(
      (r) => [r.name, r.current, r.prior, r.variance, pctLabel(r.variancePct)] as (string | null)[],
    );
  const table: ExportTable | null = report
    ? {
        filename: 'pl-comparative',
        title: 'Comparative Profit & Loss',
        subtitle: `${report.from.slice(0, 10)} to ${report.to.slice(0, 10)} vs ${report.priorFrom.slice(0, 10)} to ${report.priorTo.slice(0, 10)}`,
        columns: [
          { header: 'Account' },
          { header: 'Current', numeric: true },
          { header: 'Prior', numeric: true },
          { header: 'Variance $', numeric: true },
          { header: 'Variance %', numeric: true },
        ],
        rows: [
          ['INCOME', null, null, null, null],
          ...sectionRows(report.income),
          [
            'Total Income',
            report.totals.currentTotalIncome,
            report.totals.priorTotalIncome,
            report.totals.varianceTotalIncome,
            pctLabel(report.totals.variancePctTotalIncome),
          ],
          ['EXPENSES', null, null, null, null],
          ...sectionRows(report.expenses),
          [
            'Total Expenses',
            report.totals.currentTotalExpenses,
            report.totals.priorTotalExpenses,
            report.totals.varianceTotalExpenses,
            pctLabel(report.totals.variancePctTotalExpenses),
          ],
        ],
        totals: [
          [
            'Net Income',
            report.totals.currentNetIncome,
            report.totals.priorNetIncome,
            report.totals.varianceNetIncome,
            pctLabel(report.totals.variancePctNetIncome),
          ],
        ],
      }
    : null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader title="Comparative P&amp;L" icon={TrendingUp} />

      <ReportToolbar table={table} disabled={loading} />

      {/* Controls */}
      <Card className="p-5 mb-6 max-w-4xl print-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Current period */}
          <div>
            <p className="text-xs font-bold text-electric uppercase tracking-wide mb-2">
              Current Period
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="from">From</Label>
                <Input
                  id="from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="to">To</Label>
                <Input
                  id="to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Prior period */}
          <div>
            <p className="text-xs font-bold text-navy/40 uppercase tracking-wide mb-2">
              Prior Period
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="priorFrom">From</Label>
                <Input
                  id="priorFrom"
                  type="date"
                  value={priorFrom}
                  onChange={(e) => setPriorFrom(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="priorTo">To</Label>
                <Input
                  id="priorTo"
                  type="date"
                  value={priorTo}
                  onChange={(e) => setPriorTo(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={run} disabled={loading}>
            {loading ? 'Loading…' : 'Run Report'}
          </Button>
        </div>
      </Card>

      {/* Report table */}
      {report && (
        <Card className="p-0 overflow-hidden max-w-5xl">
          {/* Column headers */}
          <Table>
            <thead>
              <Tr className="hover:bg-transparent">
                <Th className="w-1/2">Account</Th>
                <Th className="text-right">
                  Current
                  <div className="text-[10px] font-normal text-navy/40">
                    {report.from.slice(0, 10)} – {report.to.slice(0, 10)}
                  </div>
                </Th>
                <Th className="text-right">
                  Prior
                  <div className="text-[10px] font-normal text-navy/40">
                    {report.priorFrom.slice(0, 10)} – {report.priorTo.slice(0, 10)}
                  </div>
                </Th>
                <Th className="text-right">Variance $</Th>
                <Th className="text-right">Variance %</Th>
              </Tr>
            </thead>
            <tbody>
              <Section
                title="Income"
                rows={report.income}
                currentTotal={report.totals.currentTotalIncome}
                priorTotal={report.totals.priorTotalIncome}
                varianceTotal={report.totals.varianceTotalIncome}
                variancePctTotal={report.totals.variancePctTotalIncome}
                direction="income"
              />
              <Tr>
                <Td colSpan={5} className="py-1 border-none" />
              </Tr>
              <Section
                title="Expenses"
                rows={report.expenses}
                currentTotal={report.totals.currentTotalExpenses}
                priorTotal={report.totals.priorTotalExpenses}
                varianceTotal={report.totals.varianceTotalExpenses}
                variancePctTotal={report.totals.variancePctTotalExpenses}
                direction="expense"
              />
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-navy/30 text-lg font-extrabold">
                <td className="py-3 px-4 text-navy">Net Income</td>
                <td
                  className={`py-3 px-4 text-right tabular-nums ${
                    net >= 0 ? 'text-emerald' : 'text-red-600'
                  }`}
                >
                  {formatCurrency(report.totals.currentNetIncome)}
                </td>
                <td className="py-3 px-4 text-right tabular-nums text-navy/60">
                  {formatCurrency(report.totals.priorNetIncome)}
                </td>
                <td
                  className={`py-3 px-4 text-right tabular-nums ${varianceClass(
                    report.totals.varianceNetIncome,
                  )}`}
                >
                  {formatCurrency(report.totals.varianceNetIncome)}
                </td>
                <td
                  className={`py-3 px-4 text-right tabular-nums text-sm ${varianceClass(
                    report.totals.varianceNetIncome,
                  )}`}
                >
                  {pctLabel(report.totals.variancePctNetIncome)}
                </td>
              </tr>
            </tfoot>
          </Table>
        </Card>
      )}

      {!report && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-navy/30 text-sm gap-2">
          <TrendingUp className="h-12 w-12 opacity-30" />
          <p>Select date ranges and click Run Report.</p>
        </div>
      )}
    </main>
  );
}
