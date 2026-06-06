'use client';

import { useEffect, useState, useCallback } from 'react';
import { FileText, Plus, Trash2, PlusCircle, MinusCircle, Download, Mail } from 'lucide-react';
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
  date: string;
  dueDate: string | null;
  total: string;
  balanceDue: string;
  status: 'open' | 'partial' | 'paid' | 'void';
}

interface LineRow {
  description: string;
  quantity: string;
  rate: string;
}

type DiscountType = 'amount' | 'percent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusTone(status: Invoice['status']): 'info' | 'warning' | 'success' | 'neutral' {
  if (status === 'open') return 'info';
  if (status === 'partial') return 'warning';
  if (status === 'paid') return 'success';
  return 'neutral';
}

function statusLabel(status: Invoice['status']): string {
  if (status === 'open') return 'Open';
  if (status === 'partial') return 'Partial';
  if (status === 'paid') return 'Paid';
  return 'Void';
}

function computeLineTotal(line: LineRow): number {
  const qty = parseFloat(line.quantity) || 0;
  const rate = parseFloat(line.rate) || 0;
  return qty * rate;
}

function computeTotal(lines: LineRow[], discount: string, discountType: DiscountType): number {
  const subtotal = lines.reduce((sum, l) => sum + computeLineTotal(l), 0);
  const discValue = parseFloat(discount) || 0;
  const discAmount = discountType === 'percent'
    ? subtotal * (discValue / 100)
    : discValue;
  return Math.max(0, subtotal - discAmount);
}

const EMPTY_LINE: LineRow = { description: '', quantity: '', rate: '' };

// ---------------------------------------------------------------------------
// New Invoice Modal
// ---------------------------------------------------------------------------

interface NewInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  customers: Customer[];
  onCreated: () => void;
}

