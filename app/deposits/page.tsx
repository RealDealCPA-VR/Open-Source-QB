'use client';

import { useEffect, useState, useCallback } from 'react';
import { Landmark, Plus } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Select,
  Label,
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

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface UndepositedPayment {
  id: string;
  customerId: string;
  customerName: string | null;
  date: string;
  method: string;
  reference: string | null;
  amount: string;
}

interface DepositLine {
  id: string;
  depositId: string;
  paymentId: string | null;
  amount: string;
}

interface Deposit {
  id: string;
  depositAccountId: string;
  accountName: string | null;
  accountCode: string | null;
  date: string;
  total: string;
  memo: string | null;
  createdAt: string;
  lines: DepositLine[];
}

// ---------------------------------------------------------------------------
// Make Deposit Modal
// ---------------------------------------------------------------------------

interface MakeDepositModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  bankAccounts: Account[];
  undepositedPayments: UndepositedPayment[];
  loadingPayments: boolean;
}

function MakeDepositModal({
  open,
  onClose,
  onCreated,
  bankAccounts,
  undepositedPayments,
  loadingPayments,
}: MakeDepositModalProps) {
  const [depositAccountId, setDepositAccountId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Reset when modal opens.
  useEffect(() => {
    if (open) {
      setDepositAccountId('');
      setDate(new Date().toISOString().slice(0, 10));
      setMemo('');
      setSelectedIds(new Set());
    }
  }, [open]);

  function togglePayment(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === undepositedPayments.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(undepositedPayments.map((p) => p.id)));
    }
  }

  const selectedTotal = undepositedPayments
    .filter((p) => selectedIds.has(p.id))
    .reduce((sum, p) => sum + Number(p.amount), 0);

  async function handleSubmit() {
    if (!depositAccountId) {
      toast('Please select a bank account.', 'danger');
      return;
    }
    if (!date) {
      toast('Please enter a deposit date.', 'danger');
      return;
    }
    if (selectedIds.size === 0) {
      toast('Select at least one payment to deposit.', 'danger');
      return;
    }

    setSaving(true);
    try {
      await api.post('/api/deposits', {
        depositAccountId,
        date,
        paymentIds: [...selectedIds],
        memo: memo || undefined,
      });
      toast('Deposit created successfully.', 'success');
      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create deposit.';
      toast(msg, 'danger');
    } finally {
      setSaving(false);
    }
  }

  const allSelected =
    undepositedPayments.length > 0 && selectedIds.size === undepositedPayments.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Make Deposit"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving || selectedIds.size === 0}>
            {saving ? 'Saving…' : `Deposit ${formatCurrency(selectedTotal.toFixed(2))}`}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Bank account */}
        <div>
          <Label htmlFor="dep-account">Deposit To *</Label>
          <Select
            id="dep-account"
            value={depositAccountId}
            onChange={(e) => setDepositAccountId(e.target.value)}
          >
            <option value="">Select bank account…</option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </Select>
        </div>

        {/* Date */}
        <div>
          <Label htmlFor="dep-date">Date *</Label>
          <Input
            id="dep-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {/* Memo */}
        <div>
          <Label htmlFor="dep-memo">Memo</Label>
          <Input
            id="dep-memo"
            placeholder="Optional note"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>

        {/* Undeposited payments list */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label className="mb-0">Payments in Undeposited Funds</Label>
            {undepositedPayments.length > 0 && (
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs text-electric hover:text-electric/80 font-medium"
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            )}
          </div>

          {loadingPayments ? (
            <div className="text-sm text-navy/40 py-4 text-center">Loading payments…</div>
          ) : undepositedPayments.length === 0 ? (
            <div className="text-sm text-navy/40 py-4 text-center rounded-lg border border-dashed border-slate-200">
              No undeposited payments found.
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 overflow-hidden divide-y divide-slate-100">
              {undepositedPayments.map((p) => {
                const checked = selectedIds.has(p.id);
                return (
                  <label
                    key={p.id}
                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                      checked ? 'bg-electric/5' : 'hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePayment(p.id)}
                      className="accent-electric"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-navy truncate">
                          {p.customerName ?? p.customerId}
                        </span>
                        <span className="text-sm font-semibold text-navy tabular-nums shrink-0">
                          {formatCurrency(p.amount)}
                        </span>
                      </div>
                      <div className="flex gap-3 text-xs text-navy/50 mt-0.5">
                        <span>{p.date ? p.date.slice(0, 10) : '—'}</span>
                        <span className="capitalize">{p.method.replace('_', ' ')}</span>
                        {p.reference && <span>#{p.reference}</span>}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Live total */}
        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-navy/5 px-4 py-3">
            <span className="text-sm font-semibold text-navy/70">
              Selected ({selectedIds.size} payment{selectedIds.size !== 1 ? 's' : ''})
            </span>
            <span className="text-lg font-bold text-navy tabular-nums">
              {formatCurrency(selectedTotal.toFixed(2))}
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DepositsPage() {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [bankAccounts, setBankAccounts] = useState<Account[]>([]);
  const [undepositedPayments, setUndepositedPayments] = useState<UndepositedPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const fetchDeposits = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.get<Deposit[]>('/api/deposits');
      setDeposits(rows);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load deposits.';
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSupportingData = useCallback(async () => {
    try {
      const [accts, pmts] = await Promise.all([
        api.get<Account[]>('/api/accounts'),
        (async () => {
          setLoadingPayments(true);
          const r = await api.get<UndepositedPayment[]>('/api/deposits/undeposited');
          setLoadingPayments(false);
          return r;
        })(),
      ]);
      // Filter to asset accounts only (bank/checking type).
      setBankAccounts(accts.filter((a) => a.type === 'asset' && a.code !== '1050'));
      setUndepositedPayments(pmts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load data.';
      toast(msg, 'danger');
      setLoadingPayments(false);
    }
  }, []);

  useEffect(() => {
    fetchDeposits();
    fetchSupportingData();
  }, [fetchDeposits, fetchSupportingData]);

  function openModal() {
    // Refresh undeposited payments each time the modal is opened.
    fetchSupportingData();
    setShowModal(true);
  }

  function handleCreated() {
    fetchDeposits();
    fetchSupportingData();
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Bank Deposits"
        icon={Landmark}
        action={
          <Button onClick={openModal}>
            <Plus className="h-4 w-4" /> Make Deposit
          </Button>
        }
      />

      {/* Undeposited Funds summary banner */}
      {undepositedPayments.length > 0 && (
        <div className="mb-6 flex items-center justify-between rounded-xl bg-gold/10 border border-gold/30 px-5 py-3">
          <div>
            <p className="text-sm font-semibold text-navy">
              {undepositedPayments.length} undeposited payment
              {undepositedPayments.length !== 1 ? 's' : ''} in Undeposited Funds
            </p>
            <p className="text-xs text-navy/60 mt-0.5">
              Total:{' '}
              <strong>
                {formatCurrency(
                  undepositedPayments
                    .reduce((s, p) => s + Number(p.amount), 0)
                    .toFixed(2),
                )}
              </strong>
            </p>
          </div>
          <Button size="sm" onClick={openModal}>
            Make Deposit
          </Button>
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-navy/40 text-sm">
            Loading deposits…
          </div>
        ) : deposits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-navy/40">
            <Landmark className="h-10 w-10 opacity-30" />
            <p className="text-sm">No deposits yet. Use "Make Deposit" to move funds from Undeposited Funds.</p>
          </div>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Date</Th>
                <Th>Account</Th>
                <Th>Payments</Th>
                <Th>Memo</Th>
                <Th className="text-right">Total</Th>
              </Tr>
            </thead>
            <tbody>
              {deposits.map((dep) => (
                <Tr key={dep.id}>
                  <Td className="text-navy/70 tabular-nums">
                    {dep.date ? dep.date.slice(0, 10) : '—'}
                  </Td>
                  <Td className="font-medium text-navy">
                    {dep.accountCode ? (
                      <span>
                        <span className="text-navy/50 text-xs mr-1">{dep.accountCode}</span>
                        {dep.accountName}
                      </span>
                    ) : (
                      dep.depositAccountId
                    )}
                  </Td>
                  <Td className="text-navy/70">
                    {dep.lines.length} payment{dep.lines.length !== 1 ? 's' : ''}
                  </Td>
                  <Td className="text-navy/60 text-sm">{dep.memo ?? '—'}</Td>
                  <Td className="text-right tabular-nums font-semibold text-navy">
                    {formatCurrency(dep.total)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Summary footer */}
      {deposits.length > 0 && !loading && (
        <div className="mt-4 flex gap-6 text-sm text-navy/50">
          <span>
            {deposits.length} deposit{deposits.length !== 1 ? 's' : ''}
          </span>
          <span>
            Total deposited:{' '}
            <span className="font-semibold text-navy/70">
              {formatCurrency(
                deposits.reduce((s, d) => s + Number(d.total), 0).toFixed(2),
              )}
            </span>
          </span>
        </div>
      )}

      <MakeDepositModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onCreated={handleCreated}
        bankAccounts={bankAccounts}
        undepositedPayments={undepositedPayments}
        loadingPayments={loadingPayments}
      />
    </main>
  );
}
