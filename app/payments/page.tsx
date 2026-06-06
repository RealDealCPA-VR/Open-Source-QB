'use client';

import { useEffect, useState, useCallback } from 'react';
import { CreditCard, Plus } from 'lucide-react';
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
  Toaster,
  toast,
} from '@/components/ui';
import { api } from '@/lib/client';
import { formatCurrency } from '@/lib/money';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Payment {
  id: string;
  date: string;
  customerId: string;
  method: string;
  amount: string;
  unapplied: string;
  reference: string | null;
}

interface Customer {
  id: string;
  displayName: string;
}

interface Invoice {
  id: string;
  date: string;
  total: string;
  balanceDue: string;
  status: string;
  memo: string | null;
}

interface Application {
  invoiceId: string;
  amountApplied: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  check: 'Check',
  credit_card: 'Credit Card',
  ach: 'ACH',
  bank_transfer: 'Bank Transfer',
  other: 'Other',
};

function methodBadgeTone(
  method: string,
): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (method) {
    case 'cash':
      return 'success';
    case 'check':
      return 'info';
    case 'credit_card':
      return 'warning';
    case 'ach':
    case 'bank_transfer':
      return 'neutral';
    default:
      return 'neutral';
  }
}

function formatDate(isoStr: string) {
  const d = new Date(isoStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Sum the amountApplied values across all applications for display only (Number() per rules).
function sumApplications(apps: Application[]): number {
  return apps.reduce((acc, a) => acc + (Number(a.amountApplied) || 0), 0);
}

// ---------------------------------------------------------------------------
// Receive Payment Modal
// ---------------------------------------------------------------------------

interface ReceivePaymentModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  customers: Customer[];
}

function ReceivePaymentModal({ open, onClose, onSaved, customers }: ReceivePaymentModalProps) {
  const today = new Date().toISOString().slice(0, 10);

  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<string>('check');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(false);
  // Map from invoiceId -> amountApplied string
  const [applicationAmounts, setApplicationAmounts] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (!open) {
      setCustomerId('');
      setDate(today);
      setMethod('check');
      setAmount('');
      setReference('');
      setInvoices([]);
      setApplicationAmounts({});
    }
  }, [open, today]);

  // Fetch open invoices when customer changes
  useEffect(() => {
    if (!customerId) {
      setInvoices([]);
      setApplicationAmounts({});
      return;
    }
    setInvoicesLoading(true);
    api
      .get<Invoice[]>(`/api/invoices?customerId=${customerId}&status=open`)
      .then((rows) => {
        // API may return an array directly or wrapped; handle both shapes.
        const list = Array.isArray(rows) ? rows : (rows as { invoices?: Invoice[] }).invoices ?? [];
        // Show only invoices with a positive balance due
        const open = list.filter((inv) => Number(inv.balanceDue) > 0);
        setInvoices(open);
        setApplicationAmounts({});
      })
      .catch((err) => {
        toast(err.message ?? 'Failed to load invoices', 'danger');
        setInvoices([]);
      })
      .finally(() => setInvoicesLoading(false));
  }, [customerId]);

  const setAppAmount = (invoiceId: string, value: string) => {
    setApplicationAmounts((prev) => ({ ...prev, [invoiceId]: value }));
  };

  const applications: Application[] = Object.entries(applicationAmounts)
    .filter(([, v]) => v && Number(v) > 0)
    .map(([invoiceId, amountApplied]) => ({ invoiceId, amountApplied }));

  const appliedTotal = sumApplications(applications);

  async function handleSubmit() {
    if (!customerId) { toast('Please select a customer.', 'danger'); return; }
    if (!date) { toast('Please enter a date.', 'danger'); return; }
    if (!amount || Number(amount) <= 0) { toast('Please enter a valid payment amount.', 'danger'); return; }

    setSaving(true);
    try {
      await api.post('/api/payments', {
        customerId,
        date,
        method,
        amount,
        reference: reference.trim() || null,
        applications,
      });
      toast('Payment recorded successfully.', 'success');
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save payment';
      toast(msg, 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Receive Payment"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Record Payment'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Customer */}
        <div>
          <Label htmlFor="pm-customer">Customer</Label>
          <Select
            id="pm-customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
          >
            <option value="">— Select customer —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.displayName}
              </option>
            ))}
          </Select>
        </div>

        {/* Date + Method row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pm-date">Payment Date</Label>
            <Input
              id="pm-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="pm-method">Method</Label>
            <Select
              id="pm-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="credit_card">Credit Card</option>
              <option value="ach">ACH</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="other">Other</option>
            </Select>
          </div>
        </div>

        {/* Amount + Reference row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pm-amount">Total Amount Received</Label>
            <Input
              id="pm-amount"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="pm-ref">Reference / Check #</Label>
            <Input
              id="pm-ref"
              type="text"
              placeholder="Optional"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        </div>

        {/* Open invoices */}
        {customerId && (
          <div>
            <Label>Apply to Open Invoices</Label>
            {invoicesLoading ? (
              <p className="text-sm text-navy/50 py-2">Loading invoices…</p>
            ) : invoices.length === 0 ? (
              <p className="text-sm text-navy/40 py-2 italic">
                No open invoices for this customer.
              </p>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-hidden mt-1">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="py-2 px-3 text-left font-semibold text-navy/70">Date</th>
                      <th className="py-2 px-3 text-right font-semibold text-navy/70">Invoice Total</th>
                      <th className="py-2 px-3 text-right font-semibold text-navy/70">Balance Due</th>
                      <th className="py-2 px-3 text-right font-semibold text-navy/70">Amount to Apply</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-slate-100 hover:bg-electric/5">
                        <td className="py-2 px-3 text-navy">{formatDate(inv.date)}</td>
                        <td className="py-2 px-3 text-right text-navy tabular-nums">
                          {formatCurrency(inv.total)}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-navy tabular-nums">
                          {formatCurrency(inv.balanceDue)}
                        </td>
                        <td className="py-2 px-3">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            max={inv.balanceDue}
                            placeholder="0.00"
                            value={applicationAmounts[inv.id] ?? ''}
                            onChange={(e) => setAppAmount(inv.id, e.target.value)}
                            className="text-right"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Applied total summary */}
            {applications.length > 0 && (
              <div className="flex justify-between items-center mt-2 px-1 text-sm">
                <span className="text-navy/60">Total Applied</span>
                <span className="font-semibold text-navy tabular-nums">
                  {formatCurrency(appliedTotal)}
                </span>
              </div>
            )}
            {amount && Number(amount) > 0 && applications.length > 0 && (
              <div className="flex justify-between items-center px-1 text-sm">
                <span className="text-navy/60">Unapplied</span>
                <span
                  className={
                    'font-semibold tabular-nums ' +
                    (Number(amount) - appliedTotal > 0 ? 'text-gold' : 'text-emerald')
                  }
                >
                  {formatCurrency(Number(amount) - appliedTotal)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerMap, setCustomerMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ payments: Payment[] } | Payment[]>('/api/payments');
      const list = Array.isArray(data) ? data : (data as { payments: Payment[] }).payments ?? [];
      setPayments(list);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load payments';
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCustomers = useCallback(async () => {
    try {
      const list = await api.get<Customer[]>('/api/customers');
      const arr = Array.isArray(list) ? list : [];
      setCustomers(arr);
      const map: Record<string, string> = {};
      arr.forEach((c) => { map[c.id] = c.displayName; });
      setCustomerMap(map);
    } catch {
      // Non-fatal; customer names will fall back to IDs.
    }
  }, []);

  useEffect(() => {
    fetchPayments();
    fetchCustomers();
  }, [fetchPayments, fetchCustomers]);

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <Toaster />

      <PageHeader
        title="Receive Payments"
        icon={CreditCard}
        action={
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Receive Payment
          </Button>
        }
      />

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-navy/40 text-sm">Loading payments…</div>
        ) : payments.length === 0 ? (
          <div className="p-12 text-center">
            <CreditCard className="h-12 w-12 text-navy/20 mx-auto mb-3" />
            <p className="text-navy/50 font-medium">No payments recorded yet.</p>
            <p className="text-navy/35 text-sm mt-1">
              Click &quot;Receive Payment&quot; to record a customer payment.
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Customer</Th>
                <Th>Method</Th>
                <Th>Reference</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Unapplied</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <Tr key={p.id}>
                  <Td className="whitespace-nowrap text-navy/70">{formatDate(p.date)}</Td>
                  <Td className="font-medium text-navy">
                    {customerMap[p.customerId] ?? p.customerId}
                  </Td>
                  <Td>
                    <Badge tone={methodBadgeTone(p.method)}>
                      {METHOD_LABELS[p.method] ?? p.method}
                    </Badge>
                  </Td>
                  <Td className="text-navy/60 text-sm">{p.reference ?? '—'}</Td>
                  <Td className="text-right font-semibold text-navy tabular-nums">
                    {formatCurrency(p.amount)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {Number(p.unapplied) > 0 ? (
                      <span className="text-gold font-medium">
                        {formatCurrency(p.unapplied)}
                      </span>
                    ) : (
                      <span className="text-emerald font-medium">
                        {formatCurrency(p.unapplied)}
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ReceivePaymentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={fetchPayments}
        customers={customers}
      />
    </main>
  );
}
