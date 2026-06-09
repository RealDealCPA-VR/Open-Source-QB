'use client';

/**
 * Transaction Detail — filterable cross-account journal-line report with
 * running totals (QB "Transaction Detail by Account / Transaction List by
 * Date" parity). Filters: date range, account, free-text search; drill-down
 * to the account register (range-scoped) and to the source document.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ListChecks } from 'lucide-react';
import { Button, Card, Input, Label, PageHeader, Select, Table, Th, Td, Tr, toast } from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';
import { sourceRefLink } from '@/components/EntryDetailModal';
import ReportToolbar, { type ExportTable } from '../_components/ReportToolbar';
import { fmtDate, todayStr, yearStartStr, type CsvCell } from '../_components/shared';

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

interface TransactionDetailRow {
  lineId: string;
  entryId: string;
  entryNumber: number;
  date: string;
  description: string;
  memo: string | null;
  reference: string | null;
  sourceRef: string | null;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  amount: string;
  runningTotal: string;
}

interface TransactionDetailData {
  from?: string;
  to?: string;
  rows: TransactionDetailRow[];
  totalDebit: string;
  totalCredit: string;
  count: number;
  truncated: boolean;
}

export default function TransactionDetailPage() {
  const [from, setFrom] = useState(yearStartStr());
  const [to, setTo] = useState(todayStr());
  const [accountId, setAccountId] = useState('');
  const [search, setSearch] = useState('');
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [data, setData] = useState<TransactionDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<AccountOption[]>('/api/accounts')
      .then((rows) => setAccounts(rows))
      .catch(() => {
        /* account filter is optional — report still works without it */
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      if (accountId) params.set('accountId', accountId);
      if (search.trim()) params.set('search', search.trim());
      setData(await api.get<TransactionDetailData>(`/api/reports/transaction-detail?${params.toString()}`));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load transaction detail.';
      setError(msg);
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, [from, to, accountId, search]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const table: ExportTable | null = data
    ? {
        filename: 'transaction-detail',
        title: 'Transaction Detail',
        subtitle: `${fmtDate(data.from)} to ${fmtDate(data.to)}`,
        landscape: true,
        columns: [
          { header: 'Date' },
          { header: 'Entry #', numeric: true },
          { header: 'Description' },
          { header: 'Memo' },
          { header: 'Account' },
          { header: 'Debit', numeric: true },
          { header: 'Credit', numeric: true },
          { header: 'Amount', numeric: true },
          { header: 'Running Total', numeric: true },
        ],
        rows: data.rows.map((r): CsvCell[] => [
          fmtDate(r.date),
          r.entryNumber,
          r.description,
          r.memo ?? '',
          `${r.accountCode} ${r.accountName}`,
          r.debit,
          r.credit,
          r.amount,
          r.runningTotal,
        ]),
        totals: [['TOTAL', '', '', '', '', data.totalDebit, data.totalCredit, '', '']],
      }
    : null;

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader title="Transaction Detail" icon={ListChecks} />

      <ReportToolbar table={table} disabled={loading} />

      <Card className="p-4 mb-4 print-hidden">
        <form
          className="flex items-end gap-3 flex-wrap"
          onSubmit={(e) => {
            e.preventDefault();
            load();
          }}
        >
          <div>
            <Label htmlFor="td-from">From</Label>
            <Input id="td-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="td-to">To</Label>
            <Input id="td-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="td-account">Account</Label>
            <Select id="td-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="td-search">Name / memo contains</Label>
            <Input
              id="td-search"
              type="text"
              placeholder="Name, memo, source…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary" size="sm" className="mb-0.5">
            Run Report
          </Button>
        </form>
      </Card>

      {data?.truncated && (
        <p className="text-sm text-gold mb-3">
          Showing the first {data.count} lines — narrow the filters to see everything.
        </p>
      )}

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
                <Th>Entry #</Th>
                <Th>Description</Th>
                <Th>Account</Th>
                <Th>Source</Th>
                <Th className="text-right">Debit</Th>
                <Th className="text-right">Credit</Th>
                <Th className="text-right">Running Total</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <Td colSpan={8} className="py-12 text-center text-navy/40">
                    No transactions match these filters.
                  </Td>
                </tr>
              ) : (
                data.rows.map((r) => {
                  const src = sourceRefLink(r.sourceRef);
                  return (
                    <Tr key={r.lineId}>
                      <Td className="whitespace-nowrap">{fmtDate(r.date)}</Td>
                      <Td className="tabular-nums">{r.entryNumber}</Td>
                      <Td>
                        <span className="text-navy">{r.description}</span>
                        {r.memo && <span className="block text-xs text-navy/50">{r.memo}</span>}
                      </Td>
                      <Td>
                        <Link
                          href={`/registers/${r.accountId}?from=${from}&to=${to}`}
                          className="text-electric hover:underline"
                          title={`Open ${r.accountName} register`}
                        >
                          {r.accountCode} {r.accountName}
                        </Link>
                      </Td>
                      <Td>
                        {src ? (
                          <Link href={src.href} className="text-electric hover:underline">
                            {src.label}
                          </Link>
                        ) : (
                          <span className="text-navy/40">Journal</span>
                        )}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {Number(r.debit) !== 0 ? formatCurrency(r.debit) : ''}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {Number(r.credit) !== 0 ? formatCurrency(r.credit) : ''}
                      </Td>
                      <Td className="text-right tabular-nums text-navy/70">{formatCurrency(r.runningTotal)}</Td>
                    </Tr>
                  );
                })
              )}
            </tbody>
            {data.rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-navy/20 bg-navy/5 font-bold text-navy">
                  <td className="py-3 px-4" colSpan={5}>
                    Total ({data.count} lines)
                  </td>
                  <td className="py-3 px-4 text-right tabular-nums">{formatCurrency(data.totalDebit)}</td>
                  <td className="py-3 px-4 text-right tabular-nums">{formatCurrency(data.totalCredit)}</td>
                  <td className="py-3 px-4" />
                </tr>
              </tfoot>
            )}
          </Table>
        )}
      </Card>
    </main>
  );
}
