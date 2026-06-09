'use client';

/**
 * Deposit Detail — every bank deposit in the period with its line items
 * (deposited customer payments and other receipts) indented underneath.
 */
import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Landmark } from 'lucide-react';
import { Button, Card, PageHeader, Table, Th, Td, Tr, toast } from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';
import { RangeControls, downloadCsv, fmtDate, todayStr, yearStartStr, type CsvCell } from '../_components/shared';

interface DepositDetailLine {
  description: string | null;
  customerName: string | null;
  amount: string;
}

interface DepositDetailRow {
  id: string;
  date: string;
  accountId: string;
  accountName: string;
  memo: string | null;
  total: string;
  voided: boolean;
  lines: DepositDetailLine[];
}

interface DepositDetailData {
  from?: string;
  to?: string;
  rows: DepositDetailRow[];
  total: string;
}

export default function DepositDetailPage() {
  const [from, setFrom] = useState(yearStartStr());
  const [to, setTo] = useState(todayStr());
  const [data, setData] = useState<DepositDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<DepositDetailData>(`/api/reports/deposit-detail?from=${from}&to=${to}`));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load deposit detail.';
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
    const rows: CsvCell[][] = [];
    for (const r of data.rows) {
      rows.push([fmtDate(r.date), r.accountName, r.memo ?? '', r.voided ? 'VOID' : '', r.total]);
      for (const l of r.lines) {
        rows.push(['', `  ${l.customerName ?? l.description ?? 'Deposit line'}`, l.description ?? '', '', l.amount]);
      }
    }
    rows.push(['TOTAL (non-void)', '', '', '', data.total]);
    downloadCsv(
      'deposit-detail.csv',
      `Deposit Detail — ${fmtDate(data.from)} to ${fmtDate(data.to)}`,
      ['Date', 'Account / Received From', 'Memo', 'Void', 'Amount'],
      rows,
    );
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Deposit Detail"
        icon={Landmark}
        action={
          <Button variant="secondary" size="sm" disabled={!data || loading} onClick={exportCsv}>
            Download CSV
          </Button>
        }
      />

      <Card className="p-4 mb-4">
        <RangeControls from={from} to={to} onFrom={setFrom} onTo={setTo} onRun={load} />
      </Card>

      <Card className="p-0 overflow-hidden">
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
                <Th>Date</Th>
                <Th>Deposit Account</Th>
                <Th>Memo</Th>
                <Th className="text-right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <Td colSpan={4} className="py-12 text-center text-navy/40">
                    No deposits in this period.
                  </Td>
                </tr>
              ) : (
                data.rows.map((r) => (
                  <Fragment key={r.id}>
                    <Tr className={r.voided ? 'opacity-50' : ''}>
                      <Td>{fmtDate(r.date)}</Td>
                      <Td className="font-medium">
                        <Link
                          href={`/registers/${r.accountId}?from=${from}&to=${to}`}
                          className="text-electric hover:underline"
                        >
                          {r.accountName}
                        </Link>
                        {r.voided && <span className="ml-2 text-xs font-bold text-red-600">VOID</span>}
                      </Td>
                      <Td>{r.memo ?? '—'}</Td>
                      <Td className="text-right tabular-nums font-semibold">{formatCurrency(r.total)}</Td>
                    </Tr>
                    {r.lines.map((l, i) => (
                      <Tr key={`${r.id}-line-${i}`} className="text-sm text-navy/60 hover:bg-transparent">
                        <Td className="py-1.5" />
                        <Td className="py-1.5 pl-8" colSpan={2}>
                          {l.customerName ?? 'Other receipt'}
                          {l.description ? ` — ${l.description}` : ''}
                        </Td>
                        <Td className="py-1.5 text-right tabular-nums">{formatCurrency(l.amount)}</Td>
                      </Tr>
                    ))}
                  </Fragment>
                ))
              )}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-navy/20 bg-navy/5 font-bold text-navy">
                  <td className="py-3 px-4" colSpan={3}>
                    Total (excluding voided deposits)
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">{formatCurrency(data.total)}</td>
                </tr>
              </tfoot>
            )}
          </Table>
        )}
      </Card>
    </main>
  );
}
