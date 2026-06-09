'use client';
/**
 * General Ledger report page.
 * - Populates an account Select from GET /api/accounts.
 * - On account selection, loads GET /api/reports/general-ledger?accountId=&from=&to=
 *   and renders a chronological table: date / entry# / description / debit / credit / running balance.
 * - "Download CSV" exports the visible table as a Blob download.
 */
import { useState, useEffect, useCallback } from 'react';
import { List } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Label,
  PageHeader,
  Select,
  Table,
  Th,
  Td,
  Tr,
  toast,
} from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';
import EntryDetailModal from '@/components/EntryDetailModal';
import ReportToolbar, { type ExportTable } from '../_components/ReportToolbar';
import { fmtDate } from '../_components/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface GLRow {
  date: string; // ISO string from server
  entryNumber: number;
  description: string;
  reference: string | null;
  journalEntryId: string;
  lineId: string;
  debit: string | null;
  credit: string | null;
  runningBalance: string;
}

interface GLResult {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  isActive: boolean;
  /** Balance brought forward from before the 'from' date ('0.00' when unfiltered). */
  openingBalance: string;
  lines: GLRow[];
  closingBalance: string;
}

interface GLResponse {
  ledger: GLResult[];
}

// ---------------------------------------------------------------------------
// Export table (shared ReportToolbar: CSV / Excel / PDF / Print)
// ---------------------------------------------------------------------------

