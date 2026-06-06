'use client';

import { useEffect, useState } from 'react';
import { Car, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Select,
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

interface MileageLog {
  id: string;
  customerId: string | null;
  jobId: string | null;
  date: string;
  miles: string;
  ratePerMile: string;
  amount: string;
  purpose: string | null;
  billable: boolean;
  customerName: string | null;
  jobName: string | null;
}

interface MileageSummary {
  totalMiles: string;
  totalAmount: string;
  groups: Array<{
    customerId: string | null;
    customerName: string | null;
    jobId: string | null;
    jobName: string | null;
    totalMiles: string;
    totalAmount: string;
  }>;
}

interface Customer {
  id: string;
  displayName: string;
}

interface LogMilesForm {
  date: string;
  miles: string;
  ratePerMile: string;
  customerId: string;
  purpose: string;
  billable: boolean;
}

const EMPTY_FORM: LogMilesForm = {
  date: new Date().toISOString().slice(0, 10),
  miles: '',
  ratePerMile: '0.67',
  customerId: '',
  purpose: '',
  billable: false,
};

// ---------------------------------------------------------------------------
// Summary card
// ---------------------------------------------------------------------------

function SummaryCard({ summary }: { summary: MileageSummary | null }) {
  if (!summary) {
    return (
      <Card className="p-5 mb-6 flex items-center gap-6">
        <div className="animate-pulse h-10 w-64 bg-slate-100 rounded" />
      </Card>
    );
  }

  return (
    <Card className="p-5 mb-6">
      <div className="flex flex-wrap items-center gap-8">
        <div>
          <p className="text-xs font-semibold text-navy/50 uppercase tracking-wider mb-1">
            Total Miles
          </p>
          <p className="text-3xl font-extrabold text-navy">
            {parseFloat(summary.totalMiles).toLocaleString('en-US', {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold text-navy/50 uppercase tracking-wider mb-1">
            Total Deduction
          </p>
          <p className="text-3xl font-extrabold text-emerald-600">
            {formatCurrency(summary.totalAmount)}
          </p>
        </div>
        <div className="ml-auto text-sm text-navy/50">
          {summary.groups.length} group{summary.groups.length !== 1 ? 's' : ''}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Log Miles form
// ---------------------------------------------------------------------------

function LogMilesForm({
  form,
  customers,
  onChange,
}: {
  form: LogMilesForm;
  customers: Customer[];
  onChange: (field: keyof LogMilesForm, value: string | boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="ml-date">Date *</Label>
          <Input
            id="ml-date"
            type="date"
            value={form.date}
            onChange={(e) => onChange('date', e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="ml-miles">Miles *</Label>
          <Input
            id="ml-miles"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="e.g. 45.2"
            value={form.miles}
            onChange={(e) => onChange('miles', e.target.value)}
            required
          />
        </div>
      </div>
      <div>
        <Label htmlFor="ml-rate">Rate per Mile ($/mi)</Label>
        <Input
          id="ml-rate"
          type="number"
          min="0"
          step="0.0001"
          placeholder="0.67"
          value={form.ratePerMile}
          onChange={(e) => onChange('ratePerMile', e.target.value)}
        />
        <p className="text-xs text-navy/40 mt-1">Default: $0.67 (IRS standard rate)</p>
      </div>
      <div>
        <Label htmlFor="ml-customer">Customer (optional)</Label>
        <Select
          id="ml-customer"
          value={form.customerId}
          onChange={(e) => onChange('customerId', e.target.value)}
        >
          <option value="">-- None --</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="ml-purpose">Purpose</Label>
        <Input
          id="ml-purpose"
          placeholder="e.g. Client site visit"
          value={form.purpose}
          onChange={(e) => onChange('purpose', e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={form.billable}
          onChange={(e) => onChange('billable', e.target.checked)}
          className="rounded border-slate-300 text-electric focus:ring-electric/40"
        />
        <span className="text-sm text-navy/70">Billable to customer</span>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MileagePage() {
  const [logs, setLogs] = useState<MileageLog[]>([]);
  const [summary, setSummary] = useState<MileageSummary | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);

  // Log modal
  const [logOpen, setLogOpen] = useState(false);
  const [logForm, setLogForm] = useState<LogMilesForm>(EMPTY_FORM);
  const [logSaving, setLogSaving] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<MileageLog | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  async function fetchAll() {
    setLoading(true);
    try {
      const [logsData, summaryData, custData] = await Promise.all([
        api.get<MileageLog[]>('/api/mileage'),
        api.get<MileageSummary>('/api/mileage?summary=true'),
        api.get<Customer[]>('/api/customers'),
      ]);
      setLogs(logsData);
      setSummary(summaryData);
      setCustomers(custData);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load mileage data', 'danger');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Log Miles
  // ---------------------------------------------------------------------------

  function openLogModal() {
    setLogForm(EMPTY_FORM);
    setLogOpen(true);
  }

  function updateForm(field: keyof LogMilesForm, value: string | boolean) {
    setLogForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleLog() {
    if (!logForm.miles || parseFloat(logForm.miles) <= 0) {
      toast('Miles must be greater than zero', 'danger');
      return;
    }
    if (!logForm.date) {
      toast('Date is required', 'danger');
      return;
    }
    setLogSaving(true);
    try {
      await api.post('/api/mileage', {
        date: logForm.date,
        miles: parseFloat(logForm.miles),
        ratePerMile: logForm.ratePerMile ? parseFloat(logForm.ratePerMile) : undefined,
        customerId: logForm.customerId || undefined,
        purpose: logForm.purpose.trim() || undefined,
        billable: logForm.billable,
      });
      toast('Mileage logged', 'success');
      setLogOpen(false);
      await fetchAll();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to log mileage', 'danger');
    } finally {
      setLogSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.del(`/api/mileage/${deleteTarget.id}`);
      toast('Mileage log deleted', 'success');
      setDeleteTarget(null);
      await fetchAll();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to delete log', 'danger');
    } finally {
      setDeleting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function fmtMiles(m: string) {
    return parseFloat(m).toLocaleString('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Mileage"
        icon={Car}
        action={
          <Button onClick={openLogModal}>
            <Plus className="h-4 w-4" />
            Log Miles
          </Button>
        }
      />

      {/* Summary card */}
      <SummaryCard summary={summary} />

      {/* Log table */}
      <Card>
        {loading ? (
          <div className="p-12 text-center text-navy/40 text-sm">Loading mileage logs...</div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center">
            <Car className="mx-auto h-10 w-10 text-navy/20 mb-3" />
            <p className="text-navy/50 text-sm">
              No mileage logs yet. Click &quot;Log Miles&quot; to get started.
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Customer</Th>
                <Th>Purpose</Th>
                <Th className="text-right">Miles</Th>
                <Th className="text-right">Rate</Th>
                <Th className="text-right">Amount</Th>
                <Th>Billable</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <Tr key={log.id}>
                  <Td className="text-navy/80 whitespace-nowrap">{fmtDate(log.date)}</Td>
                  <Td className="text-navy/70">
                    {log.customerName ? (
                      <span>
                        {log.customerName}
                        {log.jobName && (
                          <span className="text-navy/40 text-xs ml-1">/ {log.jobName}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-navy/30">—</span>
                    )}
                  </Td>
                  <Td className="text-navy/70">{log.purpose ?? <span className="text-navy/30">—</span>}</Td>
                  <Td className="text-right font-mono text-navy">{fmtMiles(log.miles)}</Td>
                  <Td className="text-right font-mono text-navy/70">
                    ${parseFloat(log.ratePerMile).toFixed(4)}
                  </Td>
                  <Td className="text-right font-mono font-semibold text-navy">
                    {formatCurrency(log.amount)}
                  </Td>
                  <Td>
                    {log.billable ? (
                      <Badge tone="info">Billable</Badge>
                    ) : (
                      <Badge tone="neutral">Internal</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(log)}
                      className="text-red-500 hover:bg-red-50"
                      title="Delete log"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* ---- Log Miles modal ---- */}
      <Modal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        title="Log Miles"
        footer={
          <>
            <Button variant="secondary" onClick={() => setLogOpen(false)} disabled={logSaving}>
              Cancel
            </Button>
            <Button onClick={handleLog} disabled={logSaving}>
              {logSaving ? 'Saving...' : 'Log Miles'}
            </Button>
          </>
        }
      >
        <LogMilesForm form={logForm} customers={customers} onChange={updateForm} />
      </Modal>

      {/* ---- Delete confirm modal ---- */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Mileage Log"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Yes, Delete'}
            </Button>
          </>
        }
      >
        <p className="text-navy/70 text-sm">
          Are you sure you want to delete this mileage log entry?{' '}
          {deleteTarget && (
            <>
              <strong className="text-navy">
                {fmtMiles(deleteTarget.miles)} mi
              </strong>{' '}
              on{' '}
              <strong className="text-navy">{fmtDate(deleteTarget.date)}</strong>
              {deleteTarget.purpose ? ` — ${deleteTarget.purpose}` : ''}.
            </>
          )}{' '}
          This action cannot be undone.
        </p>
      </Modal>

      <Toaster />
    </main>
  );
}
