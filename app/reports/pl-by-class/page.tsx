'use client';

import { useEffect, useState, useCallback } from 'react';
import { BarChart3 } from 'lucide-react';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PLClassColumn {
  classId: string;
  className: string;
}

interface PLByClassRow {
  accountId: string;
  code: string;
  name: string;
  type: 'revenue' | 'expense';
  byClass: Record<string, string>;
}

interface PLByClassReport {
  classes: PLClassColumn[];
  rows: PLByClassRow[];
  totalsByClass: Record<string, string>;
  netByClass: Record<string, string>;
  from?: string;
  to?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);

}

function firstOfYearISO(): string {
  return `${new Date().getFullYear()}-01-01`;
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function PLByClassPage() {
  const [from, setFrom] = useState(firstOfYearISO());
  const [to, setTo] = useState(todayISO());
  const [report, setReport] = useState<PLByClassReport | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const data = await api.get<PLByClassReport>(`/api/reports/pl-by-class?${params}`);
      setReport(data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load report';
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const incomeRows = report?.rows.filter((r) => r.type === 'revenue') ?? [];
  const expenseRows = report?.rows.filter((r) => r.type === 'expense') ?? [];
  const classes = report?.classes ?? [];

  function amtCell(row: PLByClassRow, col: PLClassColumn) {
    const raw = row.byClass[col.classId] ?? '0.00';
    const n = parseFloat(raw);
    if (n === 0) return <Td key={col.classId} className="text-right tabular-nums text-navy/30">—</Td>;
    return (
      <Td key={col.classId} className="text-right tabular-nums">
        {formatCurrency(raw)}
      </Td>
    );
  }

  function totalCell(classId: string, map: Record<string, string>) {
    const raw = map[classId] ?? '0.00';
    const n = parseFloat(raw);
    return (
      <Td key={classId} className="text-right tabular-nums font-bold">
        {n === 0 ? '—' : formatCurrency(raw)}
      </Td>
    );
  }

  function netCell(classId: string) {
    const raw = report?.netByClass[classId] ?? '0.00';
    const n = parseFloat(raw);
    const positive = n >= 0;
    return (
      <Td
        key={classId}
        className={`text-right tabular-nums font-bold text-base ${
          positive ? 'text-emerald-600' : 'text-red-600'
        }`}
      >
        {n === 0 ? '—' : formatCurrency(raw)}
      </Td>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Profit & Loss by Class"
        icon={BarChart3}
        action={
          <Button onClick={fetchReport} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        }
      />

      {/* Date range filters */}
      <Card className="p-5 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <Label htmlFor="plc-from">From</Label>
            <Input
              id="plc-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-40"
            />
          </div>
          <div>
            <Label htmlFor="plc-to">To</Label>
            <Input
              id="plc-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-40"
            />
          </div>
          <Button onClick={fetchReport} disabled={loading}>
            {loading ? 'Loading…' : 'Run Report'}
          </Button>
        </div>
      </Card>

      {/* Matrix table */}
      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-navy/40 text-sm">Loading report…</div>
        ) : !report || report.rows.length === 0 ? (
          <div className="p-12 text-center">
            <BarChart3 className="h-10 w-10 text-navy/20 mx-auto mb-3" />
            <p className="text-navy/50 text-sm">No income or expense data in the selected period.</p>
            <p className="text-navy/35 text-xs mt-1">
              Create journal entries with class tags to see class-based reporting.
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-20">Code</Th>
                <Th>Account</Th>
                {classes.map((c) => (
                  <Th key={c.classId} className="text-right min-w-[120px]">
                    {c.className}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Revenue section */}
              {incomeRows.length > 0 && (
                <>
                  <tr>
                    <td
                      colSpan={2 + classes.length}
                      className="px-4 py-2 text-xs font-bold text-navy/50 uppercase tracking-wider bg-slate-50 border-b border-navy/10"
                    >
                      Income
                    </td>
                  </tr>
                  {incomeRows.map((row) => (
                    <Tr key={row.accountId}>
                      <Td className="font-mono text-xs text-navy/50">{row.code}</Td>
                      <Td>{row.name}</Td>
                      {classes.map((c) => amtCell(row, c))}
                    </Tr>
                  ))}
                  <tr className="bg-slate-50 border-t-2 border-navy/10">
                    <td className="px-4 py-2 font-bold text-navy text-sm" colSpan={2}>
                      Total Income
                    </td>
                    {classes.map((c) => totalCell(c.classId, report.totalsByClass))}
                  </tr>
                </>
              )}

              {/* Expense section */}
              {expenseRows.length > 0 && (
                <>
                  <tr>
                    <td
                      colSpan={2 + classes.length}
                      className="px-4 py-2 text-xs font-bold text-navy/50 uppercase tracking-wider bg-slate-50 border-b border-navy/10"
                    >
                      Expenses
                    </td>
                  </tr>
                  {expenseRows.map((row) => (
                    <Tr key={row.accountId}>
                      <Td className="font-mono text-xs text-navy/50">{row.code}</Td>
                      <Td>{row.name}</Td>
                      {classes.map((c) => amtCell(row, c))}
                    </Tr>
                  ))}
                  <tr className="bg-slate-50 border-t-2 border-navy/10">
                    <td className="px-4 py-2 font-bold text-navy text-sm" colSpan={2}>
                      Total Expenses
                    </td>
                    {classes.map((c) => totalCell(c.classId, report.totalsByClass))}
                  </tr>
                </>
              )}

              {/* Net income row */}
              <tr className="border-t-4 border-navy/20 bg-navy/5">
                <td className="px-4 py-3 font-extrabold text-navy text-base" colSpan={2}>
                  Net Income
                </td>
                {classes.map((c) => netCell(c.classId))}
              </tr>
            </tbody>
          </Table>
        )}
      </Card>
    </main>
  );
}
