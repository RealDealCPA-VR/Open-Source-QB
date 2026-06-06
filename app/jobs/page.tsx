'use client';

import { useEffect, useState } from 'react';
import { Briefcase, Plus, TrendingUp, DollarSign, X } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Label,
  Badge,
  Table,
  Th,
  Td,
  Tr,
  Modal,
  PageHeader,
  toast,
  Toaster,
} from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Job {
  id: string;
  name: string;
  status: string;
  customerId: string | null;
  budget: string | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  createdAt: string;
}

interface JobSummaryRow extends Job {
  customerName: string | null;
  revenue: string;
  cost: string;
  profit: string;
}

interface ProfitabilityLine {
  source: 'invoice_line' | 'bill_line' | 'expense_line';
  id: string;
  description: string | null;
  amount: string;
}

interface JobProfitability {
  jobId: string;
  jobName: string;
  budget: string | null;
  revenue: string;
  cost: string;
  profit: string;
  budgetVariance: string | null;
  lines: ProfitabilityLine[];
}

interface JobFormState {
  name: string;
  budget: string;
  startDate: string;
  endDate: string;
}

const EMPTY_FORM: JobFormState = {
  name: '',
  budget: '',
  startDate: '',
  endDate: '',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function profitTone(profit: string): 'success' | 'danger' | 'neutral' {
  const n = parseFloat(profit);
  if (n > 0) return 'success';
  if (n < 0) return 'danger';
  return 'neutral';
}

function formatDate(d: string | null): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function sourceLabel(source: ProfitabilityLine['source']): string {
  switch (source) {
    case 'invoice_line': return 'Revenue';
    case 'bill_line': return 'Bill Cost';
    case 'expense_line': return 'Direct Expense';
  }
}

function sourceTone(source: ProfitabilityLine['source']): 'success' | 'danger' {
  return source === 'invoice_line' ? 'success' : 'danger';
}

// ---------------------------------------------------------------------------
// New Job form (inside modal)
// ---------------------------------------------------------------------------

function JobForm({
  form,
  onChange,
}: {
  form: JobFormState;
  onChange: (field: keyof JobFormState, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor="name">Job Name *</Label>
        <Input
          id="name"
          placeholder="e.g. Roof Replacement — 42 Oak St"
          value={form.name}
          onChange={(e) => onChange('name', e.target.value)}
          required
        />
      </div>
      <div>
        <Label htmlFor="budget">Budget ($)</Label>
        <Input
          id="budget"
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={form.budget}
          onChange={(e) => onChange('budget', e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="startDate">Start Date</Label>
          <Input
            id="startDate"
            type="date"
            value={form.startDate}
            onChange={(e) => onChange('startDate', e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="endDate">End Date</Label>
          <Input
            id="endDate"
            type="date"
            value={form.endDate}
            onChange={(e) => onChange('endDate', e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profitability drawer (shown when a job row is clicked)
// ---------------------------------------------------------------------------

function ProfitabilityPanel({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<(Job & { profitability: JobProfitability }) | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await api.get<Job & { profitability: JobProfitability }>(
          `/api/jobs/${jobId}?profitability=true`,
        );
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          toast(err instanceof ApiError ? err.message : 'Failed to load job details', 'danger');
          onClose();
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [jobId, onClose]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-end p-6 pointer-events-none">
        <Card className="w-full max-w-xl p-6 pointer-events-auto">
          <p className="text-navy/40 text-sm text-center py-8">Loading...</p>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const { profitability: p } = data;
  const revLines = p.lines.filter((l) => l.source === 'invoice_line');
  const costLines = p.lines.filter((l) => l.source !== 'invoice_line');

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1" />
      <div
        className="w-full max-w-xl bg-white shadow-2xl overflow-y-auto h-full border-l border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-bold text-navy">{p.jobName}</h2>
            <p className="text-sm text-navy/50 mt-0.5">Job P&amp;L</p>
          </div>
          <button
            onClick={onClose}
            className="text-navy/40 hover:text-navy transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 p-6">
          <div className="rounded-xl bg-emerald/10 p-4 text-center">
            <p className="text-xs text-emerald font-semibold uppercase tracking-wide mb-1">Revenue</p>
            <p className="text-lg font-bold text-emerald">{formatCurrency(p.revenue)}</p>
          </div>
          <div className="rounded-xl bg-red-50 p-4 text-center">
            <p className="text-xs text-red-500 font-semibold uppercase tracking-wide mb-1">Cost</p>
            <p className="text-lg font-bold text-red-500">{formatCurrency(p.cost)}</p>
          </div>
          <div
            className={`rounded-xl p-4 text-center ${
              parseFloat(p.profit) >= 0 ? 'bg-electric/10' : 'bg-gold/20'
            }`}
          >
            <p
              className={`text-xs font-semibold uppercase tracking-wide mb-1 ${
                parseFloat(p.profit) >= 0 ? 'text-electric' : 'text-gold'
              }`}
            >
              Profit
            </p>
            <p
              className={`text-lg font-bold ${
                parseFloat(p.profit) >= 0 ? 'text-electric' : 'text-gold'
              }`}
            >
              {formatCurrency(p.profit)}
            </p>
          </div>
        </div>

        {/* Budget row */}
        {p.budget !== null && (
          <div className="mx-6 mb-4 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-navy/70">Budget</span>
            <span className="font-semibold text-navy">{formatCurrency(p.budget)}</span>
            {p.budgetVariance !== null && (
              <span
                className={`text-sm font-medium ${
                  parseFloat(p.budgetVariance) >= 0 ? 'text-emerald' : 'text-red-500'
                }`}
              >
                {parseFloat(p.budgetVariance) >= 0 ? '+' : ''}
                {formatCurrency(p.budgetVariance)} vs. budget
              </span>
            )}
          </div>
        )}

        {/* Line items */}
        {p.lines.length === 0 ? (
          <div className="px-6 py-8 text-center text-navy/40 text-sm">
            No line items tagged to this job yet.
          </div>
        ) : (
          <div className="px-6 pb-8 flex flex-col gap-6">
            {revLines.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald mb-2">
                  Revenue Lines
                </p>
                <div className="rounded-xl border border-slate-100 overflow-hidden">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="text-left py-2 px-3 font-semibold text-navy/70">Description</th>
                        <th className="text-right py-2 px-3 font-semibold text-navy/70">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {revLines.map((l) => (
                        <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                          <td className="py-2 px-3 text-navy/80">{l.description ?? '—'}</td>
                          <td className="py-2 px-3 text-right font-mono text-emerald font-medium">
                            {formatCurrency(l.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {costLines.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-red-500 mb-2">
                  Cost Lines
                </p>
                <div className="rounded-xl border border-slate-100 overflow-hidden">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="text-left py-2 px-3 font-semibold text-navy/70">Description</th>
                        <th className="text-left py-2 px-3 font-semibold text-navy/70">Type</th>
                        <th className="text-right py-2 px-3 font-semibold text-navy/70">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costLines.map((l) => (
                        <tr key={l.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                          <td className="py-2 px-3 text-navy/80">{l.description ?? '—'}</td>
                          <td className="py-2 px-3">
                            <span className="text-xs bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                              {sourceLabel(l.source)}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-red-500 font-medium">
                            {formatCurrency(l.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);

  // Add modal
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<JobFormState>(EMPTY_FORM);
  const [addSaving, setAddSaving] = useState(false);

  // Profitability panel
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  async function fetchJobs() {
    setLoading(true);
    try {
      if (includeInactive) {
        // Use plain list for inactive (summary only covers active)
        const list = await api.get<Job[]>('/api/jobs?includeInactive=true');
        // Map to summary shape without revenue/cost/profit for inactive
        setJobs(
          list.map((j) => ({
            ...j,
            customerName: null,
            revenue: '0.00',
            cost: '0.00',
            profit: '0.00',
          })),
        );
      } else {
        const data = await api.get<JobSummaryRow[]>('/api/jobs?summary=true');
        setJobs(data);
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load jobs', 'danger');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeInactive]);

  // ---------------------------------------------------------------------------
  // Add job
  // ---------------------------------------------------------------------------

  function openAddModal() {
    setAddForm(EMPTY_FORM);
    setAddOpen(true);
  }

  function updateAddForm(field: keyof JobFormState, value: string) {
    setAddForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleAdd() {
    if (!addForm.name.trim()) {
      toast('Job name is required', 'danger');
      return;
    }
    setAddSaving(true);
    try {
      await api.post('/api/jobs', {
        name: addForm.name.trim(),
        budget: addForm.budget ? addForm.budget : undefined,
        startDate: addForm.startDate || undefined,
        endDate: addForm.endDate || undefined,
      });
      toast('Job created', 'success');
      setAddOpen(false);
      await fetchJobs();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to create job', 'danger');
    } finally {
      setAddSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Jobs & Projects"
        icon={Briefcase}
        action={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-navy/60 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
                className="rounded border-slate-300 text-electric focus:ring-electric/40"
              />
              Show inactive
            </label>
            <Button onClick={openAddModal}>
              <Plus className="h-4 w-4" />
              New Job
            </Button>
          </div>
        }
      />

      <Card>
        {loading ? (
          <div className="p-12 text-center text-navy/40 text-sm">Loading jobs...</div>
        ) : jobs.length === 0 ? (
          <div className="p-12 text-center">
            <Briefcase className="mx-auto h-10 w-10 text-navy/20 mb-3" />
            <p className="text-navy/50 text-sm">
              {includeInactive
                ? 'No jobs found.'
                : 'No active jobs. Click "New Job" to start tracking project profitability.'}
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Job Name</Th>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th>Start</Th>
                <Th>End</Th>
                <Th className="text-right">Budget</Th>
                <Th className="text-right">Revenue</Th>
                <Th className="text-right">Cost</Th>
                <Th className="text-right">Profit</Th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <Tr
                  key={j.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedJobId(j.id)}
                >
                  <Td>
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-3.5 w-3.5 text-electric flex-shrink-0" />
                      <span className="font-semibold text-navy hover:text-electric transition-colors">
                        {j.name}
                      </span>
                    </div>
                  </Td>
                  <Td className="text-navy/70">{j.customerName ?? '-'}</Td>
                  <Td>
                    {j.isActive ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="neutral">Inactive</Badge>
                    )}
                  </Td>
                  <Td className="text-navy/60 text-sm">{formatDate(j.startDate)}</Td>
                  <Td className="text-navy/60 text-sm">{formatDate(j.endDate)}</Td>
                  <Td className="text-right font-mono text-navy/70 text-sm">
                    {j.budget ? formatCurrency(j.budget) : '-'}
                  </Td>
                  <Td className="text-right font-mono font-semibold text-emerald">
                    {includeInactive ? '-' : formatCurrency(j.revenue)}
                  </Td>
                  <Td className="text-right font-mono font-semibold text-red-500">
                    {includeInactive ? '-' : formatCurrency(j.cost)}
                  </Td>
                  <Td className="text-right">
                    {includeInactive ? (
                      <span className="text-navy/40 text-sm">-</span>
                    ) : (
                      <Badge tone={profitTone(j.profit)}>
                        {formatCurrency(j.profit)}
                      </Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* ---- Add job modal ---- */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="New Job / Project"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={addSaving}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={addSaving}>
              {addSaving ? 'Creating...' : 'Create Job'}
            </Button>
          </>
        }
      >
        <JobForm form={addForm} onChange={updateAddForm} />
      </Modal>

      {/* ---- Profitability panel ---- */}
      {selectedJobId && (
        <ProfitabilityPanel
          jobId={selectedJobId}
          onClose={() => setSelectedJobId(null)}
        />
      )}

      <Toaster />
    </main>
  );
}
