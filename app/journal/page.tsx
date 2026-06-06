'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  BookText,
  Plus,
  Trash2,
  PlusCircle,
  MinusCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
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

interface JournalEntry {
  id: string;
  entryNumber: number;
  date: string;
  description: string;
  reference: string | null;
  status: string;
  createdAt: string;
  voidedAt: string | null;
}

interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
}

interface ClassOption {
  id: string;
  name: string;
}

interface LineRow {
  id: number; // client-side key only
  accountId: string;
  debit: string;
  credit: string;
  classId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function sumLines(lines: LineRow[], field: 'debit' | 'credit'): number {
  return lines.reduce((acc, l) => acc + (Number(l[field]) || 0), 0);
}

function isBalanced(lines: LineRow[]): boolean {
  const d = sumLines(lines, 'debit');
  const c = sumLines(lines, 'credit');
  return Math.abs(d - c) < 0.005 && d > 0;
}

function hasEnoughLines(lines: LineRow[]): boolean {
  return lines.filter((l) => l.accountId).length >= 2;
}

function statusTone(status: string): 'success' | 'danger' | 'neutral' {
  if (status === 'posted') return 'success';
  if (status === 'voided') return 'danger';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// New-entry modal
// ---------------------------------------------------------------------------

function emptyLine(id: number): LineRow {
  return { id, accountId: '', debit: '', credit: '', classId: '' };
}

let lineCounter = 0;

interface NewEntryModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  accounts: Account[];
  classes: ClassOption[];
}

function NewEntryModal({ open, onClose, onSaved, accounts, classes }: NewEntryModalProps) {
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<LineRow[]>(() => [
    emptyLine(++lineCounter),
    emptyLine(++lineCounter),
  ]);
  const [saving, setSaving] = useState(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setDate(todayISO());
      setDescription('');
      setReference('');
      setLines([emptyLine(++lineCounter), emptyLine(++lineCounter)]);
      setSaving(false);
    }
  }, [open]);

  const updateLine = (id: number, field: keyof LineRow, value: string) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        // Entering debit clears credit and vice versa
        if (field === 'debit' && value) return { ...l, debit: value, credit: '' };
        if (field === 'credit' && value) return { ...l, credit: value, debit: '' };
        return { ...l, [field]: value };
      }),
    );
  };

  const updateLineClass = (id: number, classId: string) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, classId } : l)));
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine(++lineCounter)]);
  const removeLine = (id: number) =>
    setLines((prev) => (prev.length > 2 ? prev.filter((l) => l.id !== id) : prev));

  const totalDebits = sumLines(lines, 'debit');
  const totalCredits = sumLines(lines, 'credit');
  const balanced = isBalanced(lines);
  const enoughLines = hasEnoughLines(lines);
  const canSubmit = balanced && enoughLines && description.trim() && date;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const payload = {
        date,
        description: description.trim(),
        reference: reference.trim() || undefined,
        lines: lines
          .filter((l) => l.accountId)
          .map((l) => ({
            accountId: l.accountId,
            debit: l.debit ? l.debit : undefined,
            credit: l.credit ? l.credit : undefined,
            classId: l.classId || null,
          })),
      };
      await api.post('/api/journal-entries', payload);
      toast('Journal entry posted', 'success');
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to post entry';
      toast(msg, 'danger');
    } finally {
      setSaving(false);
    }
  };

  const BalancedIndicator = () => {
    if (totalDebits === 0 && totalCredits === 0) return null;
    return balanced ? (
      <span className="flex items-center gap-1 text-emerald-600 text-sm font-semibold">
        <CheckCircle2 className="h-4 w-4" /> Balanced
      </span>
    ) : (
      <span className="flex items-center gap-1 text-red-500 text-sm font-semibold">
        <XCircle className="h-4 w-4" /> Unbalanced
        <span className="text-xs font-normal text-navy/60 ml-1">
          (diff: {formatCurrency(Math.abs(totalDebits - totalCredits))})
        </span>
      </span>
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Journal Entry"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || saving}>
            {saving ? 'Posting…' : 'Post Entry'}
          </Button>
        </>
      }
    >
      {/* Header fields */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div>
          <Label htmlFor="je-date">Date</Label>
          <Input
            id="je-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="je-ref">Reference (optional)</Label>
          <Input
            id="je-ref"
            placeholder="e.g. JE-001"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <Label htmlFor="je-desc">Description</Label>
          <Input
            id="je-desc"
            placeholder="Memo / narration"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      {/* Line items */}
      <div className="mb-3">
        <div className="grid grid-cols-[1fr_140px_100px_100px_28px] gap-2 mb-1 px-1">
          <span className="text-xs font-semibold text-navy/50 uppercase tracking-wide">Account</span>
          <span className="text-xs font-semibold text-navy/50 uppercase tracking-wide">Class</span>
          <span className="text-xs font-semibold text-navy/50 uppercase tracking-wide text-right">Debit</span>
          <span className="text-xs font-semibold text-navy/50 uppercase tracking-wide text-right">Credit</span>
          <span />
        </div>

        <div className="flex flex-col gap-2">
          {lines.map((line) => (
            <div
              key={line.id}
              className="grid grid-cols-[1fr_140px_100px_100px_28px] gap-2 items-center"
            >
              <Select
                value={line.accountId}
                onChange={(e) => updateLine(line.id, 'accountId', e.target.value)}
              >
                <option value="">— Select account —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </Select>

              <Select
                value={line.classId}
                onChange={(e) => updateLineClass(line.id, e.target.value)}
              >
                <option value="">— No class —</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>

              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={line.debit}
                onChange={(e) => updateLine(line.id, 'debit', e.target.value)}
                className="text-right"
              />

              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={line.credit}
                onChange={(e) => updateLine(line.id, 'credit', e.target.value)}
                className="text-right"
              />

              <button
                type="button"
                onClick={() => removeLine(line.id)}
                disabled={lines.length <= 2}
                className="text-red-400 hover:text-red-600 disabled:opacity-20 transition-colors"
                title="Remove line"
              >
                <MinusCircle className="h-5 w-5" />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addLine}
          className="mt-3 flex items-center gap-1.5 text-electric text-sm font-medium hover:text-electric/80 transition-colors"
        >
          <PlusCircle className="h-4 w-4" /> Add line
        </button>
      </div>

      {/* Totals + balance indicator */}
      <div className="border-t border-slate-100 pt-4 mt-2">
        <div className="grid grid-cols-[1fr_140px_100px_100px_28px] gap-2 items-center">
          <span className="text-sm font-bold text-navy text-right">Totals</span>
          <span />
          <span className="text-sm font-bold text-navy text-right tabular-nums">
            {formatCurrency(totalDebits)}
          </span>
          <span className="text-sm font-bold text-navy text-right tabular-nums">
            {formatCurrency(totalCredits)}
          </span>
          <span />
        </div>
        <div className="mt-2 flex justify-end">
          <BalancedIndicator />
        </div>
        {!enoughLines && (
          <p className="text-xs text-navy/40 text-right mt-1">
            Select an account for at least 2 lines.
          </p>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Void confirmation modal
// ---------------------------------------------------------------------------

interface VoidModalProps {
  entry: JournalEntry | null;
  onClose: () => void;
  onVoided: () => void;
}

function VoidModal({ entry, onClose, onVoided }: VoidModalProps) {
  const [loading, setLoading] = useState(false);

  const handleVoid = async () => {
    if (!entry) return;
    setLoading(true);
    try {
      await api.del(`/api/journal-entries/${entry.id}`);
      toast('Entry voided', 'success');
      onVoided();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to void entry';
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={!!entry}
      onClose={onClose}
      title="Void Journal Entry"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleVoid} disabled={loading}>
            {loading ? 'Voiding…' : 'Void Entry'}
          </Button>
        </>
      }
    >
      <p className="text-navy/80 text-sm">
        Are you sure you want to void{' '}
        <span className="font-semibold">#{entry?.entryNumber}</span> — &ldquo;
        {entry?.description}&rdquo;? This will reverse all balance impacts and cannot be undone.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [voidTarget, setVoidTarget] = useState<JournalEntry | null>(null);

  const fetchEntries = useCallback(async () => {
    try {
      const data = await api.get<{ entries: JournalEntry[] }>('/api/journal-entries');
      setEntries(data.entries);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load journal entries';
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAccounts = useCallback(async () => {
    try {
      const data = await api.get<Account[]>('/api/accounts');
      setAccounts(data);
    } catch {
      // non-fatal — modal will show empty account list
    }
  }, []);

  const fetchClasses = useCallback(async () => {
    try {
      const data = await api.get<ClassOption[]>('/api/classes');
      setClasses(data);
    } catch {
      // non-fatal — class column will show no options
    }
  }, []);

  useEffect(() => {
    fetchEntries();
    fetchAccounts();
    fetchClasses();
  }, [fetchEntries, fetchAccounts, fetchClasses]);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Journal Entries"
        icon={BookText}
        action={
          <Button onClick={() => setShowNew(true)}>
            <Plus className="h-4 w-4" /> New Journal Entry
          </Button>
        }
      />

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-navy/40 text-sm">Loading entries…</div>
        ) : entries.length === 0 ? (
          <div className="p-12 text-center">
            <BookText className="h-10 w-10 text-navy/20 mx-auto mb-3" />
            <p className="text-navy/50 text-sm">No journal entries yet.</p>
            <p className="text-navy/35 text-xs mt-1">
              Click <span className="font-semibold">New Journal Entry</span> to record the first transaction.
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Date</Th>
                <Th>Description</Th>
                <Th>Reference</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <Tr key={entry.id}>
                  <Td className="font-mono text-xs text-navy/60">{entry.entryNumber}</Td>
                  <Td className="whitespace-nowrap">{formatDate(entry.date)}</Td>
                  <Td className="max-w-xs truncate" title={entry.description}>
                    {entry.description}
                  </Td>
                  <Td className="text-navy/50 text-xs">{entry.reference ?? '—'}</Td>
                  <Td>
                    <Badge tone={statusTone(entry.status)}>
                      {entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                    </Badge>
                  </Td>
                  <Td className="text-right">
                    {entry.status === 'posted' && (
                      <button
                        type="button"
                        onClick={() => setVoidTarget(entry)}
                        className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                        title="Void this entry"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Void
                      </button>
                    )}
                    {entry.status === 'voided' && (
                      <span className="text-xs text-navy/30 italic">Voided</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <NewEntryModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onSaved={fetchEntries}
        accounts={accounts}
        classes={classes}
      />

      <VoidModal
        entry={voidTarget}
        onClose={() => setVoidTarget(null)}
        onVoided={fetchEntries}
      />
    </main>
  );
}
