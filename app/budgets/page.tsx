'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart2, Plus } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  Input,
  Label,
  Modal,
  PageHeader,
  Spinner,
  Table,
  Td,
  Th,
  Tr,
  toast,
} from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Budget {
  id: string;
  name: string;
  fiscalYear: number;
  createdAt: string;
}

interface BudgetLine {
  id: string;
  budgetId: string;
  accountId: string;
  month: number;
  amount: string;
}

interface BudgetWithLines extends Budget {
  lines: BudgetLine[];
}

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
}

interface VsActualRow {
  accountId: string;
  code: string;
  name: string;
  budget: string;
  actual: string;
  variance: string;
}

interface VsActualReport {
  budgetId: string;
  budgetName: string;
  fiscalYear: number;
  rows: VsActualRow[];
  totalBudget: string;
  totalActual: string;
  totalVariance: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function getLineAmount(lines: BudgetLine[], accountId: string, month: number): string {
  const line = lines.find((l) => l.accountId === accountId && l.month === month);
  return line?.amount ?? '';
}

function varianceColor(variance: string): string {
  const n = Number(variance);
  if (n > 0) return 'text-emerald';
  if (n < 0) return 'text-red-500';
  return 'text-navy/60';
}

// ---------------------------------------------------------------------------
// New Budget modal form
// ---------------------------------------------------------------------------

function NewBudgetModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (b: Budget) => void;
}) {
  const [name, setName] = useState('');
  const [fiscalYear, setFiscalYear] = useState(String(new Date().getFullYear()));
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) { toast('Budget name is required', 'danger'); return; }
    const yr = Number(fiscalYear);
    if (!yr || yr < 2000 || yr > 2100) { toast('Enter a valid 4-digit fiscal year', 'danger'); return; }
    setSaving(true);
    try {
      const budget = await api.post<Budget>('/api/budgets', { name: name.trim(), fiscalYear: yr });
      toast('Budget created', 'success');
      onCreated(budget);
      setName('');
      setFiscalYear(String(new Date().getFullYear()));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to create budget', 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Budget"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button loading={saving} onClick={handleCreate}>Create Budget</Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          handleCreate();
        }}
      >
        <div>
          <Label htmlFor="budgetName">Budget Name *</Label>
          <Input
            id="budgetName"
            autoFocus
            placeholder="e.g. FY2025 Annual Budget"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="fiscalYear">Fiscal Year *</Label>
          <Input
            id="fiscalYear"
            type="number"
            min={2000}
            max={2100}
            placeholder="e.g. 2025"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(e.target.value)}
          />
        </div>
        {/* Hidden submit so Enter submits the two-field form in all browsers */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Monthly Budget Grid
// ---------------------------------------------------------------------------

function BudgetGrid({
  budget,
  accounts,
  onLineChange,
}: {
  budget: BudgetWithLines;
  accounts: Account[];
  onLineChange: (accountId: string, month: number, amount: string) => void;
}) {
  // Only show income and expense accounts.
  const relevantAccounts = accounts.filter(
    (a) => (a.type === 'revenue' || a.type === 'expense') && a.isActive,
  );

  return (
    <div className="overflow-x-auto">
      {/* Keyed by budget so switching budgets remounts the uncontrolled inputs. */}
      <table key={budget.id} className="w-full border-collapse text-sm min-w-[900px]">
        <thead>
          <tr>
            <th className="py-2.5 px-3 text-left font-semibold text-navy/70 border-b-2 border-navy/10 sticky left-0 bg-white z-10 min-w-[180px]">
              Account
            </th>
            {MONTHS.map((m) => (
              <th
                key={m}
                className="py-2.5 px-2 text-right font-semibold text-navy/70 border-b-2 border-navy/10 min-w-[90px]"
              >
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {relevantAccounts.length === 0 ? (
            <tr>
              <td colSpan={13} className="py-8 text-center text-navy/40">
                No income or expense accounts found. Add accounts first.
              </td>
            </tr>
          ) : (
            relevantAccounts.map((acct) => (
              <tr key={acct.id} className="border-b border-slate-100 hover:bg-electric/5">
                <td className="py-1.5 px-3 sticky left-0 bg-white z-10">
                  <span className="text-navy/50 text-xs mr-1">{acct.code}</span>
                  <span className="text-navy font-medium">{acct.name}</span>
                </td>
                {MONTHS.map((_, idx) => {
                  const month = idx + 1;
                  const current = getLineAmount(budget.lines, acct.id, month);
                  return (
                    <td key={month} className="py-1 px-1">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="—"
                        aria-label={`${acct.name} ${MONTHS[idx]}`}
                        defaultValue={current || ''}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          if (val !== current) {
                            onLineChange(acct.id, month, val || '0');
                          }
                        }}
                        className="w-full rounded border border-slate-200 px-2 py-1 text-right text-sm text-navy outline-none focus:border-electric focus:ring-1 focus:ring-electric/30 placeholder:text-navy/20"
                      />
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Budget vs Actual view
// ---------------------------------------------------------------------------

function BudgetVsActualView({ report }: { report: VsActualReport }) {
  return (
    <div>
      <h3 className="text-lg font-bold text-navy mb-3">
        Budget vs Actual — FY{report.fiscalYear}
      </h3>
      <Table>
        <thead>
          <tr>
            <Th>Account</Th>
            <Th className="text-right">Budget</Th>
            <Th className="text-right">Actual</Th>
            <Th className="text-right">Variance</Th>
          </tr>
        </thead>
        <tbody>
          {report.rows.length === 0 ? (
            <tr>
              <Td colSpan={4} className="py-10 text-center text-navy/40">
                No budget lines have been set yet.
              </Td>
            </tr>
          ) : (
            report.rows.map((row) => (
              <Tr key={row.accountId}>
                <Td>
                  <span className="text-navy/50 text-xs mr-1">{row.code}</span>
                  <span className="font-medium text-navy">{row.name}</span>
                </Td>
                <Td className="text-right tabular-nums">{formatCurrency(row.budget)}</Td>
                <Td className="text-right tabular-nums">{formatCurrency(row.actual)}</Td>
                <Td className={`text-right tabular-nums font-semibold ${varianceColor(row.variance)}`}>
                  {Number(row.variance) > 0 ? '+' : ''}
                  {formatCurrency(row.variance)}
                </Td>
              </Tr>
            ))
          )}
        </tbody>
        {report.rows.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-navy/20 bg-navy/5 font-bold text-navy">
              <td className="py-3 px-4">Total</td>
              <td className="py-3 px-4 text-right tabular-nums">
                {formatCurrency(report.totalBudget)}
              </td>
              <td className="py-3 px-4 text-right tabular-nums">
                {formatCurrency(report.totalActual)}
              </td>
              <td className={`py-3 px-4 text-right tabular-nums ${varianceColor(report.totalVariance)}`}>
                {Number(report.totalVariance) > 0 ? '+' : ''}
                {formatCurrency(report.totalVariance)}
              </td>
            </tr>
          </tfoot>
        )}
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BudgetsPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetsLoading, setBudgetsLoading] = useState(true);

  const [newBudgetOpen, setNewBudgetOpen] = useState(false);

  // Currently selected budget detail.
  const [selected, setSelected] = useState<BudgetWithLines | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);

  // Accounts for the grid.
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);

  // Vs-actual report.
  const [vsActual, setVsActual] = useState<VsActualReport | null>(null);
  const [vsActualLoading, setVsActualLoading] = useState(false);

  // Active tab on the right panel.
  const [tab, setTab] = useState<'grid' | 'vs-actual'>('grid');

  // ---------------------------------------------------------------------------
  // Load budget list
  // ---------------------------------------------------------------------------

  const loadBudgets = useCallback(async () => {
    setBudgetsLoading(true);
    try {
      const list = await api.get<Budget[]>('/api/budgets');
      setBudgets(list);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load budgets', 'danger');
    } finally {
      setBudgetsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBudgets();
  }, [loadBudgets]);

  // ---------------------------------------------------------------------------
  // Load accounts (once)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (accountsLoaded) return;
    api
      .get<Account[]>('/api/accounts')
      .then((list) => {
        setAccounts(list);
        setAccountsLoaded(true);
      })
      .catch((err) => {
        toast(err instanceof ApiError ? err.message : 'Failed to load accounts', 'danger');
      });
  }, [accountsLoaded]);

  // ---------------------------------------------------------------------------
  // Select a budget
  // ---------------------------------------------------------------------------

  async function selectBudget(budget: Budget) {
    setSelectedLoading(true);
    setVsActual(null);
    setTab('grid');
    try {
      const full = await api.get<BudgetWithLines>(`/api/budgets/${budget.id}`);
      setSelected(full);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load budget', 'danger');
    } finally {
      setSelectedLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Set a budget line (called on blur)
  // ---------------------------------------------------------------------------

  async function handleLineChange(accountId: string, month: number, amount: string) {
    if (!selected) return;
    const numAmount = Number(amount);
    if (isNaN(numAmount)) return;
    try {
      await api.patch(`/api/budgets/${selected.id}`, { accountId, month, amount });
      // Refresh budget lines silently.
      const full = await api.get<BudgetWithLines>(`/api/budgets/${selected.id}`);
      setSelected(full);
      // Clear cached vs-actual so it reloads on next tab switch.
      setVsActual(null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to save budget line', 'danger');
    }
  }

  // ---------------------------------------------------------------------------
  // Load vs-actual
  // ---------------------------------------------------------------------------

  async function loadVsActual() {
    if (!selected) return;
    setVsActualLoading(true);
    try {
      const report = await api.get<VsActualReport>(`/api/budgets/${selected.id}/vs-actual`);
      setVsActual(report);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load vs-actual report', 'danger');
    } finally {
      setVsActualLoading(false);
    }
  }

  function switchTab(t: 'grid' | 'vs-actual') {
    setTab(t);
    if (t === 'vs-actual' && !vsActual) {
      loadVsActual();
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Budgets"
        icon={BarChart2}
        action={
          <Button onClick={() => setNewBudgetOpen(true)}>
            <Plus className="h-4 w-4" />
            New Budget
          </Button>
        }
      />

      <div className="flex gap-6 items-start">
        {/* ---- Left: Budget list ---- */}
        <div className="w-64 shrink-0">
          <Card className="p-0 overflow-hidden">
            {budgetsLoading ? (
              <div className="flex items-center justify-center gap-2 p-6 text-navy/40 text-sm">
                <Spinner className="text-electric" />
                Loading...
              </div>
            ) : budgets.length === 0 ? (
              <EmptyState
                icon={BarChart2}
                title="No budgets yet"
                message="Create your first budget to get started."
                action={<Button onClick={() => setNewBudgetOpen(true)}>New Budget</Button>}
              />
            ) : (
              <ul>
                {budgets.map((b) => (
                  <li key={b.id}>
                    <button
                      onClick={() => selectBudget(b)}
                      className={`w-full text-left px-4 py-3 border-b border-slate-100 transition-colors ${
                        selected?.id === b.id
                          ? 'bg-electric/10 text-electric font-semibold'
                          : 'hover:bg-electric/5 text-navy'
                      }`}
                    >
                      <div className="font-medium text-sm truncate">{b.name}</div>
                      <div className="text-xs text-navy/50 mt-0.5">FY{b.fiscalYear}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* ---- Right: Detail panel ---- */}
        <div className="flex-1 min-w-0">
          {!selected && !selectedLoading && (
            <Card className="p-12 text-center">
              <BarChart2 className="mx-auto h-10 w-10 text-navy/20 mb-3" />
              <p className="text-navy/50 text-sm">
                Select a budget from the list to view and edit monthly amounts.
              </p>
            </Card>
          )}

          {selectedLoading && (
            <Card className="p-12">
              <div className="flex items-center justify-center gap-2 text-navy/40 text-sm">
                <Spinner className="text-electric" />
                Loading budget...
              </div>
            </Card>
          )}

          {selected && !selectedLoading && (
            <Card className="p-0 overflow-hidden">
              {/* Tab bar */}
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <div>
                  <span className="font-bold text-navy text-lg">{selected.name}</span>
                  <span className="ml-2 text-sm text-navy/50">FY{selected.fiscalYear}</span>
                </div>
                <div className="flex gap-1">
                  {(['grid', 'vs-actual'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => switchTab(t)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                        tab === t
                          ? 'bg-electric text-white'
                          : 'text-navy/60 hover:bg-navy/5'
                      }`}
                    >
                      {t === 'grid' ? 'Monthly Budget' : 'Budget vs Actual'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4">
                {tab === 'grid' && (
                  <BudgetGrid
                    budget={selected}
                    accounts={accounts}
                    onLineChange={handleLineChange}
                  />
                )}

                {tab === 'vs-actual' && (
                  <>
                    {vsActualLoading && (
                      <div className="flex items-center justify-center gap-2 py-12 text-navy/40 text-sm">
                        <Spinner className="text-electric" />
                        Loading report...
                      </div>
                    )}
                    {!vsActualLoading && vsActual && (
                      <BudgetVsActualView report={vsActual} />
                    )}
                    {!vsActualLoading && !vsActual && (
                      <div className="py-12 text-center">
                        <Button variant="secondary" size="sm" onClick={loadVsActual}>
                          Load Report
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* New Budget modal */}
      <NewBudgetModal
        open={newBudgetOpen}
        onClose={() => setNewBudgetOpen(false)}
        onCreated={(b) => {
          setBudgets((prev) => [...prev, b]);
          setNewBudgetOpen(false);
          selectBudget(b);
        }}
      />
    </main>
  );
}
