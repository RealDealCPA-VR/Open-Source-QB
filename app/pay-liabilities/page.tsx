'use client';
/**
 * Pay Liabilities page — shows current amounts due for:
 *   - 2200 Sales Tax Payable
 *   - 2300 Payroll Liabilities
 *
 * Each tile has a "Pay" button that opens a modal where the user selects
 * a bank account, enters an amount and date, then posts the GL entry.
 */
import { useEffect, useState } from 'react';
import { Landmark, Receipt } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Select,
  Label,
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

interface DueAmounts {
  salesTaxDue: string;
  payrollLiabilitiesDue: string;
}

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype: string;
}

type LiabilityType = 'sales_tax' | 'payroll';

interface PayForm {
  amount: string;
  date: string;
  paymentAccountId: string;
  memo: string;
}

const today = () => new Date().toISOString().split('T')[0];

const EMPTY_FORM: PayForm = {
  amount: '',
  date: today(),
  paymentAccountId: '',
  memo: '',
};

// ---------------------------------------------------------------------------
// Liability tile
// ---------------------------------------------------------------------------

function LiabilityTile({
  icon: Icon,
  label,
  accountCode,
  amount,
  onPay,
}: {
  icon: React.ElementType;
  label: string;
  accountCode: string;
  amount: string;
  onPay: () => void;
}) {
  const isZero = Number(amount) === 0;
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-electric/10">
          <Icon className="h-5 w-5 text-electric" />
        </span>
        <div>
          <p className="text-xs font-semibold text-navy/50 uppercase tracking-wide">{accountCode}</p>
          <p className="text-base font-bold text-navy">{label}</p>
        </div>
      </div>

      <div>
        <p className="text-xs text-navy/50 mb-0.5">Amount Due</p>
        <p
          className={`text-3xl font-extrabold tabular-nums ${
            isZero ? 'text-navy/25' : 'text-red-500'
          }`}
        >
          {formatCurrency(amount)}
        </p>
      </div>

      <Button onClick={onPay} disabled={isZero} variant={isZero ? 'secondary' : 'primary'}>
        {isZero ? 'No balance due' : 'Pay Now'}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pay modal
// ---------------------------------------------------------------------------

function PayModal({
  open,
  type,
  accounts,
  onClose,
  onSuccess,
}: {
  open: boolean;
  type: LiabilityType | null;
  accounts: Account[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<PayForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Reset form whenever the modal opens
  useEffect(() => {
    if (open) setForm(EMPTY_FORM);
  }, [open]);

  function update(field: keyof PayForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit() {
    if (!form.amount || Number(form.amount) <= 0) {
      toast('Amount must be greater than zero.', 'danger');
      return;
    }
    if (!form.date) {
      toast('Date is required.', 'danger');
      return;
    }
    if (!form.paymentAccountId) {
      toast('Please select a bank / payment account.', 'danger');
      return;
    }

    setSaving(true);
    try {
      await api.post('/api/pay-liabilities', {
        type,
        amount: parseFloat(form.amount).toFixed(2),
        date: new Date(form.date).toISOString(),
        paymentAccountId: form.paymentAccountId,
        memo: form.memo.trim() || undefined,
      });
      toast(
        type === 'sales_tax' ? 'Sales tax payment recorded.' : 'Payroll liability payment recorded.',
        'success',
      );
      onSuccess();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to record payment.', 'danger');
    } finally {
      setSaving(false);
    }
  }

  const title =
    type === 'sales_tax' ? 'Pay Sales Tax (2200)' : 'Pay Payroll Liabilities (2300)';

  // Only offer asset accounts as payment sources (bank, checking, savings)
  const bankAccounts = accounts.filter((a) => a.type === 'asset');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving...' : 'Record Payment'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <Label htmlFor="amount">Amount to Pay</Label>
          <Input
            id="amount"
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={form.amount}
            onChange={(e) => update('amount', e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="payDate">Payment Date</Label>
          <Input
            id="payDate"
            type="date"
            value={form.date}
            onChange={(e) => update('date', e.target.value)}
          />
        </div>

        <div>
          <Label htmlFor="payAccount">Payment Account (Bank)</Label>
          <Select
            id="payAccount"
            value={form.paymentAccountId}
            onChange={(e) => update('paymentAccountId', e.target.value)}
          >
            <option value="">Select account…</option>
            {bankAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <Label htmlFor="memo">Memo (optional)</Label>
          <Input
            id="memo"
            placeholder="e.g. Q1 sales tax remittance"
            value={form.memo}
            onChange={(e) => update('memo', e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PayLiabilitiesPage() {
  const [due, setDue] = useState<DueAmounts>({ salesTaxDue: '0.00', payrollLiabilitiesDue: '0.00' });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [payType, setPayType] = useState<LiabilityType | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  async function fetchData() {
    setLoading(true);
    try {
      const [dueData, acctData] = await Promise.all([
        api.get<DueAmounts>('/api/pay-liabilities'),
        api.get<Account[]>('/api/accounts'),
      ]);
      setDue(dueData);
      setAccounts(acctData);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load data.', 'danger');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openPayModal(type: LiabilityType) {
    setPayType(type);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setPayType(null);
  }

  async function handleSuccess() {
    closeModal();
    await fetchData();
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader title="Pay Liabilities" icon={Landmark} />

      {loading ? (
        <div className="mt-8 text-center text-navy/40 text-sm">Loading...</div>
      ) : (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
          <Card>
            <LiabilityTile
              icon={Receipt}
              label="Sales Tax Payable"
              accountCode="2200"
              amount={due.salesTaxDue}
              onPay={() => openPayModal('sales_tax')}
            />
          </Card>

          <Card>
            <LiabilityTile
              icon={Landmark}
              label="Payroll Liabilities"
              accountCode="2300"
              amount={due.payrollLiabilitiesDue}
              onPay={() => openPayModal('payroll')}
            />
          </Card>
        </div>
      )}

      <PayModal
        open={modalOpen}
        type={payType}
        accounts={accounts}
        onClose={closeModal}
        onSuccess={handleSuccess}
      />

      <Toaster />
    </main>
  );
}
