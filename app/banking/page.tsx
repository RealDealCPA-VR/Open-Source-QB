'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Landmark, Plus } from 'lucide-react';
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

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface BankAccount {
  id: string;
  accountId: string;
  bankName: string;
  accountNumber: string;
  lastReconciledDate: string | null;
  lastReconciledBalance: string | null;
  glAccountName: string;
  glAccountCode: string;
}

interface ImportSummary {
  fileImportId: string;
  parsed: number;
  imported: number;
  skippedDupes: number;
  errors: number;
}

interface Rule {
  id: string;
  name: string;
  matchField: string;
  matchOperator: string;
  matchValue: string;
  setAccountId: string;
  priority: number;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Add Bank Account Modal
// ---------------------------------------------------------------------------

function AddBankAccountModal({
  open,
  onClose,
  onAdded,
  glAccounts,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  glAccounts: Account[];
}) {
  const [accountId, setAccountId] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setAccountId('');
      setBankName('');
      setAccountNumber('');
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId || !bankName.trim()) {
      toast('GL account and bank name are required.', 'danger');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/bank-accounts', { accountId, bankName: bankName.trim(), accountNumber });
      toast('Bank account added.', 'success');
      onAdded();
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to add bank account.', 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Bank Account"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Add Account'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="ba-gl-account">GL Account (Asset or Liability)</Label>
          <Select
            id="ba-gl-account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            required
          >
            <option value="">Select account…</option>
            {glAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name} ({a.type})
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ba-bank-name">Bank Name</Label>
          <Input
            id="ba-bank-name"
            placeholder="e.g. Chase, Wells Fargo"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="ba-account-number">Account Number (last 4 digits)</Label>
          <Input
            id="ba-account-number"
            placeholder="e.g. 4321"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
          />
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Add Rule Modal
// ---------------------------------------------------------------------------

function AddRuleModal({
  open,
  onClose,
  onAdded,
  allAccounts,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
  allAccounts: Account[];
}) {
  const [name, setName] = useState('');
  const [matchField, setMatchField] = useState<'description' | 'payee' | 'amount'>('description');
  const [matchOperator, setMatchOperator] = useState<'contains' | 'equals' | 'starts_with'>(
    'contains',
  );
  const [matchValue, setMatchValue] = useState('');
  const [setAccountId, setSetAccountId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setMatchField('description');
      setMatchOperator('contains');
      setMatchValue('');
      setSetAccountId('');
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !matchValue.trim() || !setAccountId) {
      toast('Name, match value, and account are required.', 'danger');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/rules', {
        name: name.trim(),
        matchField,
        matchOperator,
        matchValue: matchValue.trim(),
        setAccountId,
      });
      toast('Categorization rule created.', 'success');
      onAdded();
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to create rule.', 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Categorization Rule"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? 'Saving…' : 'Add Rule'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="rule-name">Rule Name</Label>
          <Input
            id="rule-name"
            placeholder="e.g. Amazon purchases"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="rule-field">Match Field</Label>
            <Select
              id="rule-field"
              value={matchField}
              onChange={(e) =>
                setMatchField(e.target.value as 'description' | 'payee' | 'amount')
              }
            >
              <option value="description">Description</option>
              <option value="payee">Payee</option>
              <option value="amount">Amount</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="rule-operator">Operator</Label>
            <Select
              id="rule-operator"
              value={matchOperator}
              onChange={(e) =>
                setMatchOperator(e.target.value as 'contains' | 'equals' | 'starts_with')
              }
            >
              <option value="contains">Contains</option>
              <option value="equals">Equals</option>
              <option value="starts_with">Starts with</option>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="rule-value">Match Value</Label>
          <Input
            id="rule-value"
            placeholder="e.g. amazon"
            value={matchValue}
            onChange={(e) => setMatchValue(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="rule-account">Assign to Account</Label>
          <Select
            id="rule-account"
            value={setAccountId}
            onChange={(e) => setSetAccountId(e.target.value)}
            required
          >
            <option value="">Select account…</option>
            {allAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </Select>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    bookkeeper?: {
      openFile?: (opts?: { filters?: { name: string; extensions: string[] }[] }) => Promise<
        { content: string; filename: string } | null
      >;
    };
  }
}

export default function BankingPage() {
  // Data state
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [glAccounts, setGlAccounts] = useState<Account[]>([]);
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);

  // Loading
  const [loadingBankAccounts, setLoadingBankAccounts] = useState(true);
  const [loadingRules, setLoadingRules] = useState(true);

  // Modals
  const [showAddBankAccount, setShowAddBankAccount] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);

  // Import form
  const [importBankAccountId, setImportBankAccountId] = useState('');
  const [importFileType, setImportFileType] = useState<'ofx' | 'qbo' | 'csv'>('ofx');
  const [importContent, setImportContent] = useState('');
  const [importFilename, setImportFilename] = useState('');
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);

