'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckSquare } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
  Toaster,
  Tr,
  toast,
} from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency, Money } from '@/lib/money';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BankAccount {
  id: string;
  bankName: string;
  accountNumber: string;
  glAccountName: string;
  glAccountCode: string;
  lastReconciledDate: string | null;
  lastReconciledBalance: string | null;
}

interface Reconciliation {
  id: string;
  bankAccountId: string;
  statementDate: string;
  statementBalance: string;
  reconciledBalance: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
  bankName: string;
  accountNumber: string;
}

interface ClearableLine {
  journalEntryLineId: string;
  journalEntryId: string;
  date: string;
  description: string;
  debit: string | null;
  credit: string | null;
  memo: string | null;
  isCleared: boolean;
}

interface Progress {
  reconciliationId: string;
  statementBalance: string;
  clearedBalance: string;
  difference: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(v: string | null | undefined) {
  if (v == null) return '—';
  return formatCurrency(v);
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

function statusTone(status: string): 'info' | 'success' | 'neutral' {
  if (status === 'in_progress') return 'info';
  if (status === 'completed') return 'success';
  return 'neutral';
}

function lineAmount(line: ClearableLine): string {
  // For display: show debit as positive inflow, credit as outflow (negative).
  if (line.debit) return line.debit;
  if (line.credit) return `-${line.credit}`;
  return '0.00';
}

function differenceClose(difference: string): boolean {
  // "complete" button is enabled when |difference| <= 0.01
  return Money.abs(difference).lessThanOrEqualTo('0.01');
}

// ---------------------------------------------------------------------------
// Start Reconciliation form
// ---------------------------------------------------------------------------

function StartForm({
  bankAccounts,
  onStarted,
}: {
  bankAccounts: BankAccount[];
  onStarted: (recon: Reconciliation) => void;
}) {
  const [bankAccountId, setBankAccountId] = useState('');
  const [statementDate, setStatementDate] = useState('');
  const [statementBalance, setStatementBalance] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleStart() {
    if (!bankAccountId || !statementDate || !statementBalance) {
      toast('All fields are required.', 'danger');
      return;
    }
    setSaving(true);
    try {
      const recon = await api.post<Reconciliation>('/api/reconciliations', {
        bankAccountId,
        statementDate: new Date(statementDate).toISOString(),
        statementBalance,
      });
      toast('Reconciliation started.', 'success');
      onStarted(recon);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to start reconciliation.', 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6 max-w-lg">
      <h2 className="text-lg font-bold text-navy mb-4">Start New Reconciliation</h2>
      <div className="space-y-4">
        <div>
          <Label>Bank Account</Label>
          <Select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}>
            <option value="">Select bank account…</option>
            {bankAccounts.map((ba) => (
              <option key={ba.id} value={ba.id}>
                {ba.bankName} – {ba.glAccountCode} {ba.glAccountName}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Statement Date</Label>
          <Input
            type="date"
            value={statementDate}
            onChange={(e) => setStatementDate(e.target.value)}
          />
        </div>
        <div>
          <Label>Statement Ending Balance</Label>
          <Input
            type="number"
            step="0.01"
            placeholder="0.00"
            value={statementBalance}
            onChange={(e) => setStatementBalance(e.target.value)}
          />
        </div>
        <Button onClick={handleStart} disabled={saving}>
          {saving ? 'Starting…' : 'Start Reconciliation'}
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Reconcile session (clearable lines + progress)
// ---------------------------------------------------------------------------

function ReconcileSession({
  recon,
  onComplete,
}: {
  recon: Reconciliation;
  onComplete: () => void;
}) {
  const [lines, setLines] = useState<ClearableLine[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loadingLines, setLoadingLines] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const loadLines = useCallback(async () => {
    setLoadingLines(true);
    try {
      const [fetchedLines, fetchedProgress] = await Promise.all([
        api.get<ClearableLine[]>(`/api/reconciliations/${recon.id}/clearable`),
        api.get<Progress>(`/api/reconciliations/${recon.id}`),
      ]);
      setLines(fetchedLines);
      setProgress(fetchedProgress);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load reconciliation data.', 'danger');
    } finally {
      setLoadingLines(false);
    }
  }, [recon.id]);

  useEffect(() => {
    loadLines();
  }, [loadLines]);

  async function handleToggle(line: ClearableLine) {
    setToggling(line.journalEntryLineId);
    try {
      const updatedProgress = await api.patch<Progress>(`/api/reconciliations/${recon.id}`, {
        action: 'toggleCleared',
        journalEntryLineId: line.journalEntryLineId,
        isCleared: !line.isCleared,
      });
      // Update isCleared on the line locally to avoid a full refetch.
      setLines((prev) =>
        prev.map((l) =>
          l.journalEntryLineId === line.journalEntryLineId
            ? { ...l, isCleared: !l.isCleared }
            : l,
        ),
      );
      setProgress(updatedProgress);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to toggle line.', 'danger');
    } finally {
      setToggling(null);
    }
  }

  async function handleComplete() {
    setCompleting(true);
    try {
      await api.patch(`/api/reconciliations/${recon.id}`, { action: 'complete' });
      toast('Reconciliation completed successfully.', 'success');
      onComplete();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to complete reconciliation.', 'danger');
    } finally {
      setCompleting(false);
    }
  }

  const canComplete =
    recon.status === 'in_progress' &&
    progress != null &&
    differenceClose(progress.difference);

  return (
    <div className="space-y-6">
      {/* Progress summary */}
      <Card className="p-6">
        <h2 className="text-lg font-bold text-navy mb-4">
          Reconciliation — {recon.bankName} (statement date: {fmtDate(recon.statementDate)})
        </h2>
        {progress ? (
          <div className="grid grid-cols-3 gap-6 text-center">
            <div>
              <p className="text-xs text-navy/60 uppercase tracking-wide mb-1">Statement Balance</p>
              <p className="text-2xl font-bold text-navy">{fmt(progress.statementBalance)}</p>
            </div>
            <div>
              <p className="text-xs text-navy/60 uppercase tracking-wide mb-1">Cleared Balance</p>
              <p className="text-2xl font-bold text-navy">{fmt(progress.clearedBalance)}</p>
            </div>
            <div>
              <p className="text-xs text-navy/60 uppercase tracking-wide mb-1">Difference</p>
              <p
                className={`text-2xl font-bold ${differenceClose(progress.difference) ? 'text-emerald-600' : 'text-red-500'}`}
              >
                {fmt(progress.difference)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-navy/50 text-sm">Loading progress…</p>
        )}
        <div className="mt-4 flex justify-end">
          <Button onClick={handleComplete} disabled={!canComplete || completing}>
            {completing ? 'Finishing…' : 'Finish Reconciliation'}
          </Button>
        </div>
      </Card>

      {/* Clearable lines */}
      <Card className="p-6">
        <h3 className="text-base font-bold text-navy mb-4">
          Transactions to Clear
          {!loadingLines && (
            <span className="ml-2 text-sm font-normal text-navy/50">
              ({lines.filter((l) => l.isCleared).length} of {lines.length} cleared)
            </span>
          )}
        </h3>
        {loadingLines ? (
          <p className="text-navy/50 text-sm py-6 text-center">Loading…</p>
        ) : lines.length === 0 ? (
          <p className="text-navy/50 text-sm py-6 text-center">
            No clearable transactions found for this period.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-10">Clear</Th>
                <Th>Date</Th>
                <Th>Description</Th>
                <Th>Memo</Th>
                <Th className="text-right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <Tr
                  key={line.journalEntryLineId}
                  className={line.isCleared ? 'bg-emerald-50' : ''}
                >
                  <Td>
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300 text-electric focus:ring-electric/30 cursor-pointer"
                      checked={line.isCleared}
                      disabled={toggling === line.journalEntryLineId || recon.status !== 'in_progress'}
                      onChange={() => handleToggle(line)}
                    />
                  </Td>
                  <Td>{fmtDate(line.date)}</Td>
                  <Td className="max-w-xs truncate">{line.description}</Td>
                  <Td className="text-navy/60">{line.memo ?? '—'}</Td>
                  <Td className="text-right font-mono">
                    <span
                      className={
                        line.debit
                          ? 'text-navy'
                          : line.credit
                            ? 'text-red-500'
                            : 'text-navy/40'
                      }
                    >
                      {fmt(lineAmount(line))}
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Past reconciliations list
// ---------------------------------------------------------------------------

function PastReconciliations({
  reconciliations,
  onResume,
}: {
  reconciliations: Reconciliation[];
  onResume: (recon: Reconciliation) => void;
}) {
  if (reconciliations.length === 0) return null;

  return (
    <Card className="p-6">
      <h2 className="text-lg font-bold text-navy mb-4">Reconciliation History</h2>
      <Table>
        <thead>
          <tr>
            <Th>Bank Account</Th>
            <Th>Statement Date</Th>
            <Th className="text-right">Statement Balance</Th>
            <Th className="text-right">Reconciled Balance</Th>
            <Th>Status</Th>
            <Th>Completed</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {reconciliations.map((r) => (
            <Tr key={r.id}>
              <Td>
                {r.bankName}
                <span className="ml-1 text-navy/40 text-xs">…{r.accountNumber.slice(-4)}</span>
              </Td>
              <Td>{fmtDate(r.statementDate)}</Td>
              <Td className="text-right font-mono">{fmt(r.statementBalance)}</Td>
              <Td className="text-right font-mono">{fmt(r.reconciledBalance)}</Td>
              <Td>
                <Badge tone={statusTone(r.status)}>
                  {r.status === 'in_progress' ? 'In Progress' : 'Completed'}
                </Badge>
              </Td>
              <Td>{fmtDate(r.completedAt)}</Td>
              <Td>
                {r.status === 'in_progress' && (
                  <Button size="sm" variant="secondary" onClick={() => onResume(r)}>
                    Resume
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ReconcilePage() {
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [activeRecon, setActiveRecon] = useState<Reconciliation | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [bas, recons] = await Promise.all([
        api.get<BankAccount[]>('/api/bank-accounts'),
        api.get<Reconciliation[]>('/api/reconciliations'),
      ]);
      setBankAccounts(bas);
      setReconciliations(recons);
      // Auto-resume if there is exactly one in-progress reconciliation.
      const inProgress = recons.find((r) => r.status === 'in_progress');
      if (inProgress && !activeRecon) {
        setActiveRecon(inProgress);
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load data.', 'danger');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadData();
  }, [loadData]);

  function handleStarted(recon: Reconciliation) {
    setReconciliations((prev) => [recon, ...prev]);
    setActiveRecon(recon);
  }

  function handleComplete() {
    setActiveRecon(null);
    loadData();
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <Toaster />
      <PageHeader title="Bank Reconciliation" icon={CheckSquare} />

      {loading ? (
        <p className="text-navy/50">Loading…</p>
      ) : activeRecon ? (
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveRecon(null)}
            className="mb-2"
          >
            Back to reconciliation list
          </Button>
          <ReconcileSession recon={activeRecon} onComplete={handleComplete} />
        </div>
      ) : (
        <div className="space-y-8">
          <StartForm bankAccounts={bankAccounts} onStarted={handleStarted} />
          <PastReconciliations
            reconciliations={reconciliations}
            onResume={(r) => setActiveRecon(r)}
          />
        </div>
      )}
    </main>
  );
}
