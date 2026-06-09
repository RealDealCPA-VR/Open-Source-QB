'use client';

import { useEffect, useState, useCallback } from 'react';
import { FileCheck, Plus, ArrowRight, PlusCircle, MinusCircle } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
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
  Spinner,
  toast,
} from '@/components/ui';
import { api } from '@/lib/client';
import { formatCurrency } from '@/lib/money';
import { formatDate } from '@/lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Customer {
  id: string;
  displayName: string;
}

interface SalesOrder {
  id: string;
  orderNumber: number;
  customerId: string;
  date: string;
  total: string;
  status: string;
  convertedInvoiceId: string | null;
}

interface LineRow {
  description: string;
  quantity: string;
  rate: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StatusTone = 'info' | 'success' | 'neutral' | 'warning';

function statusTone(status: string): StatusTone {
  if (status === 'open') return 'info';
  if (status === 'closed') return 'success';
  if (status === 'void') return 'neutral';
  return 'warning';
}

function statusLabel(status: string): string {
  if (status === 'open') return 'Open';
  if (status === 'closed') return 'Converted';
  if (status === 'void') return 'Void';
  return status;
}

function computeLineTotal(line: LineRow): number {
  return (parseFloat(line.quantity) || 0) * (parseFloat(line.rate) || 0);
}

function computeTotal(lines: LineRow[]): number {
  return lines.reduce((sum, l) => sum + computeLineTotal(l), 0);
}

const EMPTY_LINE: LineRow = { description: '', quantity: '', rate: '' };

// ---------------------------------------------------------------------------
// New Sales Order Modal
// ---------------------------------------------------------------------------

interface NewOrderModalProps {
  open: boolean;
  onClose: () => void;
  customers: Customer[];
  onCreated: () => void;
}

function NewOrderModal({ open, onClose, customers, onCreated }: NewOrderModalProps) {
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<LineRow[]>([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCustomerId('');
      setDate(new Date().toISOString().slice(0, 10));
      setMemo('');
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

  const liveTotal = computeTotal(lines);

  async function handleSubmit() {
    if (!customerId) { toast('Please select a customer.', 'danger'); return; }
    if (!date) { toast('Please enter an order date.', 'danger'); return; }
    const validLines = lines.filter((l) => l.description || l.quantity || l.rate);
    if (validLines.length === 0) { toast('Add at least one line item.', 'danger'); return; }
    for (let i = 0; i < validLines.length; i++) {
      const l = validLines[i];
      if (!l.quantity || parseFloat(l.quantity) <= 0) {
        toast(`Line ${i + 1}: quantity must be a positive number.`, 'danger'); return;
      }
      if (l.rate === '' || parseFloat(l.rate) < 0) {
        toast(`Line ${i + 1}: rate cannot be negative.`, 'danger'); return;
      }
    }

    setSaving(true);
    try {
      await api.post('/api/sales-orders', {
        customerId,
        date,
        memo: memo || undefined,
        lines: validLines.map((l) => ({
          description: l.description || null,
          quantity: l.quantity,
          rate: l.rate,
        })),
      });
      toast('Sales order created.', 'success');
      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create sales order.';
      toast(msg, 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Sales Order"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} loading={saving}>
            Create Sales Order
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Customer */}
        <div>
          <Label htmlFor="so-customer">Customer *</Label>
          <Select
            id="so-customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            autoFocus
          >
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.displayName}</option>
            ))}
          </Select>
        </div>

        {/* Date */}
        <div>
          <Label htmlFor="so-date">Order Date *</Label>
          <Input
            id="so-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {/* Memo */}
        <div>
          <Label htmlFor="so-memo">Memo</Label>
          <Input
            id="so-memo"
            placeholder="Optional note…"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
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

        {/* Live total */}
        <div className="flex items-center justify-between rounded-lg bg-navy/5 px-4 py-3">
          <span className="text-sm font-semibold text-navy/70">Estimated Total</span>
          <span className="text-lg font-bold text-navy tabular-nums">
            {formatCurrency(liveTotal.toFixed(2))}
          </span>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Convert confirmation modal
// ---------------------------------------------------------------------------

interface ConvertModalProps {
  open: boolean;
  order: SalesOrder | null;
  onConfirm: () => void;
  onClose: () => void;
  converting: boolean;
}

function ConvertModal({ open, order, onConfirm, onClose, converting }: ConvertModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Convert to Invoice"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={converting}>Cancel</Button>
          <Button onClick={onConfirm} loading={converting}>
            Convert to Invoice
          </Button>
        </>
      }
    >
      <p className="text-navy/80 text-sm">
        Convert <strong>Sales Order #{order?.orderNumber}</strong> ({formatCurrency(order?.total ?? '0')}) to an invoice?
        This will post the A/R journal entry and close the sales order.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function SalesOrdersPage() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  // Convert state
  const [convertTarget, setConvertTarget] = useState<SalesOrder | null>(null);
  const [converting, setConverting] = useState(false);

  const customerMap = Object.fromEntries(customers.map((c) => [c.id, c.displayName]));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [orderList, custList] = await Promise.all([
        api.get<SalesOrder[]>('/api/sales-orders'),
        api.get<Customer[]>('/api/customers'),
      ]);
      setOrders(orderList);
      setCustomers(custList);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load sales orders.';
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleConvert() {
    if (!convertTarget) return;
    setConverting(true);
    try {
      await api.post(`/api/sales-orders/${convertTarget.id}`, { action: 'convert' });
      toast(`Sales Order #${convertTarget.orderNumber} converted to invoice.`, 'success');
      setConvertTarget(null);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to convert sales order.';
      toast(msg, 'danger');
    } finally {
      setConverting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Sales Orders"
        icon={FileCheck}
        action={
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> New Sales Order
          </Button>
        }
      />

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-navy/40">
            <Spinner className="h-6 w-6" />
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon={FileCheck}
            title="No sales orders yet"
            message="Create your first sales order to get started."
            action={
              <Button onClick={() => setShowNew(true)}>
                <Plus className="h-4 w-4" /> New Sales Order
              </Button>
            }
          />
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Order #</Th>
                <Th>Customer</Th>
                <Th>Date</Th>
                <Th numeric>Total</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </Tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <Tr key={order.id}>
                  <Td className="font-semibold text-navy">#{order.orderNumber}</Td>
                  <Td>{customerMap[order.customerId] ?? '—'}</Td>
                  <Td className="text-navy/70">{formatDate(order.date)}</Td>
                  <Td numeric className="font-medium">
                    {formatCurrency(order.total)}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge>
                  </Td>
                  <Td className="text-right">
                    {order.status === 'open' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConvertTarget(order)}
                        title="Convert to Invoice"
                      >
                        <ArrowRight className="h-3.5 w-3.5" /> Convert to Invoice
                      </Button>
                    )}
                    {order.status === 'closed' && (
                      <span className="text-xs text-navy/30 italic">Converted</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Summary footer */}
      {orders.length > 0 && !loading && (
        <div className="mt-4 flex gap-6 text-sm text-navy/50">
          <span>
            {orders.length} order{orders.length !== 1 ? 's' : ''}
          </span>
          <span>
            Open:{' '}
            <span className="font-semibold text-navy/70">
              {orders.filter((o) => o.status === 'open').length}
            </span>
          </span>
          <span>
            Open total:{' '}
            <span className="font-semibold text-navy/70">
              {formatCurrency(
                orders
                  .filter((o) => o.status === 'open')
                  .reduce((s, o) => s + Number(o.total), 0)
                  .toFixed(2),
              )}
            </span>
          </span>
        </div>
      )}

      <NewOrderModal
        open={showNew}
        onClose={() => setShowNew(false)}
        customers={customers}
        onCreated={fetchData}
      />

      <ConvertModal
        open={!!convertTarget}
        order={convertTarget}
        onConfirm={handleConvert}
        onClose={() => setConvertTarget(null)}
        converting={converting}
      />
    </main>
  );
}
