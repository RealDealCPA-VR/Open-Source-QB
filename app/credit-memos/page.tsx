'use client';

import { useEffect, useState, useCallback } from 'react';
import { FileX, Plus, PlusCircle, MinusCircle } from 'lucide-react';
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
} from '@/components/ui';
import { api } from '@/lib/client';
import { formatCurrency } from '@/lib/money';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Customer {
  id: string;
  displayName: string;
}

interface Invoice {
  id: string;
  invoiceNumber: number;
  customerId: string;
  status: string;
  balanceDue: string;
  total: string;
}

interface CreditMemo {
  id: string;
  memoNumber: number;
  customerId: string;
  date: string;
  status: 'open' | 'paid' | 'void';
  total: string;
  unapplied: string;
  memo: string | null;
}

interface LineRow {
  description: string;
  quantity: string;
  rate: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusTone(status: CreditMemo['status']): 'info' | 'success' | 'neutral' | 'warning' {
  if (status === 'open') return 'info';
  if (status === 'paid') return 'success';
  return 'neutral';
}

function statusLabel(status: CreditMemo['status']): string {
  if (status === 'open') return 'Open';
  if (status === 'paid') return 'Applied';
  return 'Void';
}

function computeLineTotal(line: LineRow): number {
  return (parseFloat(line.quantity) || 0) * (parseFloat(line.rate) || 0);
}

function computeTotal(lines: LineRow[]): number {
  return lines.reduce((sum, l) => sum + computeLineTotal(l), 0);
}

const EMPTY_LINE: LineRow = { description: '', quantity: '', rate: '' };

// ---------------------------------------------------------------------------
// New Credit Memo Modal
// ---------------------------------------------------------------------------

interface NewMemoModalProps {
  open: boolean;
  onClose: () => void;
  customers: Customer[];
  onCreated: () => void;
}

function NewMemoModal({ open, onClose, customers, onCreated }: NewMemoModalProps) {
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memoNote, setMemoNote] = useState('');
  const [lines, setLines] = useState<LineRow[]>([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCustomerId('');
      setDate(new Date().toISOString().slice(0, 10));
      setMemoNote('');
      setLines([{ ...EMPTY_LINE }]);
    }
  }, [open]);

  function updateLine(idx: number, field: keyof LineRow, value: string) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  const liveTotal = computeTotal(lines);

  async function handleSubmit() {
    if (!customerId) { toast('Please select a customer.', 'danger'); return; }
    if (!date) { toast('Please enter a date.', 'danger'); return; }
    const validLines = lines.filter((l) => l.quantity || l.rate);
    if (validLines.length === 0) { toast('Add at least one line item.', 'danger'); return; }
    for (let i = 0; i < validLines.length; i++) {
      const l = validLines[i];
      if (!l.quantity || parseFloat(l.quantity) <= 0) {
        toast(`Line ${i + 1}: quantity must be positive.`, 'danger'); return;
      }
      if (!l.rate || parseFloat(l.rate) < 0) {
        toast(`Line ${i + 1}: rate cannot be negative.`, 'danger'); return;
      }
    }

    setSaving(true);
    try {
      await api.post('/api/credit-memos', {
        customerId,
        date,
        memo: memoNote || null,
        lines: validLines.map((l) => ({
          description: l.description || null,
          quantity: l.quantity,
          rate: l.rate,
        })),
      });
      toast('Credit memo created.', 'success');
      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create credit memo.';
      toast(msg, 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Credit Memo"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Create Credit Memo'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Customer */}
        <div>
          <Label htmlFor="cm-customer">Customer *</Label>
          <Select
            id="cm-customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.displayName}</option>
            ))}
          </Select>
        </div>

        {/* Date */}
        <div>
          <Label htmlFor="cm-date">Date *</Label>
          <Input
            id="cm-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="mb-0">Line Items</Label>
            <button
              type="button"
              onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}
              className="text-electric hover:text-electric/80 flex items-center gap-1 text-sm font-medium"
            >
              <PlusCircle className="h-4 w-4" /> Add line
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="grid grid-cols-[1fr_80px_90px_32px] gap-2 bg-slate-50 px-3 py-2 text-xs font-semibold text-navy/60 border-b border-slate-200">
              <span>Description</span>
              <span>Qty</span>
              <span>Rate</span>
              <span />
            </div>
            {lines.map((line, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_80px_90px_32px] gap-2 items-center px-3 py-2 border-b border-slate-100 last:border-b-0"
              >
                <Input
                  placeholder="Description"
                  value={line.description}
                  onChange={(e) => updateLine(idx, 'description', e.target.value)}
                />
                <Input
                  placeholder="1"
                  type="number"
                  min="0"
                  step="any"
                  value={line.quantity}
                  onChange={(e) => updateLine(idx, 'quantity', e.target.value)}
                />
                <Input
                  placeholder="0.00"
                  type="number"
                  min="0"
                  step="any"
                  value={line.rate}
                  onChange={(e) => updateLine(idx, 'rate', e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                  disabled={lines.length === 1}
                  className="text-navy/30 hover:text-red-500 disabled:opacity-20 transition-colors flex items-center justify-center"
                  aria-label="Remove line"
                >
                  <MinusCircle className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Memo note */}
        <div>
          <Label htmlFor="cm-note">Memo / Note</Label>
          <Input
            id="cm-note"
            placeholder="Optional internal note…"
            value={memoNote}
            onChange={(e) => setMemoNote(e.target.value)}
          />
        </div>

        {/* Live total */}
        <div className="flex items-center justify-between rounded-lg bg-navy/5 px-4 py-3">
          <span className="text-sm font-semibold text-navy/70">Credit Total</span>
          <span className="text-lg font-bold text-navy tabular-nums">
            {formatCurrency(liveTotal.toFixed(2))}
          </span>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Apply to Invoice Modal
// ---------------------------------------------------------------------------

interface ApplyModalProps {
  open: boolean;
  memo: CreditMemo | null;
  onClose: () => void;
  onApplied: () => void;
}

function ApplyModal({ open, memo, onClose, onApplied }: ApplyModalProps) {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [applying, setApplying] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !memo) return;
    setInvoiceId('');
    setAmount('');
    setLoading(true);
    api.get<Invoice[]>(`/api/invoices?customerId=${memo.customerId}`)
      .then((list) => setInvoices(list.filter((i) => i.status !== 'void' && i.status !== 'paid')))
      .catch(() => toast('Failed to load invoices.', 'danger'))
      .finally(() => setLoading(false));
  }, [open, memo]);

  // Pre-fill amount from selected invoice's balanceDue capped by unapplied
  useEffect(() => {
    if (!invoiceId || !memo) return;
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv) return;
    const cap = Math.min(Number(inv.balanceDue), Number(memo.unapplied));
    setAmount(cap.toFixed(2));
  }, [invoiceId, invoices, memo]);

  async function handleApply() {
    if (!memo) return;
    if (!invoiceId) { toast('Select an invoice.', 'danger'); return; }
    if (!amount || parseFloat(amount) <= 0) { toast('Enter a valid amount.', 'danger'); return; }

    setApplying(true);
    try {
      await api.post(`/api/credit-memos/${memo.id}`, {
        action: 'apply',
        invoiceId,
        amount,
      });
      toast('Credit applied to invoice.', 'success');
      onApplied();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to apply credit.';
      toast(msg, 'danger');
    } finally {
      setApplying(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Apply Credit Memo #${memo?.memoNumber ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={applying}>Cancel</Button>
          <Button onClick={handleApply} disabled={applying || loading}>
            {applying ? 'Applying…' : 'Apply Credit'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {memo && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
            Unapplied balance:{' '}
            <span className="font-bold">{formatCurrency(memo.unapplied)}</span>
          </div>
        )}

        <div>
          <Label htmlFor="apply-inv">Invoice to Apply To *</Label>
          {loading ? (
            <p className="text-sm text-navy/40 py-2">Loading invoices…</p>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-navy/40 py-2">No open invoices for this customer.</p>
          ) : (
            <Select
              id="apply-inv"
              value={invoiceId}
              onChange={(e) => setInvoiceId(e.target.value)}
            >
              <option value="">Select an invoice…</option>
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  #{inv.invoiceNumber} — Balance: {formatCurrency(inv.balanceDue)}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div>
          <Label htmlFor="apply-amt">Amount to Apply *</Label>
          <Input
            id="apply-amt"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Void confirmation modal
// ---------------------------------------------------------------------------

interface VoidModalProps {
  open: boolean;
  memoNumber: number | null;
  onConfirm: () => void;
  onClose: () => void;
  voiding: boolean;
}

function VoidModal({ open, memoNumber, onConfirm, onClose, voiding }: VoidModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Void Credit Memo"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={voiding}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={voiding}>
            {voiding ? 'Voiding…' : 'Void Credit Memo'}
          </Button>
        </>
      }
    >
      <p className="text-navy/80 text-sm">
        Are you sure you want to void{' '}
        <strong>Credit Memo #{memoNumber}</strong>? This will reverse the GL
        entry and cannot be undone.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function CreditMemosPage() {
  const [memos, setMemos] = useState<CreditMemo[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  const [applyTarget, setApplyTarget] = useState<CreditMemo | null>(null);
  const [voidTarget, setVoidTarget] = useState<CreditMemo | null>(null);
  const [voiding, setVoiding] = useState(false);

  const customerMap = Object.fromEntries(customers.map((c) => [c.id, c.displayName]));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [memoList, custList] = await Promise.all([
        api.get<CreditMemo[]>('/api/credit-memos'),
        api.get<Customer[]>('/api/customers'),
      ]);
      setMemos(memoList);
      setCustomers(custList);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load credit memos.';
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleVoid() {
    if (!voidTarget) return;
    setVoiding(true);
    try {
      await api.del(`/api/credit-memos/${voidTarget.id}`);
      toast(`Credit Memo #${voidTarget.memoNumber} voided.`, 'success');
      setVoidTarget(null);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to void credit memo.';
      toast(msg, 'danger');
    } finally {
      setVoiding(false);
    }
  }

  const totalUnapplied = memos
    .filter((m) => m.status !== 'void')
    .reduce((s, m) => s + Number(m.unapplied), 0);

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Credit Memos"
        icon={FileX}
        action={
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> New Credit Memo
          </Button>
        }
      />

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-navy/40 text-sm">
            Loading credit memos…
          </div>
        ) : memos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-navy/40">
            <FileX className="h-10 w-10 opacity-30" />
            <p className="text-sm">No credit memos yet. Create one to get started.</p>
          </div>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Memo #</Th>
                <Th>Customer</Th>
                <Th>Date</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Unapplied</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </Tr>
            </thead>
            <tbody>
              {memos.map((m) => (
                <Tr key={m.id}>
                  <Td className="font-semibold text-navy">#{m.memoNumber}</Td>
                  <Td>{customerMap[m.customerId] ?? m.customerId}</Td>
                  <Td className="text-navy/70">{m.date ? m.date.slice(0, 10) : '—'}</Td>
                  <Td className="text-right tabular-nums font-medium">
                    {formatCurrency(m.total)}
                  </Td>
                  <Td className="text-right tabular-nums font-medium">
                    {formatCurrency(m.unapplied)}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(m.status)}>{statusLabel(m.status)}</Badge>
                  </Td>
                  <Td className="text-right">
                    <span className="inline-flex items-center gap-3">
                      {m.status === 'open' && Number(m.unapplied) > 0 && (
                        <button
                          onClick={() => setApplyTarget(m)}
                          className="inline-flex items-center gap-1 text-xs text-navy/40 hover:text-electric transition-colors font-medium"
                          title="Apply to Invoice"
                        >
                          Apply
                        </button>
                      )}
                      {m.status !== 'void' && (
                        <button
                          onClick={() => setVoidTarget(m)}
                          className="inline-flex items-center gap-1 text-xs text-navy/40 hover:text-red-500 transition-colors font-medium"
                          title="Void credit memo"
                        >
                          Void
                        </button>
                      )}
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {memos.length > 0 && !loading && (
        <div className="mt-4 flex gap-6 text-sm text-navy/50">
          <span>
            {memos.length} credit memo{memos.length !== 1 ? 's' : ''}
          </span>
          <span>
            Total unapplied:{' '}
            <span className="font-semibold text-navy/70">
              {formatCurrency(totalUnapplied.toFixed(2))}
            </span>
          </span>
        </div>
      )}

      <NewMemoModal
        open={showNew}
        onClose={() => setShowNew(false)}
        customers={customers}
        onCreated={fetchData}
      />

      <ApplyModal
        open={!!applyTarget}
        memo={applyTarget}
        onClose={() => setApplyTarget(null)}
        onApplied={fetchData}
      />

      <VoidModal
        open={!!voidTarget}
        memoNumber={voidTarget?.memoNumber ?? null}
        onConfirm={handleVoid}
        onClose={() => setVoidTarget(null)}
        voiding={voiding}
      />
    </main>
  );
}
