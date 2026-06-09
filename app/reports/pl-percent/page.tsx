'use client';

/**
 * P&L — % of Income (common-size income statement). Each line shows its dollar
 * amount and its percentage of total income for the selected period.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Percent } from 'lucide-react';
import { Button, Card, PageHeader, Table, Th, Td, Tr, toast } from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';
import { RangeControls, downloadCsv, fmtDate, todayStr, yearStartStr, type CsvCell } from '../_components/shared';

interface PercentRow {
  accountId: string;
  code: string;
  name: string;
  amount: string;
  pctOfIncome: string | null;
}

interface PlPercentData {
  income: PercentRow[];
  expenses: PercentRow[];
  totalIncome: string;
  totalExpenses: string;
  netIncome: string;
  totalIncomePct: string | null;
  totalExpensesPct: string | null;
  netIncomePct: string | null;
  from?: string;
  to?: string;
}

function pct(v: string | null): string {
  return v === null ? '—' : `${v}%`;
}

function Section({
  title,
  rows,
  total,
  totalPct,
  from,
  to,
}: {
  title: string;
  rows: PercentRow[];
  total: string;
  totalPct: string | null;
  from: string;
  to: string;
}) {
  return (
    <>
      <Tr className="bg-navy/5 hover:bg-navy/5">
        <Td className="font-bold text-navy py-2" colSpan={3}>
          {title}
        </Td>
      </Tr>
      {rows.map((r) => (
        <Tr key={r.accountId}>
          <Td className="pl-8">
            <Link
              href={`/registers/${r.accountId}?from=${from}&to=${to}`}
              className="text-navy hover:text-electric hover:underline"
              title={`Open ${r.name} register`}
            >
              {r.name}
            </Link>
          </Td>
          <Td className="text-right tabular-nums">{formatCurrency(r.amount)}</Td>
          <Td className="text-right tabular-nums text-navy/60">{pct(r.pctOfIncome)}</Td>
        </Tr>
      ))}
      <Tr className="border-t border-navy/20 font-semibold text-navy/80 hover:bg-transparent">
        <Td className="py-2">Total {title}</Td>
        <Td className="py-2 text-right tabular-nums">{formatCurrency(total)}</Td>
        <Td className="py-2 text-right tabular-nums">{pct(totalPct)}</Td>
      </Tr>
    </>
  );
}

export default function PlPercentPage() {
  const [from, setFrom] = useState(yearStartStr());
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState<PlPercentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<PlPercentData>(`/api/reports/pl-percent?from=${from}&to=${to}`));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load report.';
      setError(msg);
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportCsv = () => {
    if (!data) return;
    const rows: CsvCell[][] = [
      ...data.income.map((r): CsvCell[] => ['Income', r.name, r.amount, r.pctOfIncome ?? '']),
      ['Total Income', '', data.totalIncome, data.totalIncomePct ?? ''],
      ...data.expenses.map((r): CsvCell[] => ['Expenses', r.name, r.amount, r.pctOfIncome ?? '']),
      ['Total Expenses', '', data.totalExpenses, data.totalExpensesPct ?? ''],
      ['Net Income', '', data.netIncome, data.netIncomePct ?? ''],
    ];
    downloadCsv(
      'pl-percent-of-income.csv',
      `P&L % of Income — ${fmtDate(data.from)} to ${fmtDate(data.to)}`,
      ['Section', 'Account', 'Amount', '% of Income'],
      rows,
    );
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="P&L — % of Income"
        icon={Percent}
        action={
          <Button variant="secondary" size="sm" disabled={!data || loading} onClick={exportCsv}>
            Download CSV
          </Button>
        }
      />

      <Card className="p-4 mb-4">
        <RangeControls from={from} to={to} onFrom={setFrom} onTo={setTo} onRun={load} />
      </Card>

      <Card className="p-0 overflow-hidden max-w-3xl">
        {loading && (
          <div className="flex items-center justify-center py-16 text-navy/50 text-sm">Loading…</div>
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
                <Th>Account</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">% of Income</Th>
              </tr>
            </thead>
            <tbody>
              <Section
                title="Income"
                rows={data.income}
                total={data.totalIncome}
                totalPct={data.totalIncomePct}
                from={from}
                to={to}
              />
              <Section
                title="Expenses"
                rows={data.expenses}
                total={data.totalExpenses}
                totalPct={data.totalExpensesPct}
                from={from}
                to={to}
              />
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-navy/30 text-base font-extrabold text-navy">
                <td className="py-3 px-4">Net Income</td>
                <td
                  className={`py-3 px-4 text-right tabular-nums ${
                    Number(data.netIncome) >= 0 ? 'text-emerald' : 'text-red-600'
                  }`}
                >
                  {formatCurrency(data.netIncome)}
                </td>
                <td className="py-3 px-4 text-right tabular-nums">{pct(data.netIncomePct)}</td>
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>
    </main>
  );
}
