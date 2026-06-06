'use client';

import { useEffect, useState, useCallback } from 'react';
import { FileText, Plus, ArrowRight, Trash2, Download } from 'lucide-react';
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

interface Estimate {
  id: string;
  estimateNumber: number;
  customerId: string;
  date: string;
  expirationDate: string | null;
  status: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  memo: string | null;
  convertedInvoiceId: string | null;
}

interface Customer {
  id: string;
  displayName: string;
}

interface EstimateLineForm {
  itemId: string;
  description: string;
  quantity: string;
  rate: string;
  taxable: boolean;
}

interface EstimateForm {
  customerId: string;
  date: string;
  expirationDate: string;
  memo: string;
  lines: EstimateLineForm[];
}

const EMPTY_LINE: EstimateLineForm = {
  itemId: '',
  description: '',
  quantity: '1',
  rate: '0',
  taxable: true,
};

const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_FORM: EstimateForm = {
  customerId: '',
  date: today(),
  expirationDate: '',
  memo: '',
  lines: [{ ...EMPTY_LINE }],
};

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'draft': return 'neutral';
    case 'accepted': return 'success';
    case 'rejected': return 'danger';
    case 'closed': return 'info';
    default: return 'neutral';
  }
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ---------------------------------------------------------------------------
// Line row component
// ---------------------------------------------------------------------------