function buildTable(result: GLResult, hasFromFilter: boolean): ExportTable {
  const acctLabel = `${result.accountCode}-${result.accountName}`.replace(/\s+/g, '_');
  return {
    filename: `GL_${acctLabel}`,
    title: 'General Ledger',
    subtitle: `${result.accountCode} ${result.accountName}`,
    columns: [
      { header: 'Date' },
      { header: 'Entry #', numeric: true },
      { header: 'Description' },
      { header: 'Reference' },
      { header: 'Debit', numeric: true },
      { header: 'Credit', numeric: true },
      { header: 'Running Balance', numeric: true },
    ],
    rows: [
      ...(hasFromFilter
        ? [['', null, 'Beginning Balance', '', '', '', result.openingBalance] as (string | number | null)[]]
        : []),
      ...result.lines.map(
        (l) =>
          [
            fmtDate(l.date),
            l.entryNumber,
            l.description,
            l.reference ?? '',
            l.debit ?? '',
            l.credit ?? '',
            l.runningBalance,
          ] as (string | number | null)[],
      ),
    ],
    totals: [['', null, '', 'Closing Balance', '', '', result.closingBalance]],
  };
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function GeneralLedgerPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);

  const [accountId, setAccountId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [result, setResult] = useState<GLResult | null>(null);
  /** The 'from' filter the current result was loaded with (drives the Beginning Balance row). */
  const [resultFrom, setResultFrom] = useState('');
  const [loading, setLoading] = useState(false);
  /** QuickZoom: journal entry opened from a clicked GL row. */
  const [detailId, setDetailId] = useState<string | null>(null);

  // Load account list on mount
  useEffect(() => {
    api
      .get<Account[]>('/api/accounts')
      .then((rows) => {
        setAccounts(rows);
        // Pre-select first account
        if (rows.length > 0) setAccountId(rows[0].id);
      })
      .catch((err) => {
        toast(err instanceof ApiError ? err.message : 'Failed to load accounts.', 'danger');
      })
      .finally(() => setAccountsLoading(false));
  }, []);

  const loadGL = useCallback(async (acctId: string, fromDate: string, toDate: string) => {
    if (!acctId) return;
    setLoading(true);
    setResult(null);
    try {
      const params = new URLSearchParams({ accountId: acctId });
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const data = await api.get<GLResponse>(`/api/reports/general-ledger?${params}`);
      // Response is { ledger: GLResult[] }. We requested a single account so take first.
      setResult(data.ledger[0] ?? null);
      setResultFrom(fromDate);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load general ledger.', 'danger');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load when account changes
  useEffect(() => {
    if (accountId) loadGL(accountId, from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  function handleRun() {
    loadGL(accountId, from, to);
  }

  const selectedAccount = accounts.find((a) => a.id === accountId);

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader title="General Ledger" icon={List} />

      <ReportToolbar
        table={result ? buildTable(result, Boolean(resultFrom)) : null}
        disabled={loading}
      />

      {/* Filters */}
      <Card className="p-5 mb-6 flex flex-wrap items-end gap-4 print-hidden">
        {/* Account selector */}
        <div className="flex-[2] min-w-[220px]">
          <Label htmlFor="gl-account">Account</Label>
          <Select
            id="gl-account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={accountsLoading}
          >
            {accountsLoading && <option value="">Loading accounts…</option>}
            {!accountsLoading && accounts.length === 0 && (
              <option value="">No accounts found</option>
            )}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex-1 min-w-[160px]">
          <Label htmlFor="gl-from">From</Label>
          <Input
            id="gl-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>

        <div className="flex-1 min-w-[160px]">
          <Label htmlFor="gl-to">To</Label>
          <Input
            id="gl-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>

        <Button onClick={handleRun} disabled={loading || !accountId}>
          {loading ? 'Loading…' : 'Run Report'}
        </Button>
      </Card>

      {/* Account header */}
      {selectedAccount && (
        <div className="mb-3 text-navy/70 text-sm font-medium">
          {selectedAccount.code} — {selectedAccount.name}{' '}
          <span className="ml-2 px-2 py-0.5 rounded-full bg-electric/10 text-electric text-xs capitalize">
            {selectedAccount.type}
          </span>
        </div>
      )}

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        {loading && (
          <div className="py-16 text-center text-navy/40">Loading…</div>
        )}

        {!loading && !result && (
          <div className="py-16 text-center text-navy/40">
            Select an account and run the report.
          </div>
        )}

        {!loading && result && (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Entry #</Th>
                  <Th>Description</Th>
                  <Th>Ref</Th>
                  <Th className="text-right">Debit</Th>
                  <Th className="text-right">Credit</Th>
                  <Th className="text-right">Balance</Th>
                </tr>
              </thead>
              <tbody>
                {resultFrom && (
                  <Tr>
                    <Td className="whitespace-nowrap text-navy/60">
                      {new Date(`${resultFrom}T00:00:00`).toLocaleDateString('en-US')}
                    </Td>
                    <Td />
                    <Td className="italic text-navy/60">Beginning Balance</Td>
                    <Td />
                    <Td />
                    <Td />
                    <Td
                      className={`text-right tabular-nums font-semibold ${
                        Number(result.openingBalance) < 0 ? 'text-red-600' : 'text-navy'
                      }`}
                    >
                      {formatCurrency(result.openingBalance)}
                    </Td>
                  </Tr>
                )}
                {result.lines.length === 0 && (
                  <Tr>
                    <Td colSpan={7} className="py-10 text-center text-navy/40">
                      No posted transactions for this account in the selected period.
                    </Td>
                  </Tr>
                )}
                {result.lines.map((line) => {
                  const bal = Number(line.runningBalance);
                  return (
                    <Tr
                      key={line.lineId}
                      onClick={() => setDetailId(line.journalEntryId)}
                      className="cursor-pointer"
                      title="View journal entry (QuickZoom)"
                    >
                      <Td className="whitespace-nowrap">{fmtDate(line.date)}</Td>
                      <Td className="tabular-nums text-navy/60">#{line.entryNumber}</Td>
                      <Td>{line.description}</Td>
                      <Td className="text-navy/50 text-xs">{line.reference ?? ''}</Td>
                      <Td className="text-right tabular-nums">
                        {line.debit ? formatCurrency(line.debit) : ''}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {line.credit ? formatCurrency(line.credit) : ''}
                      </Td>
                      <Td
                        className={`text-right tabular-nums font-semibold ${
                          bal < 0 ? 'text-red-600' : 'text-navy'
                        }`}
                      >
                        {formatCurrency(line.runningBalance)}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-navy/30 bg-slate-50">
                  <td className="py-3 px-4 font-extrabold text-navy" colSpan={5}>
                    Closing Balance
                  </td>
                  <td
                    className={`py-3 px-4 text-right tabular-nums font-extrabold text-lg ${
                      Number(result.closingBalance) < 0 ? 'text-red-600' : 'text-emerald'
                    }`}
                    colSpan={2}
                  >
                    {formatCurrency(result.closingBalance)}
                  </td>
                </tr>
              </tfoot>
            </Table>
          </>
        )}
      </Card>

      <EntryDetailModal entryId={detailId} onClose={() => setDetailId(null)} />
    </main>
  );
}
