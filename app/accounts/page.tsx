'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
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

// ---- Types ----------------------------------------------------------------

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: string;
  balance: string;
  isActive: boolean;
  description?: string | null;
  parentId?: string | null;
}

// Map API type values -> display labels (API uses singular lowercase)
const TYPE_LABELS: Record<AccountType, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expenses',
};

// Ordered for display
const TYPE_ORDER: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];

// ---- Add Account Modal ----------------------------------------------------

interface AddAccountModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const EMPTY_FORM = { code: '', name: '', type: 'asset' as AccountType, subtype: '' };

function AddAccountModal({ open, onClose, onCreated }: AddAccountModalProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (open) setForm(EMPTY_FORM);
  }, [open]);

  function set(field: keyof typeof EMPTY_FORM, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code.trim()) { toast('Account code is required.', 'danger'); return; }
    if (!form.name.trim()) { toast('Account name is required.', 'danger'); return; }
    setSaving(true);
    try {
      await api.post('/api/accounts', {
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type,
        subtype: form.subtype.trim() || form.type,
      });
      toast('Account created.', 'success');
      onCreated();
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to create account.', 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Account"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit as never} disabled={saving}>
            {saving ? 'Saving…' : 'Create Account'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <Label htmlFor="acc-code">Account Code *</Label>
          <Input
            id="acc-code"
            placeholder="e.g. 1010"
            value={form.code}
            onChange={(e) => set('code', e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="acc-name">Account Name *</Label>
          <Input
            id="acc-name"
            placeholder="e.g. Checking Account"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="acc-type">Type *</Label>
          <Select
            id="acc-type"
            value={form.type}
            onChange={(e) => set('type', e.target.value as AccountType)}
          >
            <option value="asset">Asset</option>
            <option value="liability">Liability</option>
            <option value="equity">Equity</option>
            <option value="revenue">Revenue</option>
            <option value="expense">Expense</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="acc-subtype">Subtype</Label>
          <Input
            id="acc-subtype"
            placeholder="e.g. checking, accounts_receivable"
            value={form.subtype}
            onChange={(e) => set('subtype', e.target.value)}
          />
        </div>
      </form>
    </Modal>
  );
}

// ---- Confirm Deactivate Modal ---------------------------------------------

interface ConfirmDeactivateModalProps {
  account: Account | null;
  onClose: () => void;
  onDeactivated: () => void;
}

function ConfirmDeactivateModal({ account, onClose, onDeactivated }: ConfirmDeactivateModalProps) {
  const [busy, setBusy] = useState(false);

  async function handleDeactivate() {
    if (!account) return;
    setBusy(true);
    try {
      await api.del(`/api/accounts/${account.id}`);
      toast(`"${account.name}" deactivated.`, 'success');
      onDeactivated();
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to deactivate account.', 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={!!account}
      onClose={onClose}
      title="Deactivate Account"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDeactivate} disabled={busy}>
            {busy ? 'Deactivating…' : 'Deactivate'}
          </Button>
        </>
      }
    >
      <p className="text-navy/70 text-sm">
        Are you sure you want to deactivate{' '}
        <span className="font-semibold text-navy">{account?.name}</span>? It will be hidden from
        the chart of accounts but preserved in historical reports.
      </p>
    </Modal>
  );
}

// ---- Account Group Section ------------------------------------------------

interface AccountGroupProps {
  type: AccountType;
  accounts: Account[];
  onDeactivate: (account: Account) => void;
}

function AccountGroup({ type, accounts, onDeactivate }: AccountGroupProps) {
  const [collapsed, setCollapsed] = useState(false);
  const label = TYPE_LABELS[type];

  // Compute group total
  const total = accounts.reduce((sum, a) => sum + Number(a.balance), 0);

  return (
    <div className="mb-6">
      {/* Group header */}
      <button
        className="w-full flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-navy/5 to-transparent rounded-xl mb-1 hover:from-navy/10 transition-colors"
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 text-navy/50 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-navy/50 shrink-0" />
        )}
        <span className="text-sm font-bold text-navy uppercase tracking-wide flex-1 text-left">
          {label}
        </span>
        <span className="text-sm font-semibold text-navy/60 tabular-nums">
          {formatCurrency(String(total))}
        </span>
        <Badge tone="info">{accounts.length}</Badge>
      </button>

      {!collapsed && (
        <Table>
          <thead>
            <tr>
              <Th className="w-24">Code</Th>
              <Th>Name</Th>
              <Th>Subtype</Th>
              <Th className="text-right">Balance</Th>
              <Th className="w-24 text-center">Status</Th>
              <Th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <Tr>
                <Td colSpan={6} className="text-center text-navy/40 py-6 italic">
                  No {label.toLowerCase()} accounts yet.
                </Td>
              </Tr>
            ) : (
              accounts.map((account) => (
                <Tr key={account.id}>
                  <Td>
                    <span className="font-mono text-xs text-navy/60">{account.code}</span>
                  </Td>
                  <Td>
                    <span className="font-medium text-navy">{account.name}</span>
                  </Td>
                  <Td>
                    <span className="text-navy/50 text-xs">{account.subtype}</span>
                  </Td>
                  <Td className="text-right tabular-nums font-semibold text-navy">
                    {formatCurrency(account.balance)}
                  </Td>
                  <Td className="text-center">
                    <Badge tone="success">Active</Badge>
                  </Td>
                  <Td className="text-center">
                    <button
                      className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Deactivate account"
                      onClick={() => onDeactivate(account)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      )}
    </div>
  );
}

// ---- Main Page ------------------------------------------------------------

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<Account | null>(null);

  async function fetchAccounts() {
    try {
      const data = await api.get<Account[]>('/api/accounts');
      setAccounts(data);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load accounts.', 'danger');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAccounts();
  }, []);

  // Group by type in display order
  const grouped = TYPE_ORDER.map((type) => ({
    type,
    accounts: accounts.filter((a) => a.type === type),
  }));

  const totalAccounts = accounts.length;

  return (
    <>
      <Toaster />
      <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
        <PageHeader
          title="Chart of Accounts"
          icon={BookOpen}
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add Account
            </Button>
          }
        />

        {loading ? (
          <Card className="p-12 text-center text-navy/40">
            <div className="animate-pulse text-lg">Loading accounts…</div>
          </Card>
        ) : totalAccounts === 0 ? (
          <Card className="p-16 flex flex-col items-center gap-4 text-center">
            <BookOpen className="h-12 w-12 text-navy/20" />
            <p className="text-navy/50 text-lg font-medium">No accounts yet.</p>
            <p className="text-navy/40 text-sm max-w-sm">
              Add your first account to build out your chart of accounts. Start with assets like a
              checking account.
            </p>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add Account
            </Button>
          </Card>
        ) : (
          <Card className="p-6">
            {grouped.map(({ type, accounts: typeAccounts }) => (
              <AccountGroup
                key={type}
                type={type}
                accounts={typeAccounts}
                onDeactivate={setDeactivateTarget}
              />
            ))}
          </Card>
        )}

        <AddAccountModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onCreated={fetchAccounts}
        />

        <ConfirmDeactivateModal
          account={deactivateTarget}
          onClose={() => setDeactivateTarget(null)}
          onDeactivated={fetchAccounts}
        />
      </main>
    </>
  );
}