  // CSV mapping (simple mode: column names)
  const [csvDateCol, setCsvDateCol] = useState('Date');
  const [csvDescCol, setCsvDescCol] = useState('Description');
  const [csvAmountCol, setCsvAmountCol] = useState('Amount');

  // Fetch helpers
  const fetchBankAccounts = useCallback(async () => {
    setLoadingBankAccounts(true);
    try {
      const data = await api.get<BankAccount[]>('/api/bank-accounts');
      setBankAccounts(data);
    } catch {
      toast('Failed to load bank accounts.', 'danger');
    } finally {
      setLoadingBankAccounts(false);
    }
  }, []);

  const fetchRules = useCallback(async () => {
    setLoadingRules(true);
    try {
      const data = await api.get<Rule[]>('/api/rules');
      setRules(data);
    } catch {
      toast('Failed to load categorization rules.', 'danger');
    } finally {
      setLoadingRules(false);
    }
  }, []);

  const fetchAccounts = useCallback(async () => {
    try {
      const data = await api.get<Account[]>('/api/accounts');
      setAllAccounts(data);
      setGlAccounts(data.filter((a) => a.type === 'asset' || a.type === 'liability'));
    } catch {
      toast('Failed to load GL accounts.', 'danger');
    }
  }, []);

  useEffect(() => {
    fetchBankAccounts();
    fetchRules();
    fetchAccounts();
  }, [fetchBankAccounts, fetchRules, fetchAccounts]);

  // Auto-select first bank account for import when list loads
  useEffect(() => {
    if (bankAccounts.length > 0 && !importBankAccountId) {
      setImportBankAccountId(bankAccounts[0].id);
    }
  }, [bankAccounts, importBankAccountId]);

