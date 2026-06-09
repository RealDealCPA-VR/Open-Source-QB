'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import {
  NotebookPen,
  Plus,
  Trash2,
  Pencil,
  Undo2,
  PlusCircle,
  MinusCircle,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import {
  AmountInput,
  Button,
  Card,
  DateInput,
  Input,
  Select,
  Label,
  Badge,
  Table,
  Th,
  Td,
  Tr,
  Modal,
  ConfirmDialog,
  EmptyState,
  Spinner,
  PageHeader,
  toast,
  useGridKeys,
} from '@/components/ui';
import { api } from '@/lib/client';
import { formatCurrency } from '@/lib/money';
import { useNewParam } from '@/lib/useFocusParam';
import EntryDetailModal from '@/components/EntryDetailModal';

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
  sourceRef?: string | null;
  createdAt: string;
  voidedAt: string | null;
}

interface EntryDetailLine {
  id: string;
  accountId: string;
  debit: string | null;
  credit: string | null;
  memo: string | null;
  classId: string | null;
}

interface EntryDetail {
  id: string;
  entryNumber: number;
  date: string;
  description: string;
  reference: string | null;
  status: string;
  sourceRef: string | null;
  lines: EntryDetailLine[];
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
  memo: string;
  classId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** QB default reversing date: the 1st of the month after the entry date. */
function nextMonthFirstISO(entryDateISO: string): string {
  const d = new Date(entryDateISO);
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const mm = String(next.getMonth() + 1).padStart(2, '0');
  return `${next.getFullYear()}-${mm}-01`;
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

function statusTone(status: string): 'success' | 'void' | 'neutral' {
  if (status === 'posted') return 'success';
  if (status === 'void') return 'void';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// Entry form modal (create + edit)
// ---------------------------------------------------------------------------

function emptyLine(id: number): LineRow {
  return { id, accountId: '', debit: '', credit: '', memo: '', classId: '' };
}

let lineCounter = 0;

interface EntryFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  accounts: Account[];
  classes: ClassOption[];
  /** When set, the modal edits this entry (prefilled) instead of creating a new one. */
  editEntry: EntryDetail | null;
}

function EntryFormModal({ open, onClose, onSaved, accounts, classes, editEntry }: EntryFormModalProps) {
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<LineRow[]>(() => [
    emptyLine(++lineCounter),
    emptyLine(++lineCounter),
  ]);
  const [saving, setSaving] = useState(false);

  const editing = !!editEntry;

  // Reset / prefill on open
  useEffect(() => {
    if (!open) return;
    if (editEntry) {
      setDate(editEntry.date.slice(0, 10));
      setDescription(editEntry.description);
      setReference(editEntry.reference ?? '');
      setLines(
        editEntry.lines.map((l) => ({
          id: ++lineCounter,
          accountId: l.accountId,
          debit: l.debit ?? '',
          credit: l.credit ?? '',
          memo: l.memo ?? '',
          classId: l.classId ?? '',
        })),
      );
    } else {
      setDate(todayISO());
      setDescription('');
      setReference('');
      setLines([emptyLine(++lineCounter), emptyLine(++lineCounter)]);
    }
    setSaving(false);
  }, [open, editEntry]);

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

  const addLine = () => setLines((prev) => [...prev, emptyLine(++lineCounter)]);
  const removeLine = (id: number) =>
    setLines((prev) => (prev.length > 2 ? prev.filter((l) => l.id !== id) : prev));

  // Line-grid keyboard ergonomics: Ctrl+Insert add / Ctrl+Delete remove / Enter down.
  const grid = useGridKeys({
    addRow: addLine,
    removeRow: (idx) => {
      const line = lines[idx];
      if (line) removeLine(line.id);
    },
    disabled: saving,
  });

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
        reference: reference.trim() || null,
        lines: lines
          .filter((l) => l.accountId)
          .map((l) => ({
            accountId: l.accountId,
            debit: l.debit ? l.debit : undefined,
            credit: l.credit ? l.credit : undefined,
            memo: l.memo.trim() || null,
            classId: l.classId || null,
          })),
      };
      if (editing && editEntry) {
        await api.patch(`/api/journal-entries/${editEntry.id}`, payload);
        toast('Journal entry updated', 'success');
      } else {
        await api.post('/api/journal-entries', payload);
        toast('Journal entry posted', 'success');
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save entry';
      toast(msg, 'danger');
    } finally {
      setSaving(false);
    }
  };

