'use client';

import { useEffect, useState, useCallback } from 'react';
import { Receipt, Plus, Trash2, Send, CheckCircle } from 'lucide-react';
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

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
}

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface ExpenseReport {
  id: string;
  employeeId: string;
  title: string | null;
  status: string;
  total: string;
  submittedAt: string | null;
  postedEntryId: string | null;
  createdAt: string;
}

interface ExpenseReportLine {
  id: string;
  accountId: string;
  date: string | null;
  description: string | null;
  amount: string;
}

interface ExpenseReportDetail extends ExpenseReport {
  lines: ExpenseReportLine[];
}

interface LineFormState {
  accountId: string;
  date: string;
  description: string;
  amount: string;
}

const EMPTY_LINE: LineFormState = {
  accountId: '',
  date: '',
  description: '',
  amount: '',
};

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  submitted: 'info',
  approved: 'warning',
  reimbursed: 'success',
  rejected: 'danger',
};

function statusLabel(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function lineTotal(lines: LineFormState[]): number {
  return lines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);
}

// ---------------------------------------------------------------------------
// New Report modal
// ---------------------------------------------------------------------------

function NewReportModal({
  open,
  onClose,
  employees,
  accounts,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  employees: Employee[];
  accounts: Account[];
  onCreated: () => void;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState<LineFormState[]>([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);

  function reset() {
    setEmployeeId('');
    setTitle('');
    setLines([{ ...EMPTY_LINE }]);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLine(idx: number, field: keyof LineFormState, value: string) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  }

  async function handleSave() {
    if (!employeeId) {
      toast('Please select an employee.', 'danger');
      return;
    }
    for (const [i, line] of lines.entries()) {
      if (!line.accountId) {
        toast(`Line ${i + 1}: account is required.`, 'danger');
        return;
      }
      if (!line.amount || parseFloat(line.amount) <= 0) {
        toast(`Line ${i + 1}: amount must be greater than zero.`, 'danger');
        return;
      }
    }

    setSaving(true);
    try {
      await api.post('/api/expense-reports', {
        employeeId,
        title: title.trim() || undefined,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          date: l.date || undefined,
          description: l.description.trim() || undefined,
          amount: l.amount,
        })),
      });
      toast('Expense report created.', 'success');
      reset();
      onCreated();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to create report.', 'danger');
    } finally {
      setSaving(false);
    }
  }

  const expenseAccounts = accounts.filter((a) => a.type === 'expense');
  const total = lineTotal(lines);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New Expense Report"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Creating...' : 'Create Report'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Employee */}
        <div>
          <Label htmlFor="nr-employee">Employee *</Label>
          <Select
            id="nr-employee"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <option value="">Select employee...</option>
            {employees
              .filter((e) => e.isActive)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.firstName} {e.lastName}
                </option>
              ))}
          </Select>
        </div>

        {/* Title */}
        <div>
          <Label htmlFor="nr-title">Title</Label>
          <Input
            id="nr-title"
            placeholder="e.g. Q1 Travel Expenses"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* Lines */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="mb-0">Expense Lines *</Label>
            <Button variant="ghost" size="sm" onClick={addLine}>
              <Plus className="h-3.5 w-3.5" />
              Add Line
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            {lines.map((line, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-start rounded-lg border border-slate-100 bg-slate-50 p-2"
              >
                {/* Account */}
                <div>
                  <Label htmlFor={`nr-acc-${idx}`} className="text-xs">
                    Account *
                  </Label>
                  <Select
                    id={`nr-acc-${idx}`}
                    value={line.accountId}
                    onChange={(e) => updateLine(idx, 'accountId', e.target.value)}
                  >
                    <option value="">Select...</option>
                    {expenseAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {a.name}
                      </option>
                    ))}
                  </Select>
                </div>
                {/* Description */}
                <div>
                  <Label htmlFor={`nr-desc-${idx}`} className="text-xs">
                    Description
                  </Label>
                  <Input
                    id={`nr-desc-${idx}`}
                    placeholder="e.g. Hotel stay"
                    value={line.description}
                    onChange={(e) => updateLine(idx, 'description', e.target.value)}
                  />
                </div>
                {/* Amount */}
                <div>
                  <Label htmlFor={`nr-amt-${idx}`} className="text-xs">
                    Amount *
                  </Label>
                  <Input
                    id={`nr-amt-${idx}`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={line.amount}
                    onChange={(e) => updateLine(idx, 'amount', e.target.value)}
                  />
                </div>
                {/* Remove */}
                <div className="pt-5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeLine(idx)}
                    disabled={lines.length === 1}
                    className="text-red-400 hover:bg-red-50"
                    title="Remove line"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Total preview */}
          <div className="mt-2 text-right text-sm font-semibold text-navy">
            Total: {formatCurrency(total)}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Report detail modal (view lines)
// ---------------------------------------------------------------------------

function ReportDetailModal({
  report,
  accounts,
  onClose,
}: {
  report: ExpenseReportDetail | null;
  accounts: Account[];
  onClose: () => void;
}) {
  if (!report) return null;
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  return (
    <Modal
      open={!!report}
      onClose={onClose}
      title={report.title ?? 'Expense Report'}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-4 text-sm text-navy/70">
          <span>
            Status:{' '}
            <Badge tone={STATUS_TONE[report.status] ?? 'neutral'}>
              {statusLabel(report.status)}
            </Badge>
          </span>
          {report.submittedAt && (
            <span>Submitted: {new Date(report.submittedAt).toLocaleDateString()}</span>
          )}
        </div>

        <Table>
          <thead>
            <tr>
              <Th>Account</Th>
              <Th>Description</Th>
              <Th className="text-right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => {
              const acc = accountById.get(line.accountId);
              return (
                <Tr key={line.id}>
                  <Td className="text-sm">
                    {acc ? `${acc.code} ${acc.name}` : line.accountId}
                  </Td>
                  <Td className="text-sm text-navy/70">{line.description ?? '-'}</Td>
                  <Td className="text-right font-mono text-sm">{formatCurrency(line.amount)}</Td>
                </Tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td
                colSpan={2}
                className="py-2.5 px-4 text-right font-semibold text-navy/70 text-sm border-t-2 border-navy/10"
              >
                Total
              </td>
              <td className="py-2.5 px-4 text-right font-bold text-navy font-mono border-t-2 border-navy/10">
                {formatCurrency(report.total)}
              </td>
            </tr>
          </tfoot>
        </Table>

        {report.postedEntryId && (
          <p className="text-xs text-navy/40 font-mono">GL Entry: {report.postedEntryId}</p>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ExpenseReportsPage() {
  const [reports, setReports] = useState<ExpenseReport[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  // New report modal
  const [newOpen, setNewOpen] = useState(false);

  // Detail modal
  const [detailReport, setDetailReport] = useState<ExpenseReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Action loading ids
  const [actionId, setActionId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ExpenseReport[]>('/api/expense-reports');
      setReports(data);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load reports.', 'danger');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
    api.get<Employee[]>('/api/employees').then(setEmployees).catch(() => {});
    api.get<Account[]>('/api/accounts').then(setAccounts).catch(() => {});
  }, [fetchReports]);

  // ---------------------------------------------------------------------------
  // View detail
  // ---------------------------------------------------------------------------

  async function openDetail(report: ExpenseReport) {
    setDetailLoading(true);
    try {
      const detail = await api.get<ExpenseReportDetail>(`/api/expense-reports/${report.id}`);
      setDetailReport(detail);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load report details.', 'danger');
    } finally {
      setDetailLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  async function handleSubmit(report: ExpenseReport) {
    setActionId(report.id);
    try {
      await api.post(`/api/expense-reports/${report.id}`, { action: 'submit' });
      toast('Report submitted for approval.', 'success');
      await fetchReports();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to submit report.', 'danger');
    } finally {
      setActionId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Reimburse
  // ---------------------------------------------------------------------------

  async function handleReimburse(report: ExpenseReport) {
    setActionId(report.id);
    try {
      await api.post(`/api/expense-reports/${report.id}`, { action: 'reimburse' });
      toast('Report approved and reimbursed. GL entry posted.', 'success');
      await fetchReports();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to reimburse report.', 'danger');
    } finally {
      setActionId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const employeeById = new Map(employees.map((e) => [e.id, e]));

  function employeeName(id: string) {
    const e = employeeById.get(id);
    return e ? `${e.firstName} ${e.lastName}` : id;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Expense Reports"
        icon={Receipt}
        action={
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" />
            New Report
          </Button>
        }
      />

      <Card>
        {loading ? (
          <div className="p-12 text-center text-navy/40 text-sm">Loading expense reports...</div>
        ) : reports.length === 0 ? (
          <div className="p-12 text-center">
            <Receipt className="mx-auto h-10 w-10 text-navy/20 mb-3" />
            <p className="text-navy/50 text-sm">
              No expense reports yet. Click "New Report" to get started.
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Title</Th>
                <Th>Status</Th>
                <Th className="text-right">Total</Th>
                <Th>Created</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => {
                const busy = actionId === r.id || detailLoading;
                return (
                  <Tr key={r.id}>
                    <Td className="font-semibold text-navy">{employeeName(r.employeeId)}</Td>
                    <Td className="text-navy/70">{r.title ?? '-'}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>
                        {statusLabel(r.status)}
                      </Badge>
                    </Td>
                    <Td className="text-right font-mono font-semibold text-navy">
                      {formatCurrency(r.total)}
                    </Td>
                    <Td className="text-navy/60 text-sm">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* View */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openDetail(r)}
                          disabled={busy}
                        >
                          View
                        </Button>

                        {/* Submit action (draft only) */}
                        {r.status === 'draft' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSubmit(r)}
                            disabled={busy}
                            title="Submit for approval"
                          >
                            <Send className="h-3.5 w-3.5" />
                            Submit
                          </Button>
                        )}

                        {/* Reimburse action (submitted only) */}
                        {r.status === 'submitted' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleReimburse(r)}
                            disabled={busy}
                            className="text-emerald hover:bg-emerald/10"
                            title="Approve and reimburse"
                          >
                            <CheckCircle className="h-3.5 w-3.5" />
                            Reimburse
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* New report modal */}
      <NewReportModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        employees={employees}
        accounts={accounts}
        onCreated={() => {
          setNewOpen(false);
          fetchReports();
        }}
      />

      {/* Detail modal */}
      <ReportDetailModal
        report={detailReport}
        accounts={accounts}
        onClose={() => setDetailReport(null)}
      />

      <Toaster />
    </main>
  );
}
