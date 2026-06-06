'use client';

import { useEffect, useState, useCallback } from 'react';
import { ShoppingCart, Plus, PlusCircle, MinusCircle, ArrowRight, Download } from 'lucide-react';
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

interface Vendor {
  id: string;
  displayName: string;
}

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface PurchaseOrder {
  id: string;
  poNumber: number;
  vendorId: string;
  date: string;
  expectedDate: string | null;
  total: string;
  status: 'open' | 'closed' | 'void';
  convertedBillId: string | null;
  memo: string | null;
}

interface LineRow {
  accountId: string;
  description: string;
  quantity: string;
  rate: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusTone(status: PurchaseOrder['status']): 'info' | 'success' | 'neutral' {
  if (status === 'open') return 'info';
  if (status === 'closed') return 'success';
  return 'neutral';
}

function statusLabel(status: PurchaseOrder['status']): string {
  if (status === 'open') return 'Open';
  if (status === 'closed') return 'Converted';
  return 'Void';
}

function computeLineAmount(line: LineRow): number {
  const qty = parseFloat(line.quantity) || 0;
  const rate = parseFloat(line.rate) || 0;
  return qty * rate;
}

function computeTotal(lines: LineRow[]): number {
  return lines.reduce((sum, l) => sum + computeLineAmount(l), 0);
}

const EMPTY_LINE: LineRow = { accountId: '', description: '', quantity: '', rate: '' };

// ---------------------------------------------------------------------------
// New PO Modal
// ---------------------------------------------------------------------------

interface NewPoModalProps {
  open: boolean;
  onClose: () => void;
  vendors: Vendor[];
  accounts: Account[];
  onCreated: () => void;
}

function NewPoModal({ open, onClose, vendors, accounts, onCreated }: NewPoModalProps) {
  const [vendorId, setVendorId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState('');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<LineRow[]>([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);

  // Reset form when modal opens.
  useEffect(() => {
    if (open) {
      setVendorId('');
      setDate(new Date().toISOString().slice(0, 10));
      setExpectedDate('');
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

  // Only expense/asset accounts are valid targets for PO lines.
  const eligibleAccounts = accounts.filter(
    (a) => a.type === 'expense' || a.type === 'asset',
  );

  async function handleSubmit() {
    if (!vendorId) { toast('Please select a vendor.', 'danger'); return; }
    if (!date) { toast('Please enter a PO date.', 'danger'); return; }
    const validLines = lines.filter((l) => l.accountId || l.description || l.quantity || l.rate);
    if (validLines.length === 0) { toast('Add at least one line item.', 'danger'); return; }
    for (let i = 0; i < validLines.length; i++) {
      const l = validLines[i];
      if (!l.accountId) {
        toast(`Line ${i + 1}: please select an account.`, 'danger'); return;
      }
      if (!l.quantity || parseFloat(l.quantity) <= 0) {
        toast(`Line ${i + 1}: quantity must be a positive number.`, 'danger'); return;
      }
      if (!l.rate || parseFloat(l.rate) < 0) {
        toast(`Line ${i + 1}: rate cannot be negative.`, 'danger'); return;
      }
    }

    setSaving(true);
    try {
      await api.post('/api/purchase-orders', {
        vendorId,
        date,
        expectedDate: expectedDate || undefined,
        memo: memo || undefined,
        lines: validLines.map((l) => ({
          accountId: l.accountId,
          description: l.description || null,
          quantity: l.quantity,
          rate: l.rate,
        })),
      });
      toast('Purchase order created.', 'success');
      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create purchase order.';
      toast(msg, 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Purchase Order"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Create PO'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Vendor */}
        <div>
          <Label htmlFor="po-vendor">Vendor *</Label>
          <Select
            id="po-vendor"
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
          >
            <option value="">Select a vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.displayName}
              </option>
            ))}
          </Select>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="po-date">PO Date *</Label>
            <Input
              id="po-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="po-expected">Expected Date</Label>
            <Input
              id="po-expected"
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
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
            <div className="grid grid-cols-[1.4fr_1fr_70px_80px_28px] gap-2 bg-slate-50 px-3 py-2 text-xs font-semibold text-navy/60 border-b border-slate-200">
              <span>Account</span>
              <span>Description</span>
              <span>Qty</span>
              <span>Rate</span>
              <span />
            </div>

            {lines.map((line, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1.4fr_1fr_70px_80px_28px] gap-2 items-center px-3 py-2 border-b border-slate-100 last:border-b-0"
              >
                <Select
                  value={line.accountId}
                  onChange={(e) => updateLine(idx, 'accountId', e.target.value)}
                >
                  <option value="">Account…</option>
                  {eligibleAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
                </Select>
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

        {/* Memo */}
        <div>
          <Label htmlFor="po-memo">Memo</Label>
          <Input
            id="po-memo"
            placeholder="Internal notes…"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
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
  poNumber: number | null;
  onConfirm: () => void;
  onClose: () => void;
  converting: boolean;
}

function ConvertModal({ open, poNumber, onConfirm, onClose, converting }: ConvertModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Convert to Bill"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={converting}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={converting}>
            {converting ? 'Converting…' : 'Convert to Bill'}
          </Button>
        </>
      }
    >
      <p className="text-navy/80 text-sm">
        Convert <strong>PO #{poNumber}</strong> to a Bill? This will create an Accounts Payable
        entry in the GL. The PO will be marked as converted and cannot be modified.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PurchaseOrdersPage() {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  // Convert state
  const [convertTarget, setConvertTarget] = useState<PurchaseOrder | null>(null);
  const [converting, setConverting] = useState(false);

  const vendorMap = Object.fromEntries(vendors.map((v) => [v.id, v.displayName]));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [poList, vendorList, accountList] = await Promise.all([
        api.get<PurchaseOrder[]>('/api/purchase-orders'),
        api.get<Vendor[]>('/api/vendors'),
        api.get<Account[]>('/api/accounts'),
      ]);
      setPos(poList);
      setVendors(vendorList);
      setAccounts(accountList);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load purchase orders.';
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
      await api.post(`/api/purchase-orders/${convertTarget.id}`, { action: 'convert' });
      toast(`PO #${convertTarget.poNumber} converted to bill.`, 'success');
      setConvertTarget(null);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to convert purchase order.';
      toast(msg, 'danger');
    } finally {
      setConverting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Purchase Orders"
        icon={ShoppingCart}
        action={
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> New PO
          </Button>
        }
      />

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-navy/40 text-sm">
            Loading purchase orders…
          </div>
        ) : pos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-navy/40">
            <ShoppingCart className="h-10 w-10 opacity-30" />
            <p className="text-sm">No purchase orders yet. Create one to get started.</p>
          </div>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>PO #</Th>
                <Th>Vendor</Th>
                <Th>Date</Th>
                <Th>Expected</Th>
                <Th className="text-right">Total</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </Tr>
            </thead>
            <tbody>
              {pos.map((po) => (
                <Tr key={po.id}>
                  <Td className="font-semibold text-navy">#{po.poNumber}</Td>
                  <Td>{vendorMap[po.vendorId] ?? po.vendorId}</Td>
                  <Td className="text-navy/70">{po.date ? po.date.slice(0, 10) : '—'}</Td>
                  <Td className="text-navy/70">
                    {po.expectedDate ? po.expectedDate.slice(0, 10) : '—'}
                  </Td>
                  <Td className="text-right tabular-nums font-medium">
                    {formatCurrency(po.total)}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(po.status)}>{statusLabel(po.status)}</Badge>
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* PDF download */}
                      <button
                        onClick={() => window.open(`/api/purchase-orders/${po.id}/pdf`, '_blank')}
                        className="inline-flex items-center gap-1 text-xs text-navy/40 hover:text-electric transition-colors font-medium"
                        title="Download PDF"
                      >
                        <Download className="h-3.5 w-3.5" /> PDF
                      </button>
                      {po.status === 'open' && (
                        <button
                          onClick={() => setConvertTarget(po)}
                          className="inline-flex items-center gap-1 text-xs text-navy/40 hover:text-electric transition-colors font-medium"
                          title="Convert to bill"
                        >
                          <ArrowRight className="h-3.5 w-3.5" /> Convert to Bill
                        </button>
                      )}
                      {po.status === 'closed' && po.convertedBillId && (
                        <span className="text-xs text-navy/30 italic">Bill created</span>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Summary footer */}
      {pos.length > 0 && !loading && (
        <div className="mt-4 flex gap-6 text-sm text-navy/50">
          <span>
            {pos.length} purchase order{pos.length !== 1 ? 's' : ''}
          </span>
          <span>
            Open:{' '}
            <span className="font-semibold text-navy/70">
              {pos.filter((p) => p.status === 'open').length}
            </span>
          </span>
          <span>
            Open value:{' '}
            <span className="font-semibold text-navy/70">
              {formatCurrency(
                pos
                  .filter((p) => p.status === 'open')
                  .reduce((s, p) => s + Number(p.total), 0)
                  .toFixed(2),
              )}
            </span>
          </span>
        </div>
      )}

      <NewPoModal
        open={showNew}
        onClose={() => setShowNew(false)}
        vendors={vendors}
        accounts={accounts}
        onCreated={fetchData}
      />

      <ConvertModal
        open={!!convertTarget}
        poNumber={convertTarget?.poNumber ?? null}
        onConfirm={handleConvert}
        onClose={() => setConvertTarget(null)}
        converting={converting}
      />
    </main>
  );
}