  // Electron file picker
  async function handleOpenFile() {
    const extensions: Record<string, string[]> = {
      ofx: ['ofx'],
      qbo: ['qbo'],
      csv: ['csv'],
    };
    if (window.bookkeeper?.openFile) {
      const result = await window.bookkeeper.openFile({
        filters: [{ name: 'Bank file', extensions: extensions[importFileType] ?? ['*'] }],
      });
      if (result) {
        setImportContent(result.content);
        setImportFilename(result.filename);
        toast(`Loaded: ${result.filename}`, 'info');
      }
    } else {
      toast('File picker is only available in the desktop app. Paste content below.', 'info');
    }
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importBankAccountId) {
      toast('Select a bank account first.', 'danger');
      return;
    }
    if (!importContent.trim()) {
      toast('Paste or load the file content.', 'danger');
      return;
    }
    setImporting(true);
    setImportSummary(null);
    try {
      const body: Record<string, unknown> = {
        bankAccountId: importBankAccountId,
        fileType: importFileType,
        content: importContent,
        ...(importFilename ? { filename: importFilename } : {}),
      };
      if (importFileType === 'csv') {
        body.csvMapping = {
          dateCol: csvDateCol,
          descriptionCol: csvDescCol,
          amountCol: csvAmountCol,
        };
      }
      const summary = await api.post<ImportSummary>('/api/import', body);
      setImportSummary(summary);
      toast(
        `Import complete: ${summary.imported} imported, ${summary.skippedDupes} duplicates skipped.`,
        'success',
      );
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Import failed.', 'danger');
    } finally {
      setImporting(false);
    }
  }

  const operatorLabel: Record<string, string> = {
    contains: 'contains',
    equals: '=',
    starts_with: 'starts with',
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <Toaster />
      <PageHeader title="Banking" icon={Landmark} />

      {/* ------------------------------------------------------------------ */}
      {/* Card 1: Bank Accounts                                               */}
      {/* ------------------------------------------------------------------ */}
      <Card className="p-6 mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-navy">Bank Accounts</h2>
          <Button size="sm" onClick={() => setShowAddBankAccount(true)}>
            <Plus className="h-4 w-4" />
            Add Bank Account
          </Button>
        </div>

        {loadingBankAccounts ? (
          <p className="text-sm text-navy/50 py-4 text-center">Loading…</p>
        ) : bankAccounts.length === 0 ? (
          <p className="text-sm text-navy/50 py-4 text-center">
            No bank accounts yet. Add one to start importing transactions.
          </p>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Bank</Th>
                <Th>Account #</Th>
                <Th>GL Account</Th>
                <Th>Last Reconciled</Th>
                <Th className="text-right">Reconciled Balance</Th>
              </Tr>
            </thead>
            <tbody>
              {bankAccounts.map((ba) => (
                <Tr key={ba.id}>
                  <Td className="font-medium">{ba.bankName}</Td>
                  <Td className="font-mono text-sm">{ba.accountNumber || '—'}</Td>
                  <Td>
                    <span className="text-navy/60 text-xs mr-1">{ba.glAccountCode}</span>
                    {ba.glAccountName}
                  </Td>
                  <Td>
                    {ba.lastReconciledDate
                      ? new Date(ba.lastReconciledDate).toLocaleDateString()
                      : '—'}
                  </Td>
                  <Td className="text-right font-mono">
                    {ba.lastReconciledBalance != null
                      ? formatCurrency(ba.lastReconciledBalance)
                      : '—'}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Card 2: Import Transactions                                          */}
      {/* ------------------------------------------------------------------ */}
      <Card className="p-6 mb-8">
        <h2 className="text-lg font-bold text-navy mb-4">Import Transactions</h2>
        <form onSubmit={handleImport} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="import-bank-account">Bank Account</Label>
              <Select
                id="import-bank-account"
                value={importBankAccountId}
                onChange={(e) => setImportBankAccountId(e.target.value)}
                required
              >
                <option value="">Select bank account…</option>
                {bankAccounts.map((ba) => (
                  <option key={ba.id} value={ba.id}>
                    {ba.bankName} {ba.accountNumber ? `(…${ba.accountNumber})` : ''}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="import-file-type">File Type</Label>
              <Select
                id="import-file-type"
                value={importFileType}
                onChange={(e) => {
                  setImportFileType(e.target.value as 'ofx' | 'qbo' | 'csv');
                  setImportSummary(null);
                }}
              >
                <option value="ofx">OFX</option>
                <option value="qbo">QBO (QuickBooks Online)</option>
                <option value="csv">CSV</option>
              </Select>
            </div>
          </div>

          {/* CSV column mapping */}
          {importFileType === 'csv' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-lg bg-slate-50 border border-slate-200">
              <div>
                <Label htmlFor="csv-date">Date column</Label>
                <Input
                  id="csv-date"
                  value={csvDateCol}
                  onChange={(e) => setCsvDateCol(e.target.value)}
                  placeholder="Date"
                />
              </div>
              <div>
                <Label htmlFor="csv-desc">Description column</Label>
                <Input
                  id="csv-desc"
                  value={csvDescCol}
                  onChange={(e) => setCsvDescCol(e.target.value)}
                  placeholder="Description"
                />
              </div>
              <div>
                <Label htmlFor="csv-amount">Amount column</Label>
                <Input
                  id="csv-amount"
                  value={csvAmountCol}
                  onChange={(e) => setCsvAmountCol(e.target.value)}
                  placeholder="Amount"
                />
              </div>
            </div>
          )}

          {/* File loader (Electron) or paste */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label htmlFor="import-content">File Content</Label>
              <button
                type="button"
                onClick={handleOpenFile}
                className="text-xs text-electric underline hover:no-underline"
              >
                Open file…
              </button>
            </div>
            <textarea
              id="import-content"
              value={importContent}
              onChange={(e) => setImportContent(e.target.value)}
              rows={8}
              placeholder={`Paste your ${importFileType.toUpperCase()} file content here, or click "Open file…" above (desktop app only).`}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy font-mono outline-none focus:border-electric focus:ring-2 focus:ring-electric/30 placeholder:text-navy/30 resize-y"
            />
            {importFilename && (
              <p className="text-xs text-navy/50 mt-1">Loaded: {importFilename}</p>
            )}
          </div>

          <div className="flex items-center gap-4">
            <Button type="submit" disabled={importing}>
              {importing ? 'Importing…' : 'Import'}
            </Button>
            {importSummary && (
              <div className="flex gap-3 text-sm">
                <Badge tone="success">{importSummary.imported} imported</Badge>
                <Badge tone="neutral">{importSummary.skippedDupes} duplicates</Badge>
                <Badge tone="info">{importSummary.parsed} total parsed</Badge>
                {importSummary.errors > 0 && (
                  <Badge tone="danger">{importSummary.errors} errors</Badge>
                )}
              </div>
            )}
          </div>
        </form>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Card 3: Categorization Rules                                         */}
      {/* ------------------------------------------------------------------ */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-navy">Categorization Rules</h2>
          <Button size="sm" onClick={() => setShowAddRule(true)}>
            <Plus className="h-4 w-4" />
            Add Rule
          </Button>
        </div>

        {loadingRules ? (
          <p className="text-sm text-navy/50 py-4 text-center">Loading…</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-navy/50 py-4 text-center">
            No rules yet. Rules auto-categorize imported transactions.
          </p>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Name</Th>
                <Th>Condition</Th>
                <Th>Assign Account</Th>
                <Th className="text-right">Priority</Th>
              </Tr>
            </thead>
            <tbody>
              {rules.map((r) => {
                const acct = allAccounts.find((a) => a.id === r.setAccountId);
                return (
                  <Tr key={r.id}>
                    <Td className="font-medium">{r.name}</Td>
                    <Td className="text-sm">
                      <span className="text-navy/60">{r.matchField}</span>{' '}
                      <span className="text-electric font-medium">
                        {operatorLabel[r.matchOperator] ?? r.matchOperator}
                      </span>{' '}
                      <span className="font-mono bg-slate-100 px-1 rounded">{r.matchValue}</span>
                    </Td>
                    <Td>
                      {acct ? (
                        <>
                          <span className="text-navy/60 text-xs mr-1">{acct.code}</span>
                          {acct.name}
                        </>
                      ) : (
                        <span className="text-navy/40 text-xs">{r.setAccountId}</span>
                      )}
                    </Td>
                    <Td className="text-right">
                      <Badge tone="neutral">{r.priority}</Badge>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Modals */}
      <AddBankAccountModal
        open={showAddBankAccount}
        onClose={() => setShowAddBankAccount(false)}
        onAdded={fetchBankAccounts}
        glAccounts={glAccounts}
      />
      <AddRuleModal
        open={showAddRule}
        onClose={() => setShowAddRule(false)}
        onAdded={fetchRules}
        allAccounts={allAccounts}
      />
    </main>
  );
}
