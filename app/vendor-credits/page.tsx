'use client';

import { useEffect, useState, useCallback } from 'react';
import { CreditCard, Plus, Trash2, PlusCircle, MinusCircle, CheckCircle } from 'lucide-react';
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

interface Bill {
  id: string;
  vendorId: string;
  billNumber: string | null;
  total: string;
  balanceDue: string;
  status: string;
  date: string;
}

interface VendorCredit {
  id: string;
  vendorId: string;
  date: string;
  status: 'open' | 'partial' | 'closed' | 'void';
  total: string;
  unapplied: string;
  memo: string | null;
}

interface CreditLine {
  accountId: string;
  description: string;
  amount: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusTone(status: VendorCredit['status']): 'info' | 'warning' | 'success' | 'neutral' {
  if (status === 'open') return 'info';
  if (status === 'partial') return 'warning';
  if (status === 'closed') return 'success';
  return 'neutral';
}

function statusLabel(status: VendorCredit['status']): string {
  if (status === 'open') return 'Open';
  if (status === 'partial') return 'Partial';
  if (status === 'closed') return 'Closed';
  return 'Void';
}

const EMPTY_LINE: CreditLine = { accountId: '', description: '', amount: '' };

// ---------------------------------------------------------------------------
// New Vendor Credit Modal
// ---------------------------------------------------------------------------

interface NewCreditModalProps {
  open: boolean;
  onClose: () => void;
  vendors: Vendor[];
  accounts: Account[];
  onCreated: () => void;
}

function NewCreditModal({ open, onClose, vendors, accounts, onCreated }: NewCreditModalProps) {
  const [vendorId, setVendorId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<CreditLine[]>([{ ...EMPTY_LINE }]);
  const [saving, setSaving] = useState(false);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setVendorId('');
      setDate(new Date().toISOString().slice(0, 10));
      setMemo('');
      setLines([{ ...EMPTY_LINE }]);
    }
  }, [open]);

  function updateLine(idx: number, field: keyof CreditLine, value: string) {
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

  const liveTotal = lines.reduce((sum, l) => sum + (parseFloat(l.amount) || 0), 0);

  async function handleSubmit() {
    if (!vendorId) { toast('Please select a vendor.', 'danger'); return; }
    if (!date) { toast('Please enter a date.', 'danger'); return; }
    const validLines = lines.filter((l) => l.accountId && l.amount);
    if (validLines.length === 0) { toast('Add at least one line with an account and amount.', 'danger'); return; }
    for (let i = 0; i < validLines.length; i++) {
      const l = validLines[i];
      if (parseFloat(l.amount) <= 0) {
        toast(`Line ${i + 1}: amount must be greater than zero.`, 'danger'); return;
      }
    }

    setSaving(true);
    try {
      await api.post('/api/vendor-credits', {
        vendorId,
        date,
        memo: memo || null,
        lines: validLines.map((l) => ({
          accountId: l.accountId,
          description: l.description || null,
          amount: l.amount,
        })),
      });
      toast('Vendor credit created.', 'success');
      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create vendor credit.';
      toast(msg, 'danger');
    } finally {
      setSaving(false);
    }
  }

  // Show only expense/asset accounts for credit lines (the accounts that get credited).
  const eligibleAccounts = accounts.filter(
    (a) => a.type === 'expense' || a.type === 'asset',
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Vendor Credit"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Create Credit'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Vendor */}
        <div>
          <Label htmlFor="vc-vendor">Vendor *</Label>
          <Select id="vc-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Select a vendor…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.displayName}</option>
            ))}
          </Select>
        </div>

        {/* Date */}
        <div>
          <Label htmlFor="vc-date">Credit Date *</Label>
          <Input
            id="vc-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {/* Memo */}
        <div>
          <Label htmlFor="vc-memo">Memo</Label>
          <Input
            id="vc-memo"
            placeholder="e.g. Returned goods, overcharge refund…"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="mb-0">Credit Lines</Label>
            <button
              type="button"
              onClick={addLine}
              className="text-electric hover:text-electric/80 flex items-center gap-1 text-sm font-medium"
            >
              <PlusCircle className="h-4 w-4" /> Add line
            </button>
          </div>

          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <div className="grid grid-cols-[1fr_1fr_100px_32px] gap-2 bg-slate-50 px-3 py-2 text-xs font-semibold text-navy/60 border-b border-slate-200">
              <span>Account</span>
              <span>Description</span>
              <span>Amount</span>
              <span />
            </div>

            {lines.map((line, idx) => (
              <div
                key={idx}
                className="grid grid-cols-[1fr_1fr_100px_32px] gap-2 items-center px-3 py-2 border-b border-slate-100 last:border-b-0"
              >
                <Select
                  value={line.accountId}
                  onChange={(e) => updateLine(idx, 'accountId', e.target.value)}
                >
                  <option value="">Select account…</option>
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
                  placeholder="0.00"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={line.amount}
                  onChange={(e) => updateLine(idx, 'amount', e.target.value)}
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
// Apply to Bill Modal
// ---------------------------------------------------------------------------

interface ApplyModalProps {
  open: boolean;
  credit: VendorCredit | null;
  bills: Bill[];
  onClose: () => void;
  onApplied: () => void;
}

function ApplyModal({ open, credit, bills, onClose, onApplied }: ApplyModalProps) {
  const [billId, setBillId] = useState('');
  const [amount, setAmount] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (open) {
      setBillId('');
      setAmount('');
    }
  }, [open]);

  // Only bills belonging to the same vendor that have a balance.
  const eligibleBills = bills.filter(
    (b) => b.vendorId === credit?.vendorId && parseFloat(b.balanceDue) > 0 && b.status !== 'void',
  );

  const maxAmount = Math.min(
    parseFloat(credit?.unapplied ?? '0'),
    parseFloat(bills.find((b) => b.id === billId)?.balanceDue ?? '0'),
  );

  async function handleApply() {
    if (!credit) return;
    if (!billId) { toast('Please select a bill.', 'danger'); return; }
    if (!amount || parseFloat(amount) <= 0) { toast('Amount must be greater than zero.', 'danger'); return; }

    setApplying(true);
    try {
      await api.post(`/api/vendor-credits/${credit.id}`, {
        action: 'apply',
        billId,
        amount,
      });
      toast('Credit applied to bill.', 'success');
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
      title="Apply Vendor Credit to Bill"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={applying}>Cancel</Button>
          <Button onClick={handleApply} disabled={applying}>
            {applying ? 'Applying…' : 'Apply Credit'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {credit && (
          <div className="rounded-lg bg-navy/5 px-4 py-3 text-sm">
            <span className="text-navy/60">Unapplied credit balance: </span>
            <span className="font-bold text-navy tabular-nums">
              {formatCurrency(credit.unapplied)}
            </span>
          </div>
        )}

        <div>
          <Label htmlFor="apply-bill">Bill *</Label>
          <Select id="apply-bill" value={billId} onChange={(e) => setBillId(e.target.value)}>
            <option value="">Select a bill…</option>
            {eligibleBills.map((b) => (
              <option key={b.id} value={b.id}>
                {b.billNumber ? `#${b.billNumber}` : b.id.slice(0, 8)} — Balance:{' '}
                {formatCurrency(b.balanceDue)} — {b.date.slice(0, 10)}
              </option>
            ))}
          </Select>
          {eligibleBills.length === 0 && (
            <p className="mt-1 text-xs text-navy/40">No open bills found for this vendor.</p>
          )}
        </div>

        <div>
          <Label htmlFor="apply-amount">Amount to Apply *</Label>
          <Input
            id="apply-amount"
            type="number"
            min="0.01"
            step="0.01"
            max={maxAmount > 0 ? maxAmount : undefined}
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {billId && maxAmount > 0 && (
            <p className="mt-1 text-xs text-navy/50">
              Max applicable: {formatCurrency(maxAmount.toFixed(2))}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Void confirm modal
// ---------------------------------------------------------------------------

interface VoidModalProps {
  open: boolean;
  credit: VendorCredit | null;
  onConfirm: () => void;
  onClose: () => void;
  voiding: boolean;
}

function VoidModal({ open, credit, onConfirm, onClose, voiding }: VoidModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Void Vendor Credit"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={voiding}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={voiding}>
            {voiding ? 'Voiding…' : 'Void Credit'}
          </Button>
        </>
      }
    >
      <p className="text-navy/80 text-sm">
        Are you sure you want to void this vendor credit ({formatCurrency(credit?.total ?? '0')})?
        This will reverse the GL entry and cannot be undone.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function VendorCreditsPage() {
  const [credits, setCredits] = useState<VendorCredit[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);

  const [showNew, setShowNew] = useState(false);
  const [applyTarget, setApplyTarget] = useState<VendorCredit | null>(null);
  const [voidTarget, setVoidTarget] = useState<VendorCredit | null>(null);
  const [voiding, setVoiding] = useState(false);

  const vendorMap = Object.fromEntries(vendors.map((v) => [v.id, v.displayName]));

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [creditList, vendorList, accountList, billList] = await Promise.all([
        api.get<VendorCredit[]>('/api/vendor-credits'),
        api.get<Vendor[]>('/api/vendors'),
        api.get<Account[]>('/api/accounts'),
        api.get<Bill[]>('/api/bills'),
      ]);
      setCredits(creditList);
      setVendors(vendorList);
      setAccounts(accountList);
      setBills(billList);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load vendor credits.';
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
      await api.del(`/api/vendor-credits/${voidTarget.id}`);
      toast('Vendor credit voided.', 'success');
      setVoidTarget(null);
      fetchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to void vendor credit.';
      toast(msg, 'danger');
    } finally {
      setVoiding(false);
    }
  }

  const totalUnapplied = credits
    .filter((c) => c.status !== 'void')
    .reduce((s, c) => s + Number(c.unapplied), 0);

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Vendor Credits"
        icon={CreditCard}
        action={
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> New Vendor Credit
          </Button>
        }
      />

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-navy/40 text-sm">
            Loading vendor credits…
          </div>
        ) : credits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-navy/40">
            <CreditCard className="h-10 w-10 opacity-30" />
            <p className="text-sm">No vendor credits yet. Create one to get started.</p>
          </div>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Vendor</Th>
                <Th>Date</Th>
                <Th>Memo</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Unapplied</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </Tr>
            </thead>
            <tbody>
              {credits.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-medium text-navy">
                    {vendorMap[c.vendorId] ?? c.vendorId}
                  </Td>
                  <Td className="text-navy/70">{c.date ? c.date.slice(0, 10) : '—'}</Td>
                  <Td className="text-navy/60 text-sm truncate max-w-[200px]">
                    {c.memo ?? '—'}
                  </Td>
                  <Td className="text-right tabular-nums font-medium">
                    {formatCurrency(c.total)}
                  </Td>
                  <Td className="text-right tabular-nums font-medium">
                    {formatCurrency(c.unapplied)}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge>
                  </Td>
                  <Td className="text-right">
                    <span className="inline-flex items-center gap-3">
                      {c.status !== 'void' && c.status !== 'closed' && (
                        <button
                          onClick={() => setApplyTarget(c)}
                          className="inline-flex items-center gap-1 text-xs text-navy/40 hover:text-electric transition-colors font-medium"
                          title="Apply to bill"
                        >
                          <CheckCircle className="h-3.5 w-3.5" /> Apply
                        </button>
                      )}
                      {c.status !== 'void' && (
                        <button
                          onClick={() => setVoidTarget(c)}
                          className="inline-flex items-center gap-1 text-xs text-navy/40 hover:text-red-500 transition-colors font-medium"
                          title="Void credit"
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
      {credits.length > 0 && !loading && (
        <div className="mt-4 flex gap-6 text-sm text-navy/50">
          <span>
            {credits.length} credit{credits.length !== 1 ? 's' : ''}
          </span>
          <span>
            Open:{' '}
            <span className="font-semibold text-navy/70">
              {credits.filter((c) => c.status === 'open' || c.status === 'partial').length}
            </span>
          </span>
          <span>
            Total unapplied:{' '}
            <span className="font-semibold text-navy/70">
              {formatCurrency(totalUnapplied.toFixed(2))}
            </span>
          </span>
        </div>
      )}

      <NewCreditModal
        open={showNew}
        onClose={() => setShowNew(false)}
        vendors={vendors}
        accounts={accounts}
        onCreated={fetchData}
      />

      <ApplyModal
        open={!!applyTarget}
        credit={applyTarget}
        bills={bills}
        onClose={() => setApplyTarget(null)}
        onApplied={fetchData}
      />

      <VoidModal
        open={!!voidTarget}
        credit={voidTarget}
        onConfirm={handleVoid}
        onClose={() => setVoidTarget(null)}
        voiding={voiding}
      />
    </main>
  );
}