  const BalancedIndicator = () => {
    if (totalDebits === 0 && totalCredits === 0) return null;
    return balanced ? (
      <span className="flex items-center gap-1 text-emerald text-sm font-semibold">
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

  const gridCols = 'grid-cols-[1fr_120px_130px_92px_92px_28px]';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit Journal Entry #${editEntry?.entryNumber}` : 'New Journal Entry'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={saving}>
            {editing ? 'Save Changes' : 'Post Entry'}
          </Button>
        </>
      }
    >
      {editing && (
        <p className="mb-4 rounded-lg bg-gold/10 border border-gold/30 px-3 py-2 text-xs text-navy/80">
          Saving voids the original entry and posts a corrected one; the audit trail keeps both
          versions.
        </p>
      )}

      {/* Header fields */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div>
          <Label htmlFor="je-date">Date</Label>
          <DateInput
            id="je-date"
            autoFocus
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
        <div className={`grid ${gridCols} gap-2 mb-1 px-1`}>
          <span className="text-xs font-semibold text-navy/50 uppercase tracking-wide">Account</span>
          <span className="text-xs font-semibold text-navy/50 uppercase tracking-wide">Class</span>
          <span className="text-xs font-semibold text-navy/50 uppercase tracking-wide">Memo</span>
          <span className="text-xs font-semibold text-navy/50 uppercase tracking-wide text-right">Debit</span>
          <span className="text-xs font-semibold text-navy/50 uppercase tracking-wide text-right">Credit</span>
          <span />
        </div>

        <div className="flex flex-col gap-2" onKeyDown={grid.onKeyDown}>
          {lines.map((line) => (
            <div key={line.id} data-grid-row className={`grid ${gridCols} gap-2 items-center`}>
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
                onChange={(e) => updateLine(line.id, 'classId', e.target.value)}
              >
                <option value="">— No class —</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>

              <Input
                placeholder="Line memo"
                value={line.memo}
                onChange={(e) => updateLine(line.id, 'memo', e.target.value)}
              />

              <AmountInput
                placeholder="0.00"
                value={line.debit}
                onChange={(e) => updateLine(line.id, 'debit', e.target.value)}
                className="text-right"
              />

              <AmountInput
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
        <div className={`grid ${gridCols} gap-2 items-center`}>
          <span className="text-sm font-bold text-navy text-right">Totals</span>
          <span />
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
// Reverse modal — one-click reversing entry (QB "Reverse" button)
// ---------------------------------------------------------------------------

interface ReverseModalProps {
  entry: JournalEntry | null;
  onClose: () => void;
  onReversed: () => void;
}

function ReverseModal({ entry, onClose, onReversed }: ReverseModalProps) {
  const [asOfDate, setAsOfDate] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (entry) {
      setAsOfDate(nextMonthFirstISO(entry.date));
      setLoading(false);
    }
  }, [entry]);

  const handleReverse = async () => {
    if (!entry || !asOfDate) return;
    setLoading(true);
    try {
      const data = await api.post<{ entry: JournalEntry }>(
        `/api/journal-entries/${entry.id}/reverse`,
        { asOfDate },
      );
      toast(`Reversing entry #${data.entry.entryNumber} posted`, 'success');
      onReversed();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to reverse entry';
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={!!entry}
      onClose={onClose}
      title="Reverse Journal Entry"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleReverse} disabled={!asOfDate} loading={loading}>
            Post Reversing Entry
          </Button>
        </>
      }
    >
      <p className="text-navy/80 text-sm mb-4">
        Post the opposite of <span className="font-semibold">#{entry?.entryNumber}</span> — &ldquo;
        {entry?.description}&rdquo; (debits and credits swapped). The original entry stays posted;
        the reversal is referenced <span className="font-mono text-xs">REV of #{entry?.entryNumber}</span>.
      </p>
      <div>
        <Label htmlFor="rev-date">Reversal date</Label>
        <DateInput
          id="rev-date"
          value={asOfDate}
          onChange={(e) => setAsOfDate(e.target.value)}
        />
        <p className="text-xs text-navy/40 mt-1">Defaults to the 1st of the next month.</p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function JournalPageContent() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<EntryDetail | null>(null);
  const [voidTarget, setVoidTarget] = useState<JournalEntry | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<JournalEntry | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

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

  // Quick Actions navigate here with ?new=1 — open the create modal.
  useNewParam(() => {
    setEditTarget(null);
    setShowForm(true);
  });

  const openEdit = async (entry: JournalEntry) => {
    try {
      const data = await api.get<{ entry: EntryDetail }>(`/api/journal-entries/${entry.id}`);
      if (data.entry.sourceRef && data.entry.sourceRef !== 'manual') {
        toast('This entry was posted by a source document — edit the document instead.', 'danger');
        return;
      }
      setEditTarget(data.entry);
      setShowForm(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load entry';
      toast(msg, 'danger');
    }
  };

  const handleVoid = async () => {
    if (!voidTarget) return;
    setVoiding(true);
    try {
      await api.del(`/api/journal-entries/${voidTarget.id}`);
      toast('Entry voided', 'success');
      setVoidTarget(null);
      fetchEntries();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to void entry';
      toast(msg, 'danger');
    } finally {
      setVoiding(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Journal Entries"
        icon={NotebookPen}
        action={
          <Button
            onClick={() => {
              setEditTarget(null);
              setShowForm(true);
            }}
          >
            <Plus className="h-4 w-4" /> New Journal Entry
          </Button>
        }
      />

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <div className="p-12 flex justify-center text-electric">
            <Spinner className="h-6 w-6" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={NotebookPen}
            title="No journal entries yet"
            message="Record your first transaction to get started."
            action={
              <Button
                onClick={() => {
                  setEditTarget(null);
                  setShowForm(true);
                }}
              >
                <Plus className="h-4 w-4" /> New Journal Entry
              </Button>
            }
          />
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
                <Tr
                  key={entry.id}
                  onClick={() => setDetailId(entry.id)}
                  className="cursor-pointer"
                  title="View entry detail"
                >
                  <Td className="font-mono text-xs text-navy/60">{entry.entryNumber}</Td>
                  <Td className="whitespace-nowrap">{formatDate(entry.date)}</Td>
                  <Td className="max-w-xs truncate" title={entry.description}>
                    {entry.description}
                  </Td>
                  <Td className="text-navy/50 text-xs">{entry.reference ?? '—'}</Td>
                  <Td>
                    <Badge tone={statusTone(entry.status)}>
                      {entry.status === 'void'
                        ? 'Voided'
                        : entry.status.charAt(0).toUpperCase() + entry.status.slice(1)}
                    </Badge>
                  </Td>
                  <Td className="text-right">
                    {entry.status === 'posted' && (
                      <span className="inline-flex items-center gap-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(entry);
                          }}
                          className="inline-flex items-center gap-1 text-xs text-electric hover:text-electric/80 font-medium transition-colors"
                          title="Edit this entry"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReverseTarget(entry);
                          }}
                          className="inline-flex items-center gap-1 text-xs text-gold hover:text-gold/80 font-semibold transition-colors"
                          title="Post a reversing entry (debits/credits swapped)"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          Reverse
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setVoidTarget(entry);
                          }}
                          className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                          title="Void this entry"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Void
                        </button>
                      </span>
                    )}
                    {entry.status === 'void' && (
                      <span className="text-xs text-navy/30 italic">Voided</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <EntryFormModal
        open={showForm}
        onClose={() => {
          setShowForm(false);
          setEditTarget(null);
        }}
        onSaved={fetchEntries}
        accounts={accounts}
        classes={classes}
        editEntry={editTarget}
      />

      <ConfirmDialog
        open={!!voidTarget}
        title="Void Journal Entry"
        message={
          <>
            Are you sure you want to void{' '}
            <span className="font-semibold">#{voidTarget?.entryNumber}</span> — &ldquo;
            {voidTarget?.description}&rdquo;? This will reverse all balance impacts and cannot be
            undone.
          </>
        }
        confirmLabel="Void Entry"
        tone="danger"
        loading={voiding}
        onConfirm={handleVoid}
        onClose={() => setVoidTarget(null)}
      />

      <ReverseModal
        entry={reverseTarget}
        onClose={() => setReverseTarget(null)}
        onReversed={fetchEntries}
      />

      <EntryDetailModal entryId={detailId} onClose={() => setDetailId(null)} />
    </main>
  );
}

export default function JournalPage() {
  return (
    <Suspense fallback={null}>
      <JournalPageContent />
    </Suspense>
  );
}