function LineRow({
  line,
  index,
  onChange,
  onRemove,
  canRemove,
}: {
  line: EstimateLineForm;
  index: number;
  onChange: (idx: number, field: keyof EstimateLineForm, value: string | boolean) => void;
  onRemove: (idx: number) => void;
  canRemove: boolean;
}) {
  const qty = parseFloat(line.quantity) || 0;
  const rate = parseFloat(line.rate) || 0;
  const amount = qty * rate;

  return (
    <div className="grid grid-cols-12 gap-2 items-center mb-2">
      <div className="col-span-5">
        <Input
          placeholder="Description"
          value={line.description}
          onChange={(e) => onChange(index, 'description', e.target.value)}
        />
      </div>
      <div className="col-span-2">
        <Input
          type="number"
          min="0.0001"
          step="any"
          placeholder="Qty"
          value={line.quantity}
          onChange={(e) => onChange(index, 'quantity', e.target.value)}
        />
      </div>
      <div className="col-span-2">
        <Input
          type="number"
          min="0"
          step="any"
          placeholder="Rate"
          value={line.rate}
          onChange={(e) => onChange(index, 'rate', e.target.value)}
        />
      </div>
      <div className="col-span-2 text-right text-sm font-mono text-navy font-semibold">
        {formatCurrency(amount)}
      </div>
      <div className="col-span-1 flex justify-end">
        {canRemove && (
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="text-red-400 hover:text-red-600 p-1 rounded"
            title="Remove line"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New Estimate modal form
// ---------------------------------------------------------------------------

function EstimateFormBody({
  form,
  customers,
  onChange,
  onLineChange,
  onAddLine,
  onRemoveLine,
}: {
  form: EstimateForm;
  customers: Customer[];
  onChange: (field: keyof EstimateForm, value: string) => void;
  onLineChange: (idx: number, field: keyof EstimateLineForm, value: string | boolean) => void;
  onAddLine: () => void;
  onRemoveLine: (idx: number) => void;
}) {
  const subtotal = form.lines.reduce(
    (sum, l) => sum + (parseFloat(l.quantity) || 0) * (parseFloat(l.rate) || 0),
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="customerId">Customer *</Label>
          <Select
            id="customerId"
            value={form.customerId}
            onChange={(e) => onChange('customerId', e.target.value)}
            required
          >
            <option value="">Select customer...</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="date">Date *</Label>
          <Input
            id="date"
            type="date"
            value={form.date}
            onChange={(e) => onChange('date', e.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <Label htmlFor="expirationDate">Expiration Date</Label>
        <Input
          id="expirationDate"
          type="date"
          value={form.expirationDate}
          onChange={(e) => onChange('expirationDate', e.target.value)}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="mb-0">Line Items *</Label>
          <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-navy/50 w-full mt-1">
            <div className="col-span-5">Description</div>
            <div className="col-span-2">Qty</div>
            <div className="col-span-2">Rate</div>
            <div className="col-span-2 text-right">Amount</div>
            <div className="col-span-1" />
          </div>
        </div>

        {form.lines.map((line, idx) => (
          <LineRow
            key={idx}
            line={line}
            index={idx}
            onChange={onLineChange}
            onRemove={onRemoveLine}
            canRemove={form.lines.length > 1}
          />
        ))}

        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={onAddLine}
          className="mt-1 text-electric"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Line
        </Button>

        <div className="flex justify-end mt-3 pt-3 border-t border-slate-100">
          <span className="text-sm font-bold text-navy">
            Total: {formatCurrency(subtotal)}
          </span>
        </div>
      </div>

      <div>
        <Label htmlFor="memo">Memo</Label>
        <textarea
          id="memo"
          rows={2}
          placeholder="Optional note to customer..."
          value={form.memo}
          onChange={(e) => onChange('memo', e.target.value)}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy outline-none focus:border-electric focus:ring-2 focus:ring-electric/30 placeholder:text-navy/30 resize-none"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EstimatesPage() {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [customerMap, setCustomerMap] = useState<Map<string, string>>(new Map());

  // New estimate modal.
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<EstimateForm>({ ...EMPTY_FORM, lines: [{ ...EMPTY_LINE }] });
  const [addSaving, setAddSaving] = useState(false);

  // Convert confirm modal.
  const [convertTarget, setConvertTarget] = useState<Estimate | null>(null);
  const [converting, setConverting] = useState(false);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchEstimates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Estimate[]>('/api/estimates');
      setEstimates(data);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load estimates', 'danger');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCustomers = useCallback(async () => {
    try {
      const data = await api.get<Customer[]>('/api/customers');
      setCustomers(data);
      setCustomerMap(new Map(data.map((c) => [c.id, c.displayName])));
    } catch {
      // Non-fatal; customers just won't populate the dropdown.
    }
  }, []);

  useEffect(() => {
    fetchEstimates();
    fetchCustomers();
  }, [fetchEstimates, fetchCustomers]);

  // ---------------------------------------------------------------------------
  // New estimate
  // ---------------------------------------------------------------------------

  function openAddModal() {
    setAddForm({ ...EMPTY_FORM, date: today(), lines: [{ ...EMPTY_LINE }] });
    setAddOpen(true);
  }

  function handleFormChange(field: keyof EstimateForm, value: string) {
    setAddForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleLineChange(idx: number, field: keyof EstimateLineForm, value: string | boolean) {
    setAddForm((prev) => {
      const lines = [...prev.lines];
      lines[idx] = { ...lines[idx], [field]: value };
      return { ...prev, lines };
    });
  }

  function handleAddLine() {
    setAddForm((prev) => ({ ...prev, lines: [...prev.lines, { ...EMPTY_LINE }] }));
  }

  function handleRemoveLine(idx: number) {
    setAddForm((prev) => ({
      ...prev,
      lines: prev.lines.filter((_, i) => i !== idx),
    }));
  }

  async function handleCreate() {
    if (!addForm.customerId) {
      toast('Please select a customer', 'danger');
      return;
    }
    if (!addForm.date) {
      toast('Please enter a date', 'danger');
      return;
    }
    if (addForm.lines.some((l) => !l.description.trim())) {
      toast('All lines must have a description', 'danger');
      return;
    }

    setAddSaving(true);
    try {
      await api.post('/api/estimates', {
        customerId: addForm.customerId,
        date: addForm.date,
        expirationDate: addForm.expirationDate || null,
        memo: addForm.memo || null,
        lines: addForm.lines.map((l) => ({
          itemId: l.itemId || null,
          description: l.description.trim(),
          quantity: parseFloat(l.quantity) || 1,
          rate: parseFloat(l.rate) || 0,
          taxable: l.taxable,
        })),
      });
      toast('Estimate created', 'success');
      setAddOpen(false);
      await fetchEstimates();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to create estimate', 'danger');
    } finally {
      setAddSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Status update
  // ---------------------------------------------------------------------------

  async function handleStatusChange(estimate: Estimate, status: string) {
    try {
      await api.patch(`/api/estimates/${estimate.id}`, { status });
      toast(`Estimate #${estimate.estimateNumber} marked ${status}`, 'success');
      await fetchEstimates();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to update status', 'danger');
    }
  }

  // ---------------------------------------------------------------------------
  // Convert to invoice
  // ---------------------------------------------------------------------------

  async function handleConvert() {
    if (!convertTarget) return;
    setConverting(true);
    try {
      await api.post(`/api/estimates/${convertTarget.id}`, { action: 'convert' });
      toast(`Estimate #${convertTarget.estimateNumber} converted to invoice`, 'success');
      setConvertTarget(null);
      await fetchEstimates();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to convert estimate', 'danger');
    } finally {
      setConverting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Estimates"
        icon={FileText}
        action={
          <Button onClick={openAddModal}>
            <Plus className="h-4 w-4" />
            New Estimate
          </Button>
        }
      />

      <Card>
        {loading ? (
          <div className="p-12 text-center text-navy/40 text-sm">Loading estimates...</div>
        ) : estimates.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="mx-auto h-10 w-10 text-navy/20 mb-3" />
            <p className="text-navy/50 text-sm">
              No estimates yet. Click "New Estimate" to create your first quote.
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Customer</Th>
                <Th>Date</Th>
                <Th>Expires</Th>
                <Th className="text-right">Total</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {estimates.map((e) => (
                <Tr key={e.id}>
                  <Td className="font-mono font-semibold text-navy">
                    EST-{String(e.estimateNumber).padStart(4, '0')}
                  </Td>
                  <Td className="font-semibold text-navy">
                    {customerMap.get(e.customerId) ?? e.customerId}
                  </Td>
                  <Td className="text-navy/70">
                    {new Date(e.date).toLocaleDateString()}
                  </Td>
                  <Td className="text-navy/70">
                    {e.expirationDate
                      ? new Date(e.expirationDate).toLocaleDateString()
                      : '-'}
                  </Td>
                  <Td className="text-right font-mono font-semibold text-navy">
                    {formatCurrency(e.total)}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(e.status)}>{statusLabel(e.status)}</Badge>
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {/* PDF download */}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(`/api/estimates/${e.id}/pdf`, '_blank')}
                        title="Download PDF"
                      >
                        <Download className="h-3.5 w-3.5" />
                        PDF
                      </Button>
                      {/* Status transitions for non-closed estimates */}
                      {e.status !== 'closed' && (
                        <>
                          {e.status !== 'accepted' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleStatusChange(e, 'accepted')}
                              title="Mark accepted"
                            >
                              Accept
                            </Button>
                          )}
                          {e.status !== 'rejected' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleStatusChange(e, 'rejected')}
                              className="text-red-500 hover:bg-red-50"
                              title="Mark rejected"
                            >
                              Reject
                            </Button>
                          )}
                          {e.status !== 'draft' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleStatusChange(e, 'draft')}
                              title="Reset to draft"
                            >
                              Draft
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setConvertTarget(e)}
                            title="Convert to invoice"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                            Invoice
                          </Button>
                        </>
                      )}
                      {e.status === 'closed' && e.convertedInvoiceId && (
                        <span className="text-xs text-navy/40 italic">Converted</span>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* ---- New Estimate modal ---- */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="New Estimate"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={addSaving}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={addSaving}>
              {addSaving ? 'Saving...' : 'Create Estimate'}
            </Button>
          </>
        }
      >
        <EstimateFormBody
          form={addForm}
          customers={customers}
          onChange={handleFormChange}
          onLineChange={handleLineChange}
          onAddLine={handleAddLine}
          onRemoveLine={handleRemoveLine}
        />
      </Modal>

      {/* ---- Convert confirm modal ---- */}
      <Modal
        open={!!convertTarget}
        onClose={() => setConvertTarget(null)}
        title="Convert to Invoice"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConvertTarget(null)}
              disabled={converting}
            >
              Cancel
            </Button>
            <Button onClick={handleConvert} disabled={converting}>
              {converting ? 'Converting...' : 'Convert to Invoice'}
            </Button>
          </>
        }
      >
        <p className="text-navy/70 text-sm">
          Convert{' '}
          <strong className="text-navy">
            EST-{String(convertTarget?.estimateNumber ?? 0).padStart(4, '0')}
          </strong>{' '}
          (
          <strong>{formatCurrency(convertTarget?.total ?? 0)}</strong>) into a posted invoice?
          This will debit Accounts Receivable and credit Sales Income. The estimate will be
          marked as closed.
        </p>
      </Modal>

      <Toaster />
    </main>
  );
}
