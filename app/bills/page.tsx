'use client';

import { useEffect, useState, useCallback } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
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

interface Bill {
  id: string;
  vendorId: string;
  billNumber: string | null;
  date: string;
  dueDate: string | null;
  total: string;
  balanceDue: string;
  status: 'open' | 'partial' | 'paid' | 'void';
  memo: string | null;
}

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

interface LineRow {
  accountId: string;
  description: string;
  amount: string;
}

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

function statusTone(status: Bill['status']): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  switch (status) {
    case 'paid':
      return 'success';
    case 'partial':
      return 'warning';
    case 'void':
      return 'danger';
    default:
      return 'info';
  }
}

function statusLabel(status: Bill['status']): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'partial':
      return 'Partial';
    case 'paid':
      return 'Paid';
    case 'void':
      return 'Void';
  }
}

// ---------------------------------------------------------------------------
// Empty line factory
// ---------------------------------------------------------------------------

function emptyLine(): LineRow {
  return { accountId: '', description: '', amount: '' };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form fields
  const [vendorId, setVendorId] = useState('');
  const [billNumber, setBillNumber] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);

  // Void confirm
  const [voidingId, setVoidingId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchBills = useCallback(async () => {
    try {
      const data = await api.get<Bill[]>('/api/bills');
      setBills(data);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load bills', 'danger');
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const [billData, vendorData, accountData] = await Promise.all([
          api.get<Bill[]>('/api/bills'),
          api.get<Vendor[]>('/api/vendors'),
          api.get<Account[]>('/api/accounts'),
        ]);
        setBills(billData);
        setVendors(vendorData);
        setAccounts(accountData);
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Failed to load data', 'danger');
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  // ---------------------------------------------------------------------------
  // ID -> Name lookup helpers
  // ---------------------------------------------------------------------------

  function vendorName(id: string): string {
    return vendors.find((v) => v.id === id)?.displayName ?? id;
  }

  function accountLabel(id: string): string {
    const a = accounts.find((ac) => ac.id === id);
    if (!a) return id;
    return `${a.code} – ${a.name}`;
  }

  // ---------------------------------------------------------------------------
  // Modal helpers
  // ---------------------------------------------------------------------------

  function openModal() {
    setVendorId('');
    setBillNumber('');
    setDate(new Date().toISOString().slice(0, 10));
    setDueDate('');
    setLines([emptyLine()]);
    setModalOpen(true);
  }

  function closeModal() {
    if (!submitting) setModalOpen(false);
  }

  // Line row mutations
  function updateLine(index: number, field: keyof LineRow, value: string) {
    setLines((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  function addLine() {
    setLines((prev) => [...prev, emptyLine()]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  // Compute running total for display (Number() only — display only, not stored)
  const runningTotal = lines.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

  // ---------------------------------------------------------------------------
  // Submit new bill
  // ---------------------------------------------------------------------------

  async function handleSubmit() {
    if (!vendorId) {
      toast('Please select a vendor.', 'danger');
      return;
    }
    if (!date) {
      toast('Bill date is required.', 'danger');
      return;
    }
    for (const [i, line] of lines.entries()) {
      if (!line.accountId) {
        toast(`Line ${i + 1}: select an account.`, 'danger');
        return;
      }
      if (!line.amount || Number(line.amount) <= 0) {
        toast(`Line ${i + 1}: amount must be greater than zero.`, 'danger');
        return;
      }
    }

    setSubmitting(true);
    try {
      await api.post('/api/bills', {
        vendorId,
        billNumber: billNumber.trim() || undefined,
        date,
        dueDate: dueDate || undefined,
        lines: lines.map((l) => ({
          accountId: l.accountId,
          description: l.description.trim() || undefined,
          amount: l.amount,
        })),
      });
      toast('Bill created.', 'success');
      setModalOpen(false);
      await fetchBills();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to create bill.', 'danger');
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Void bill
  // ---------------------------------------------------------------------------

  async function handleVoid(id: string) {
    setVoidingId(id);
    try {
      await api.del(`/api/bills/${id}`);
      toast('Bill voided.', 'success');
      await fetchBills();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to void bill.', 'danger');
    } finally {
      setVoidingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <Toaster />

      <PageHeader
        title="Bills"
        icon={FileText}
        action={
          <Button onClick={openModal}>
            <Plus className="h-4 w-4" />
            New Bill
          </Button>
        }
      />

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-navy/40 text-sm">Loading bills…</div>
        ) : bills.length === 0 ? (
          <div className="p-12 text-center text-navy/40 text-sm">
            No bills yet. Click <span className="font-semibold text-electric">+ New Bill</span> to create one.
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Bill #</Th>
                <Th>Vendor</Th>
                <Th>Date</Th>
                <Th>Due Date</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Balance Due</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => (
                <Tr key={bill.id}>
                  <Td className="font-mono text-sm">{bill.billNumber ?? <span className="text-navy/30 italic">—</span>}</Td>
                  <Td className="font-medium">{vendorName(bill.vendorId)}</Td>
                  <Td>{bill.date ? new Date(bill.date).toLocaleDateString() : '—'}</Td>
                  <Td>{bill.dueDate ? new Date(bill.dueDate).toLocaleDateString() : <span className="text-navy/30">—</span>}</Td>
                  <Td className="text-right tabular-nums">{formatCurrency(bill.total)}</Td>
                  <Td className="text-right tabular-nums font-semibold">
                    {formatCurrency(bill.balanceDue)}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(bill.status)}>{statusLabel(bill.status)}</Badge>
                  </Td>
                  <Td className="text-right">
                    {bill.status !== 'void' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        disabled={voidingId === bill.id}
                        onClick={() => handleVoid(bill.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                        {voidingId === bill.id ? 'Voiding…' : 'Void'}
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* New Bill Modal */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title="New Bill"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? 'Saving…' : 'Save Bill'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Vendor */}
          <div>
            <Label htmlFor="bill-vendor">Vendor *</Label>
            <Select
              id="bill-vendor"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
            >
              <option value="">Select vendor…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.displayName}
                </option>
              ))}
            </Select>
          </div>

          {/* Bill Number + Date row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="bill-number">Bill # (optional)</Label>
              <Input
                id="bill-number"
                placeholder="e.g. INV-1001"
                value={billNumber}
                onChange={(e) => setBillNumber(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="bill-date">Bill Date *</Label>
              <Input
                id="bill-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>

          {/* Due Date */}
          <div>
            <Label htmlFor="bill-due">Due Date (optional)</Label>
            <Input
              id="bill-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="mb-0">Line Items *</Label>
              <button
                type="button"
                onClick={addLine}
                className="text-xs text-electric font-semibold hover:text-electric/70 flex items-center gap-1"
              >
                <Plus className="h-3 w-3" /> Add Line
              </button>
            </div>

            <div className="space-y-2">
              {lines.map((line, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  {/* Account */}
                  <div className="flex-1 min-w-0">
                    <Select
                      value={line.accountId}
                      onChange={(e) => updateLine(idx, 'accountId', e.target.value)}
                    >
                      <option value="">Account…</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} – {a.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  {/* Description */}
                  <div className="flex-1 min-w-0">
                    <Input
                      placeholder="Description"
                      value={line.description}
                      onChange={(e) => updateLine(idx, 'description', e.target.value)}
                    />
                  </div>

                  {/* Amount */}
                  <div className="w-28 shrink-0">
                    <Input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0.00"
                      value={line.amount}
                      onChange={(e) => updateLine(idx, 'amount', e.target.value)}
                    />
                  </div>

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => removeLine(idx)}
                    disabled={lines.length === 1}
                    className="mt-1 text-red-400 hover:text-red-600 disabled:opacity-20 disabled:pointer-events-none"
                    title="Remove line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            {/* Running total */}
            <div className="mt-3 flex justify-end">
              <span className="text-sm text-navy/50 mr-2">Total:</span>
              <span className="text-sm font-bold text-navy tabular-nums">
                {formatCurrency(runningTotal.toFixed(2))}
              </span>
            </div>
          </div>
        </div>
      </Modal>
    </main>
  );
}
