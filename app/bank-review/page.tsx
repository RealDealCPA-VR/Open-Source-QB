'use client';

/**
 * Bank Review — "Add to register" / "Match" UI for staged bank-feed transactions.
 *
 * Workflow:
 *  1. Pick a bank account from the dropdown.
 *  2. Each unmatched row has an account Select (pre-filled from suggestedAccountId)
 *     and an "Add" button that calls POST /api/bank-transactions/categorize.
 *  3. "Apply Rules" button calls POST /api/bank-transactions/bulk {action:'applyRules'}
 *     to auto-fill suggestions without posting.
 *  4. "Auto-add Suggested" button calls POST /api/bank-transactions/bulk {action:'categorizeSuggested'}
 *     to post all rows that already have a suggestion.
 *  5. Matched rows show a green check and cannot be recategorized from this view.
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, CreditCard } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Label,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
  Toaster,
  Tr,
  toast,
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
  bankName: string;
  accountNumber: string;
  glAccountName: string;
  glAccountCode: string;
}

interface BankTransaction {
  id: string;
  date: string;
  description: string | null;
  payee: string | null;
  amount: string;
  matched: boolean;
  matchedEntryId: string | null;
  suggestedAccountId: string | null;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BankReviewPage() {
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allAccounts, setAllAccounts] = useState<Account[]>([]);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);

  // Per-row selected account (from user's dropdown choice)
  const [rowAccountId, setRowAccountId] = useState<Record<string, string>>({});

  const [loadingBankAccounts, setLoadingBankAccounts] = useState(true);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  // ------------------------------------------------------------------
  // Data fetching
  // ------------------------------------------------------------------

  const fetchBankAccounts = useCallback(async () => {
    setLoadingBankAccounts(true);
    try {
      const data = await api.get<BankAccount[]>('/api/bank-accounts');
      setBankAccounts(data);
      if (data.length > 0 && !selectedBankAccountId) {
        setSelectedBankAccountId(data[0].id);
      }
    } catch {
      toast('Failed to load bank accounts.', 'danger');
    } finally {
      setLoadingBankAccounts(false);
    }
  }, [selectedBankAccountId]);

  const fetchAccounts = useCallback(async () => {
    try {
      const data = await api.get<Account[]>('/api/accounts');
      setAllAccounts(data);
    } catch {
      toast('Failed to load GL accounts.', 'danger');
    }
  }, []);

  const fetchTransactions = useCallback(async (bankAccountId: string) => {
    if (!bankAccountId) return;
    setLoadingTxns(true);
    try {
      const data = await api.get<BankTransaction[]>(
        `/api/bank-transactions?bankAccountId=${bankAccountId}`,
      );
      setTransactions(data);
      // Pre-fill per-row selections from suggestedAccountId.
      const initial: Record<string, string> = {};
      for (const txn of data) {
        if (txn.suggestedAccountId) initial[txn.id] = txn.suggestedAccountId;
      }
      setRowAccountId((prev) => ({ ...initial, ...prev }));
    } catch {
      toast('Failed to load transactions.', 'danger');
    } finally {
      setLoadingTxns(false);
    }
  }, []);

  useEffect(() => {
    fetchBankAccounts();
    fetchAccounts();
  }, [fetchBankAccounts, fetchAccounts]);

  useEffect(() => {
    if (selectedBankAccountId) {
      fetchTransactions(selectedBankAccountId);
    }
  }, [selectedBankAccountId, fetchTransactions]);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  async function handleAdd(txn: BankTransaction) {
    const accountId = rowAccountId[txn.id];
    if (!accountId) {
      toast('Select an account first.', 'danger');
      return;
    }
    setAddingId(txn.id);
    try {
      await api.post('/api/bank-transactions/categorize', {
        bankTransactionId: txn.id,
        accountId,
      });
      toast('Transaction added to register.', 'success');
      await fetchTransactions(selectedBankAccountId);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to categorize.', 'danger');
    } finally {
      setAddingId(null);
    }
  }

  async function handleBulk(action: 'applyRules' | 'categorizeSuggested') {
    if (!selectedBankAccountId) return;
    setBulkRunning(true);
    try {
      const result = await api.post<{ count: number }>('/api/bank-transactions/bulk', {
        bankAccountId: selectedBankAccountId,
        action,
      });
      if (action === 'applyRules') {
        toast(`Rules applied: ${result.count} transaction(s) have a suggestion.`, 'success');
      } else {
        toast(`Auto-added ${result.count} transaction(s) to the register.`, 'success');
      }
      await fetchTransactions(selectedBankAccountId);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Bulk action failed.', 'danger');
    } finally {
      setBulkRunning(false);
    }
  }

  // ------------------------------------------------------------------
  // Derived stats
  // ------------------------------------------------------------------

  const unmatchedCount = transactions.filter((t) => !t.matched).length;
  const matchedCount   = transactions.filter((t) => t.matched).length;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <Toaster />
      <PageHeader title="Bank Review" icon={CreditCard} />

      {/* ------------------------------------------------------------------ */}
      {/* Bank account selector + bulk actions                                 */}
      {/* ------------------------------------------------------------------ */}
      <Card className="p-6 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[240px]">
            <Label htmlFor="bank-account-select">Bank Account</Label>
            {loadingBankAccounts ? (
              <p className="text-sm text-navy/50 mt-1">Loading…</p>
            ) : (
              <Select
                id="bank-account-select"
                value={selectedBankAccountId}
                onChange={(e) => {
                  setSelectedBankAccountId(e.target.value);
                  setRowAccountId({});
                }}
              >
                {bankAccounts.length === 0 && (
                  <option value="">No bank accounts — add one in Banking.</option>
                )}
                {bankAccounts.map((ba) => (
                  <option key={ba.id} value={ba.id}>
                    {ba.bankName}
                    {ba.accountNumber ? ` (…${ba.accountNumber})` : ''} — {ba.glAccountCode}{' '}
                    {ba.glAccountName}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="secondary"
              size="sm"
              disabled={bulkRunning || !selectedBankAccountId}
              onClick={() => handleBulk('applyRules')}
            >
              Apply Rules
            </Button>
            <Button
              size="sm"
              disabled={bulkRunning || !selectedBankAccountId}
              onClick={() => handleBulk('categorizeSuggested')}
            >
              Auto-add Suggested
            </Button>
          </div>
        </div>

        {/* Summary badges */}
        {transactions.length > 0 && (
          <div className="flex gap-3 mt-4">
            <Badge tone="neutral">{transactions.length} total</Badge>
            <Badge tone="warning">{unmatchedCount} to review</Badge>
            <Badge tone="success">{matchedCount} added</Badge>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Transactions table                                                   */}
      {/* ------------------------------------------------------------------ */}
      <Card className="p-6">
        <h2 className="text-lg font-bold text-navy mb-4">Transactions</h2>

        {loadingTxns ? (
          <p className="text-sm text-navy/50 py-6 text-center">Loading transactions…</p>
        ) : !selectedBankAccountId ? (
          <p className="text-sm text-navy/50 py-6 text-center">
            Select a bank account above to review transactions.
          </p>
        ) : transactions.length === 0 ? (
          <p className="text-sm text-navy/50 py-6 text-center">
            No staged transactions. Import a bank file in the Banking page first.
          </p>
        ) : (
          <Table>
            <thead>
              <Tr>
                <Th>Date</Th>
                <Th>Description / Payee</Th>
                <Th className="text-right">Amount</Th>
                <Th>Category Account</Th>
                <Th className="text-center">Status</Th>
              </Tr>
            </thead>
            <tbody>
              {transactions.map((txn) => {
                const isMatched = txn.matched;
                const amt = parseFloat(txn.amount);
                const amtPositive = amt >= 0;

                return (
                  <Tr
                    key={txn.id}
                    className={isMatched ? 'opacity-60' : undefined}
                  >
                    {/* Date */}
                    <Td className="whitespace-nowrap text-sm font-mono">
                      {new Date(txn.date).toLocaleDateString()}
                    </Td>

                    {/* Description */}
                    <Td>
                      <div className="text-sm font-medium">
                        {txn.payee || txn.description || '—'}
                      </div>
                      {txn.payee && txn.description && (
                        <div className="text-xs text-navy/50">{txn.description}</div>
                      )}
                    </Td>

                    {/* Amount */}
                    <Td className="text-right whitespace-nowrap">
                      <span
                        className={`font-mono text-sm font-semibold ${
                          amtPositive ? 'text-emerald' : 'text-red-500'
                        }`}
                      >
                        {formatCurrency(Math.abs(amt))}
                        {amtPositive ? (
                          <span className="ml-1 text-xs font-normal text-navy/40">IN</span>
                        ) : (
                          <span className="ml-1 text-xs font-normal text-navy/40">OUT</span>
                        )}
                      </span>
                    </Td>

                    {/* Category Select + Add button */}
                    <Td>
                      {isMatched ? (
                        <span className="text-sm text-navy/50">
                          {allAccounts.find((a) => a.id === txn.suggestedAccountId)?.name ??
                            'Categorized'}
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Select
                            className="min-w-[180px]"
                            value={rowAccountId[txn.id] ?? ''}
                            onChange={(e) =>
                              setRowAccountId((prev) => ({
                                ...prev,
                                [txn.id]: e.target.value,
                              }))
                            }
                          >
                            <option value="">Select account…</option>
                            {allAccounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} — {a.name}
                              </option>
                            ))}
                          </Select>
                          <Button
                            size="sm"
                            disabled={addingId === txn.id || !rowAccountId[txn.id]}
                            onClick={() => handleAdd(txn)}
                          >
                            {addingId === txn.id ? 'Adding…' : 'Add'}
                          </Button>
                        </div>
                      )}
                    </Td>

                    {/* Status */}
                    <Td className="text-center">
                      {isMatched ? (
                        <span className="inline-flex items-center gap-1 text-emerald text-sm font-semibold">
                          <CheckCircle className="h-4 w-4" />
                          Added
                        </span>
                      ) : txn.suggestedAccountId ? (
                        <Badge tone="info">Suggested</Badge>
                      ) : (
                        <Badge tone="warning">Review</Badge>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </main>
  );
}
