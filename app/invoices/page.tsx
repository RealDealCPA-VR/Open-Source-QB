'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import { FileText, Plus, Trash2, PlusCircle, MinusCircle, Download, Mail, Pencil } from 'lucide-react';
import {
  Button,
  Card,
  ConfirmDialog,
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
import { useFocusParam } from '@/lib/useFocusParam';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Customer {
  id: string;
  displayName: string;
}

interface Item {
  id: string;
  name: string;
  type: 'service' | 'inventory' | 'non_inventory' | 'bundle';
  description: string | null;
  salesPrice: string | null;
  taxable: boolean;
  quantityOnHand: string | null;
}

interface TaxRate {
  id: string;
  name: string;
  rate: string; // fraction, e.g. "0.082500"
}

interface ClassRow {
  id: string;
  name: string;
}

interface Job {
  id: string;
  name: string;
  customerId: string | null;
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

/** Full invoice (GET /api/invoices/:id) used to prefill the edit modal. */
interface InvoiceDetail extends Invoice {
  taxRateId: string | null;
  classId: string | null;
  discount: string;
  discountType: 'amount' | 'percent' | null;
  currency: string | null;
  exchangeRate: string | null;
  memo: string | null;
  lines: Array<{
    id: string;
    itemId: string | null;
    description: string | null;
    quantity: string;
    rate: string;
    taxable: boolean;
    jobId: string | null;
  }>;
}

interface LineRow {
  /** Find-as-you-type item field (datalist); itemId resolves on exact name match. */
  itemName: string;
  itemId: string | null;
  description: string;
  quantity: string;
  rate: string;
  taxable: boolean;
  jobId: string;
}

/** Unbilled billable time & costs (GET /api/billables?customerId=). */
interface BillableCost {
  id: string;
  source: 'bill' | 'expense';
  date: string;
  ref: string | null;
  description: string | null;
  amount: string;
  jobId: string | null;
}

interface BillableTime {
  id: string;
  date: string;
  description: string | null;
  hours: string;
  rate: string;
  amount: string;
  serviceItemId: string | null;
  jobId: string | null;
}

interface Billables {
  costs: BillableCost[];
  time: BillableTime[];
}

interface CustomerPrice {
  itemId: string;
  price: string;
}

type DiscountType = 'amount' | 'percent';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

interface Totals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/** Mirror the service math: tax applies to taxable lines (pre-discount).
 *  Selected billables flow in as extra non-taxable amounts. */
function computeTotals(
  lines: LineRow[],
  discount: string,
  discountType: DiscountType,
  taxRate: number,
  billablesAmount: number,
): Totals {
  const subtotal = lines.reduce((sum, l) => sum + computeLineTotal(l), 0) + billablesAmount;
  const taxableSubtotal = lines.reduce(
    (sum, l) => sum + (l.taxable ? computeLineTotal(l) : 0),
    0,
  );
  const discValue = parseFloat(discount) || 0;
  const discAmount = discountType === 'percent' ? subtotal * (discValue / 100) : discValue;
  const tax = taxableSubtotal * taxRate;
  return {
    subtotal,
    discount: discAmount,
    tax,
    total: Math.max(0, subtotal - discAmount + tax),
  };
}

const EMPTY_LINE: LineRow = {
  itemName: '',
  itemId: null,
  description: '',
  quantity: '',
  rate: '',
  taxable: true,
  jobId: '',
};

// ---------------------------------------------------------------------------
// Invoice Modal (create + edit)
// ---------------------------------------------------------------------------

interface InvoiceModalProps {
  open: boolean;
  /** Full invoice to prefill — null = create mode. */
  editing: InvoiceDetail | null;
  onClose: () => void;
  customers: Customer[];
  items: Item[];
  taxRates: TaxRate[];
  classes: ClassRow[];
  jobs: Job[];
  onSaved: () => void;
}

function InvoiceModal({
  open,
  editing,
  onClose,
  customers,
  items,
  taxRates,
  classes,
  jobs,
  onSaved,
}: InvoiceModalProps) {
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [taxRateId, setTaxRateId] = useState('');
  const [classId, setClassId] = useState('');
  const [discount, setDiscount] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('amount');
  const [currency, setCurrency] = useState('');
  const [exchangeRate, setExchangeRate] = useState('');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<LineRow[]>([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);

  // Customer price levels: itemId → custom price for the selected customer.
  const [customerPrices, setCustomerPrices] = useState<Map<string, string>>(new Map());

  // Billable time & costs (create mode only).
  const [billables, setBillables] = useState<Billables | null>(null);
  const [selectedCostIds, setSelectedCostIds] = useState<Set<string>>(new Set());
  const [selectedTimeIds, setSelectedTimeIds] = useState<Set<string>>(new Set());
  const [markupPercent, setMarkupPercent] = useState('');

  const itemNameById = new Map(items.map((it) => [it.id, it.name]));

  // Reset / prefill form when the modal opens.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setCustomerId(editing.customerId);
      setDate(editing.date ? editing.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
      setDueDate(editing.dueDate ? editing.dueDate.slice(0, 10) : '');
      setTaxRateId(editing.taxRateId ?? '');
      setClassId(editing.classId ?? '');
      // The stored discount is the resolved dollar amount — prefill as a flat amount.
      setDiscount(Number(editing.discount) > 0 ? editing.discount : '');
      setDiscountType('amount');
      setCurrency(editing.currency ?? '');
      setExchangeRate(
        editing.currency && editing.exchangeRate ? String(Number(editing.exchangeRate)) : '',
      );
      setMemo(editing.memo ?? '');
      setLines(
        editing.lines.map((l) => ({
          itemName: l.itemId ? (itemNameById.get(l.itemId) ?? '') : '',
          itemId: l.itemId,
          description: l.description ?? '',
          quantity: String(Number(l.quantity)),
          rate: String(Number(l.rate)),
          taxable: l.taxable,
          jobId: l.jobId ?? '',
        })),
      );
    } else {
      setCustomerId('');
      setDate(new Date().toISOString().slice(0, 10));
      setDueDate('');
      setTaxRateId('');
      setClassId('');
      setDiscount('');
      setDiscountType('amount');
      setCurrency('');
      setExchangeRate('');
      setMemo('');
      setLines([{ ...EMPTY_LINE }]);
    }
    setBillables(null);
    setSelectedCostIds(new Set());
    setSelectedTimeIds(new Set());
    setMarkupPercent('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  // When a customer is selected: load their price level + unbilled billables.
  useEffect(() => {
    if (!open || !customerId) {
      setCustomerPrices(new Map());
      setBillables(null);
      setSelectedCostIds(new Set());
      setSelectedTimeIds(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ prices: CustomerPrice[] }>(
          `/api/customer-prices?customerId=${customerId}`,
        );
        if (!cancelled) {
          setCustomerPrices(new Map((res.prices ?? []).map((p) => [p.itemId, p.price])));
        }
      } catch {
        // Non-fatal — fall back to item sales prices.
      }
      if (!editing) {
        try {
          const b = await api.get<Billables>(`/api/billables?customerId=${customerId}`);
          if (!cancelled) {
            setBillables(b);
            setSelectedCostIds(new Set());
            setSelectedTimeIds(new Set());
          }
        } catch {
          // Non-fatal — billables section just won't show.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, customerId, editing]);

  function updateLine(idx: number, patch: Partial<LineRow>) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  /** Item field changed: resolve exact (case-insensitive) name → auto-fill the line.
   *  Price levels: a customer-specific price (customer_prices) wins over salesPrice. */
  function handleItemInput(idx: number, value: string) {
    const match = items.find((it) => it.name.toLowerCase() === value.trim().toLowerCase());
    if (match) {
      const customerPrice = customerPrices.get(match.id);
      updateLine(idx, {
        itemName: match.name,
        itemId: match.id,
        description: match.description ?? match.name,
        rate: customerPrice != null ? String(Number(customerPrice)) : (match.salesPrice ?? ''),
        taxable: match.taxable,
        quantity: lines[idx].quantity || '1',
      });
      if (customerPrice != null) {
        toast(`Customer price applied for ${match.name}: ${formatCurrency(customerPrice)}`, 'info');
      }
    } else {
      // No item match — stays a manual description line (itemId null).
      updateLine(idx, { itemName: value, itemId: null });
    }
  }

  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function toggleCost(id: string) {
    setSelectedCostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTime(id: string) {
    setSelectedTimeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Jobs available for the selected customer (plus unassigned jobs).
  const customerJobs = jobs.filter((j) => !j.customerId || j.customerId === customerId);
  const selectedRate = taxRates.find((t) => t.id === taxRateId);

  // Selected billables → extra (non-taxable) invoice amount. Markup applies to costs only.
  const markupFactor = 1 + (parseFloat(markupPercent) || 0) / 100;
  const selectedCostsAmount = (billables?.costs ?? [])
    .filter((c) => selectedCostIds.has(c.id))
    .reduce((s, c) => s + Number(c.amount) * markupFactor, 0);
  const selectedTimeAmount = (billables?.time ?? [])
    .filter((t) => selectedTimeIds.has(t.id))
    .reduce((s, t) => s + Number(t.amount), 0);
  const billablesAmount = selectedCostsAmount + selectedTimeAmount;
  const hasBillablesSelected = selectedCostIds.size + selectedTimeIds.size > 0;

  const totals = computeTotals(
    lines,
    discount,
    discountType,
    selectedRate ? parseFloat(selectedRate.rate) || 0 : 0,
    billablesAmount,
  );

  async function handleSubmit() {
    if (!customerId) { toast('Please select a customer.', 'danger'); return; }
    if (!date) { toast('Please enter an invoice date.', 'danger'); return; }
    const validLines = lines.filter((l) => l.itemId || l.description || l.quantity || l.rate);
    if (validLines.length === 0 && !hasBillablesSelected) {
      toast('Add at least one line item or select billables.', 'danger'); return;
    }
    for (let i = 0; i < validLines.length; i++) {
      const l = validLines[i];
      if (!l.quantity || parseFloat(l.quantity) <= 0) {
        toast(`Line ${i + 1}: quantity must be a positive number.`, 'danger'); return;
      }
      if (!l.rate || parseFloat(l.rate) < 0) {
        toast(`Line ${i + 1}: rate cannot be negative.`, 'danger'); return;
      }
    }

    const payload: Record<string, unknown> = {
      customerId,
      date,
      dueDate: dueDate || undefined,
      taxRateId: taxRateId || undefined,
      classId: classId || undefined,
      discount: discount || undefined,
      discountType,
      currency: currency || undefined,
      exchangeRate: exchangeRate || undefined,
      memo: memo || undefined,
      lines: validLines.map((l) => ({
        itemId: l.itemId,
        description: l.description || null,
        quantity: l.quantity,
        rate: l.rate,
        taxable: l.taxable,
        jobId: l.jobId || null,
      })),
    };

    if (!editing && hasBillablesSelected && billables) {
      payload.billables = {
        billLineIds: billables.costs
          .filter((c) => c.source === 'bill' && selectedCostIds.has(c.id))
          .map((c) => c.id),
        expenseLineIds: billables.costs
          .filter((c) => c.source === 'expense' && selectedCostIds.has(c.id))
          .map((c) => c.id),
        timeEntryIds: billables.time.filter((t) => selectedTimeIds.has(t.id)).map((t) => t.id),
        markupPercent: markupPercent || undefined,
      };
    }

    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/api/invoices/${editing.id}`, payload);
        toast(`Invoice #${editing.invoiceNumber} updated.`, 'success');
      } else {
        await api.post('/api/invoices', payload);
        toast('Invoice created.', 'success');
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save invoice.';
      toast(msg, 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      size="lg"
      open={open}
      onClose={onClose}
      title={editing ? `Edit Invoice #${editing.invoiceNumber}` : 'New Invoice'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} loading={saving}>
            {editing ? 'Save Changes' : 'Create Invoice'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {editing && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            Editing re-posts this invoice&apos;s GL entry (and any COGS). Allowed only while no
            payments are applied and the period is open.
          </div>
        )}

        {/* Customer */}
        <div>
          <Label htmlFor="inv-customer">Customer *</Label>
          <Select
            id="inv-customer"
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

        {/* Tax rate + class */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="inv-taxrate">Sales Tax</Label>
            <Select
              id="inv-taxrate"
              value={taxRateId}
              onChange={(e) => setTaxRateId(e.target.value)}
            >
              <option value="">No tax</option>
              {taxRates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({(parseFloat(t.rate) * 100).toFixed(2)}%)
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="inv-class">Class</Label>
            <Select
              id="inv-class"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
            >
              <option value="">No class</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
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

          {/* Find-as-you-type item options shared by all line rows */}
          <datalist id="inv-item-options">
            {items.map((it) => (
              <option key={it.id} value={it.name}>
                {it.type === 'inventory'
                  ? `${formatCurrency(customerPrices.get(it.id) ?? it.salesPrice ?? '0')} · ${Number(it.quantityOnHand ?? 0)} on hand`
                  : formatCurrency(customerPrices.get(it.id) ?? it.salesPrice ?? '0')}
              </option>
            ))}
          </datalist>

          <div className="rounded-lg border border-slate-200 overflow-hidden">
            {lines.map((line, idx) => (
              <div
                key={idx}
                className="px-3 py-2 border-b border-slate-100 last:border-b-0 space-y-2"
              >
                {/* Row 1: item lookup + description + remove */}
                <div className="grid grid-cols-[1fr_1.2fr_28px] gap-2 items-center">
                  <Input
                    placeholder="Item (type to search)…"
                    list="inv-item-options"
                    value={line.itemName}
                    onChange={(e) => handleItemInput(idx, e.target.value)}
                    className={line.itemId ? 'border-electric/50' : undefined}
                  />
                  <Input
                    placeholder="Description"
                    value={line.description}
                    onChange={(e) => updateLine(idx, { description: e.target.value })}
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
                {/* Row 2: qty, rate, job, taxable, amount */}
                <div className="grid grid-cols-[64px_84px_1fr_52px_76px] gap-2 items-center">
                  <Input
                    placeholder="Qty"
                    type="number"
                    min="0"
                    step="any"
                    value={line.quantity}
                    onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                  />
                  <Input
                    placeholder="Rate"
                    type="number"
                    min="0"
                    step="any"
                    value={line.rate}
                    onChange={(e) => updateLine(idx, { rate: e.target.value })}
                  />
                  <Select
                    value={line.jobId}
                    onChange={(e) => updateLine(idx, { jobId: e.target.value })}
                    aria-label="Customer:Job"
                  >
                    <option value="">No job</option>
                    {customerJobs.map((j) => (
                      <option key={j.id} value={j.id}>{j.name}</option>
                    ))}
                  </Select>
                  <label className="flex items-center gap-1 text-xs text-navy/60 select-none justify-center">
                    <input
                      type="checkbox"
                      checked={line.taxable}
                      onChange={(e) => updateLine(idx, { taxable: e.target.checked })}
                      className="accent-electric"
                    />
                    Tax
                  </label>
                  <span className="text-right text-xs font-semibold text-navy/70 tabular-nums">
                    {formatCurrency(computeLineTotal(line).toFixed(2))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Billable time & costs (create mode, customer selected, anything unbilled) */}
        {!editing && billables && (billables.costs.length > 0 || billables.time.length > 0) && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="mb-0">Add billable time &amp; costs</Label>
              <div className="flex items-center gap-1 text-xs text-navy/60">
                <span>Markup %</span>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={markupPercent}
                  onChange={(e) => setMarkupPercent(e.target.value)}
                  className="w-16 py-1 text-xs"
                  aria-label="Markup percent on costs"
                />
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-48 overflow-y-auto">
              {billables.costs.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedCostIds.has(c.id)}
                    onChange={() => toggleCost(c.id)}
                    className="accent-electric"
                  />
                  <Badge tone="neutral">{c.source === 'bill' ? 'Bill' : 'Expense'}</Badge>
                  <span className="text-navy/50">{c.date ? formatDate(c.date) : ''}</span>
                  <span className="flex-1 truncate text-navy/80">
                    {c.description ?? c.ref ?? 'Reimbursable cost'}
                  </span>
                  <span className="tabular-nums font-semibold text-navy/80">
                    {formatCurrency((Number(c.amount) * markupFactor).toFixed(2))}
                  </span>
                </label>
              ))}
              {billables.time.map((t) => (
                <label
                  key={t.id}
                  className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedTimeIds.has(t.id)}
                    onChange={() => toggleTime(t.id)}
                    className="accent-electric"
                  />
                  <Badge tone="info">Time</Badge>
                  <span className="text-navy/50">{t.date ? formatDate(t.date) : ''}</span>
                  <span className="flex-1 truncate text-navy/80">
                    {t.description ?? 'Time entry'} ({Number(t.hours)}h × {formatCurrency(t.rate)})
                  </span>
                  <span className="tabular-nums font-semibold text-navy/80">
                    {formatCurrency(t.amount)}
                  </span>
                </label>
              ))}
            </div>
            {hasBillablesSelected && (
              <p className="mt-1 text-xs text-navy/50">
                {selectedCostIds.size + selectedTimeIds.size} billable item
                {selectedCostIds.size + selectedTimeIds.size !== 1 ? 's' : ''} selected —{' '}
                {formatCurrency(billablesAmount.toFixed(2))} will be added to this invoice.
              </p>
            )}
          </div>
        )}

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
                ((lines.reduce((s, l) => s + computeLineTotal(l), 0) + billablesAmount) * (parseFloat(discount) / 100)).toFixed(2)
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

        {/* Live totals (incl. tax) */}
        <div className="rounded-lg bg-navy/5 px-4 py-3 space-y-1">
          <div className="flex items-center justify-between text-sm text-navy/60">
            <span>Subtotal</span>
            <span className="tabular-nums">{formatCurrency(totals.subtotal.toFixed(2), currency || 'USD')}</span>
          </div>
          {totals.discount > 0 && (
            <div className="flex items-center justify-between text-sm text-navy/60">
              <span>Discount</span>
              <span className="tabular-nums">-{formatCurrency(totals.discount.toFixed(2), currency || 'USD')}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm text-navy/60">
            <span>Sales Tax{selectedRate ? ` (${(parseFloat(selectedRate.rate) * 100).toFixed(2)}%)` : ''}</span>
            <span className="tabular-nums">{formatCurrency(totals.tax.toFixed(2), currency || 'USD')}</span>
          </div>
          <div className="flex items-center justify-between border-t border-navy/10 pt-1">
            <span className="text-sm font-semibold text-navy/70">
              Total{currency ? ` (${currency})` : ''}
            </span>
            <span className="text-lg font-bold text-navy tabular-nums">
              {formatCurrency(totals.total.toFixed(2), currency || 'USD')}
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function InvoicesPageContent() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  // Edit state — the full invoice (with lines) being edited.
  const [editTarget, setEditTarget] = useState<InvoiceDetail | null>(null);
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);

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
      const [invList, custList, emailStatus, itemList, rateList, classList, jobList] =
        await Promise.all([
          api.get<Invoice[]>('/api/invoices'),
          api.get<Customer[]>('/api/customers'),
          api.get<{ configured: boolean }>('/api/email/status'),
          api.get<{ items: Item[] }>('/api/items'),
          api.get<TaxRate[]>('/api/tax-rates'),
          api.get<ClassRow[]>('/api/classes'),
          api.get<Job[]>('/api/jobs'),
        ]);
      setInvoices(invList);
      setCustomers(custList);
      setEmailConfigured(emailStatus.configured);
      setItems(itemList.items ?? []);
      setTaxRates(rateList);
      setClasses(classList);
      setJobs(jobList);
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

  // Scroll to + highlight the row when arriving via global search (?focus=<id>)
  const [focusedId, setFocusedId] = useState<string | null>(null);
  useFocusParam(invoices, loading, (inv) => {
    setFocusedId(inv.id);
    document
      .getElementById(`invoice-row-${inv.id}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  async function handleEdit(inv: Invoice) {
    setLoadingEditId(inv.id);
    try {
      const detail = await api.get<InvoiceDetail>(`/api/invoices/${inv.id}`);
      setEditTarget(detail);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load invoice.';
      toast(msg, 'danger');
    } finally {
      setLoadingEditId(null);
    }
  }

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
          <div className="flex items-center justify-center py-20 text-navy/40">
            <Spinner className="h-6 w-6" />
          </div>
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No invoices yet"
            message="Create your first invoice to get started."
            action={
              <Button onClick={() => setShowNew(true)}>
                <Plus className="h-4 w-4" /> New Invoice
              </Button>
            }
          />
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Invoice #</Th>
                <Th>Customer</Th>
                <Th>Date</Th>
                <Th>Due Date</Th>
                <Th numeric>Total</Th>
                <Th numeric>Balance Due</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </Tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const overdue =
                  (inv.status === 'open' || inv.status === 'partial') &&
                  !!inv.dueDate &&
                  new Date(inv.dueDate) < new Date();
                return (
                <Tr
                  key={inv.id}
                  id={`invoice-row-${inv.id}`}
                  className={inv.id === focusedId ? 'bg-electric/10' : undefined}
                >
                  <Td className="font-semibold text-navy">#{inv.invoiceNumber}</Td>
                  <Td>{customerMap[inv.customerId] ?? '—'}</Td>
                  <Td className="text-navy/70">{formatDate(inv.date)}</Td>
                  <Td className="text-navy/70">{formatDate(inv.dueDate)}</Td>
                  <Td numeric className="font-medium">
                    {formatCurrency(inv.total)}
                  </Td>
                  <Td numeric className="font-medium">
                    {formatCurrency(inv.balanceDue)}
                  </Td>
                  <Td>
                    <Badge tone={overdue ? 'overdue' : inv.status}>
                      {overdue ? 'Overdue' : statusLabel(inv.status)}
                    </Badge>
                  </Td>
                  <Td className="text-right">
                    <span className="inline-flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(`/api/invoices/${inv.id}/pdf`, '_blank')}
                        title="View PDF"
                      >
                        <Download className="h-3.5 w-3.5" /> PDF
                      </Button>
                      {inv.status === 'open' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEdit(inv)}
                          loading={loadingEditId === inv.id}
                          title="Edit invoice (re-posts the GL entry)"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                      )}
                      {inv.status !== 'void' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => { setEmailTarget(inv); setEmailTo(''); }}
                          title={emailConfigured ? 'Email invoice' : 'Email not configured'}
                        >
                          <Mail className="h-3.5 w-3.5" /> Email
                        </Button>
                      )}
                      {inv.status !== 'void' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setVoidTarget(inv)}
                          className="text-red-500 hover:bg-red-50"
                          title="Void invoice"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Void
                        </Button>
                      )}
                    </span>
                  </Td>
                </Tr>
                );
              })}
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

      <InvoiceModal
        open={showNew || !!editTarget}
        editing={editTarget}
        onClose={() => { setShowNew(false); setEditTarget(null); }}
        customers={customers}
        items={items}
        taxRates={taxRates}
        classes={classes}
        jobs={jobs}
        onSaved={fetchData}
      />

      <ConfirmDialog
        open={!!voidTarget}
        title="Void Invoice"
        message={
          <>
            Are you sure you want to void{' '}
            <strong>Invoice #{voidTarget?.invoiceNumber}</strong>? This will reverse the GL
            entry and cannot be undone.
          </>
        }
        confirmLabel="Void Invoice"
        tone="danger"
        loading={voiding}
        onConfirm={handleVoid}
        onClose={() => setVoidTarget(null)}
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
            <Button onClick={handleEmail} loading={emailing} disabled={!emailConfigured}>
              Send Email
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
            autoFocus
          />
          <p className="mt-1 text-xs text-navy/50">
            The invoice PDF will be attached to the email.
          </p>
        </div>
      </Modal>
    </main>
  );
}

export default function InvoicesPage() {
  return (
    <Suspense fallback={null}>
      <InvoicesPageContent />
    </Suspense>
  );
}