function NewInvoiceModal({ open, onClose, customers, onCreated }: NewInvoiceModalProps) {
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [discount, setDiscount] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('amount');
  const [currency, setCurrency] = useState('');
  const [exchangeRate, setExchangeRate] = useState('');
  const [lines, setLines] = useState<LineRow[]>([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (open) {
      setCustomerId('');
      setDate(new Date().toISOString().slice(0, 10));
      setDueDate('');
      setDiscount('');
      setDiscountType('amount');
      setCurrency('');
      setExchangeRate('');
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

  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  const liveTotal = computeTotal(lines, discount, discountType);

  async function handleSubmit() {
    if (!customerId) { toast('Please select a customer.', 'danger'); return; }
    if (!date) { toast('Please enter an invoice date.', 'danger'); return; }
    const validLines = lines.filter((l) => l.description || l.quantity || l.rate);
    if (validLines.length === 0) { toast('Add at least one line item.', 'danger'); return; }
    for (let i = 0; i < validLines.length; i++) {
      const l = validLines[i];
      if (!l.quantity || parseFloat(l.quantity) <= 0) {
        toast(`Line ${i + 1}: quantity must be a positive number.`, 'danger'); return;
      }
      if (!l.rate || parseFloat(l.rate) < 0) {
        toast(`Line ${i + 1}: rate cannot be negative.`, 'danger'); return;
      }
    }

    setSaving(true);
    try {
      await api.post('/api/invoices', {
        customerId,
        date,
        dueDate: dueDate || undefined,
        discount: discount || undefined,
        discountType,
        currency: currency || undefined,
        exchangeRate: exchangeRate || undefined,
        lines: validLines.map((l) => ({
          description: l.description || null,
          quantity: l.quantity,
          rate: l.rate,
        })),
      });
      toast('Invoice created.', 'success');
      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create invoice.';
      toast(msg, 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Invoice"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Create Invoice'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Customer */}
        <div>
          <Label htmlFor="inv-customer">Customer *</Label>
          <Select
            id="inv-customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.displayName}</option>
            ))}
          </Select>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="inv-date">Invoice Date *</Label>
            <Input
              id="inv-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="inv-due">Due Date</Label>
            <Input
              id="inv-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="mb-0">Line Items</Label>
            <button
              type="button"
              onClick={addLine}
              className="text-electric hover:text-electric/80 flex items-center gap-1 text-sm font-medium"
            >
              <PlusCircle className="h-4 w-4" /> Add line
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 overflow-hidden">
            {/* Header row */}
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
                  onClick={() => removeLine(idx)}
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

        {/* Discount */}
        <div>
          <Label>Discount</Label>
          <div className="flex gap-2">
            {/* Type toggle */}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
              <button
                type="button"
                onClick={() => setDiscountType('amount')}
                className={`px-3 py-2 text-xs font-semibold transition-colors ${
                  discountType === 'amount'
                    ? 'bg-electric text-white'
                    : 'bg-white text-navy/60 hover:bg-slate-50'
                }`}
              >
                $
              </button>
              <button
                type="button"
                onClick={() => setDiscountType('percent')}
                className={`px-3 py-2 text-xs font-semibold transition-colors ${
                  discountType === 'percent'
                    ? 'bg-electric text-white'
                    : 'bg-white text-navy/60 hover:bg-slate-50'
                }`}
              >
                %
              </button>
            </div>
            <Input
              id="inv-discount"
              placeholder={discountType === 'percent' ? '0' : '0.00'}
              type="number"
              min="0"
              max={discountType === 'percent' ? 100 : undefined}
              step="any"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          {discountType === 'percent' && discount && (
            <p className="mt-1 text-xs text-navy/50">
              = {formatCurrency(
                (lines.reduce((s, l) => s + computeLineTotal(l), 0) * (parseFloat(discount) / 100)).toFixed(2)
              )} off
            </p>
          )}
        </div>

        {/* Foreign currency (optional) */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="inv-currency">Currency (optional)</Label>
            <Input
              id="inv-currency"
              placeholder="e.g. EUR"
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <Label htmlFor="inv-fx">Exchange Rate</Label>
            <Input
              id="inv-fx"
              placeholder="1.00"
              type="number"
              min="0.0001"
              step="any"
              value={exchangeRate}
              disabled={!currency}
              onChange={(e) => setExchangeRate(e.target.value)}
            />
          </div>
        </div>

        {/* Live total */}
        <div className="flex items-center justify-between rounded-lg bg-navy/5 px-4 py-3">
          <span className="text-sm font-semibold text-navy/70">
            Estimated Total{currency ? ` (${currency})` : ''}
          </span>
          <span className="text-lg font-bold text-navy tabular-nums">
            {formatCurrency(liveTotal.toFixed(2), currency || 'USD')}
          </span>
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
  invoiceNumber: number | null;
  onConfirm: () => void;
  onClose: () => void;
  voiding: boolean;
}

function VoidModal({ open, invoiceNumber, onConfirm, onClose, voiding }: VoidModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Void Invoice"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={voiding}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={voiding}>
            {voiding ? 'Voiding…' : 'Void Invoice'}
          </Button>
        </>
      }
    >
      <p className="text-navy/80 text-sm">
        Are you sure you want to void{' '}
        <strong>Invoice #{invoiceNumber}</strong>? This will reverse the GL
        entry and cannot be undone.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  // Void state
  const [voidTarget, setVoidTarget] = useState<Invoice | null>(null);
  const [voiding, setVoiding] = useState(false);

  // Email state
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [emailTarget, setEmailTarget] = useState<Invoice | null>(null);
  const [emailTo, setEmailTo] = useState('');
  const [emailing, setEmailing] = useState(false);

  const customerMap = Object.fromEntries(customers.map((c) => [c.id, c.displayName]));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [invList, custList, emailStatus] = await Promise.all([
        api.get<Invoice[]>('/api/invoices'),
        api.get<Customer[]>('/api/customers'),
        api.get<{ configured: boolean }>('/api/email/status'),
      ]);
      setInvoices(invList);
      setCustomers(custList);
      setEmailConfigured(emailStatus.configured);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load invoices.';
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
      await api.del(`/api/invoices/${voidTarget.id}`);
      toast(`Invoice #${voidTarget.invoiceNumber} voided.`, 'success');
      setVoidTarget(null);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to void invoice.';
      toast(msg, 'danger');
    } finally {
      setVoiding(false);
    }
  }

  async function handleEmail() {
    if (!emailTarget) return;
    setEmailing(true);
    try {
      await api.post(`/api/invoices/${emailTarget.id}/email`, emailTo ? { to: emailTo } : {});
      toast(`Invoice #${emailTarget.invoiceNumber} emailed successfully.`, 'success');
      setEmailTarget(null);
      setEmailTo('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send email.';
      toast(msg, 'danger');
    } finally {
      setEmailing(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Invoices"
        icon={FileText}
        action={
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> New Invoice
          </Button>
        }
      />

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-navy/40 text-sm">
            Loading invoices…
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-navy/40">
            <FileText className="h-10 w-10 opacity-30" />
            <p className="text-sm">No invoices yet. Create one to get started.</p>
          </div>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Invoice #</Th>
                <Th>Customer</Th>
                <Th>Date</Th>
                <Th>Due Date</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Balance Due</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </Tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <Tr key={inv.id}>
                  <Td className="font-semibold text-navy">#{inv.invoiceNumber}</Td>
                  <Td>{customerMap[inv.customerId] ?? inv.customerId}</Td>
                  <Td className="text-navy/70">{inv.date ? inv.date.slice(0, 10) : '—'}</Td>
                  <Td className="text-navy/70">{inv.dueDate ? inv.dueDate.slice(0, 10) : '—'}</Td>
                  <Td className="text-right tabular-nums font-medium">
                    {formatCurrency(inv.total)}
                  </Td>
                  <Td className="text-right tabular-nums font-medium">
                    {formatCurrency(inv.balanceDue)}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(inv.status)}>{statusLabel(inv.status)}</Badge>
                  </Td>
                  <Td className="text-right">
                    <span className="inline-flex items-center gap-3">
                      <button
                        onClick={() => window.open(`/api/invoices/${inv.id}/pdf`, '_blank')}
                        className="inline-flex items-center gap-1 text-xs text-navy/40 hover:text-electric transition-colors font-medium"
                        title="View PDF"
                      >
                        <Download className="h-3.5 w-3.5" /> PDF
                      </button>
                      {inv.status !== 'void' && (
                        <button
                          onClick={() => { setEmailTarget(inv); setEmailTo(''); }}
                          className="inline-flex items-center gap-1 text-xs text-navy/40 hover:text-electric transition-colors font-medium"
                          title={emailConfigured ? 'Email invoice' : 'Email not configured'}
                        >
                          <Mail className="h-3.5 w-3.5" /> Email
                        </button>
                      )}
                      {inv.status !== 'void' && (
                        <button
                          onClick={() => setVoidTarget(inv)}
                          className="inline-flex items-center gap-1 text-xs text-navy/40 hover:text-red-500 transition-colors font-medium"
                          title="Void invoice"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Void
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

      {/* Summary footer */}
      {invoices.length > 0 && !loading && (
        <div className="mt-4 flex gap-6 text-sm text-navy/50">
          <span>
            {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
          </span>
          <span>
            Open:{' '}
            <span className="font-semibold text-navy/70">
              {invoices.filter((i) => i.status === 'open' || i.status === 'partial').length}
            </span>
          </span>
          <span>
            Total outstanding:{' '}
            <span className="font-semibold text-navy/70">
              {formatCurrency(
                invoices
                  .filter((i) => i.status !== 'void')
                  .reduce((s, i) => s + Number(i.balanceDue), 0)
                  .toFixed(2),
              )}
            </span>
          </span>
        </div>
      )}

      <NewInvoiceModal
        open={showNew}
        onClose={() => setShowNew(false)}
        customers={customers}
        onCreated={fetchData}
      />

      <VoidModal
        open={!!voidTarget}
        invoiceNumber={voidTarget?.invoiceNumber ?? null}
        onConfirm={handleVoid}
        onClose={() => setVoidTarget(null)}
        voiding={voiding}
      />

      {/* Email Invoice Modal */}
      <Modal
        open={!!emailTarget}
        onClose={() => { setEmailTarget(null); setEmailTo(''); }}
        title={`Email Invoice #${emailTarget?.invoiceNumber ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setEmailTarget(null); setEmailTo(''); }} disabled={emailing}>
              Cancel
            </Button>
            <Button onClick={handleEmail} disabled={emailing || !emailConfigured}>
              {emailing ? 'Sending…' : 'Send Email'}
            </Button>
          </>
        }
      >
        {!emailConfigured && (
          <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            <strong>SMTP not configured.</strong> Set <code>SMTP_HOST</code>, <code>SMTP_PORT</code>,{' '}
            <code>SMTP_USER</code>, <code>SMTP_PASS</code>, and <code>SMTP_FROM</code> environment
            variables to enable email sending.
          </div>
        )}
        <div>
          <Label htmlFor="email-to">Recipient Email</Label>
          <Input
            id="email-to"
            type="email"
            placeholder="Leave blank to use customer email on file"
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            disabled={emailing}
          />
          <p className="mt-1 text-xs text-navy/50">
            The invoice PDF will be attached to the email.
          </p>
        </div>
      </Modal>
    </main>
  );
}
