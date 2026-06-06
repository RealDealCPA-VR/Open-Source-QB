'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Plus, Play, Clock } from 'lucide-react';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DocType = 'invoice' | 'bill' | 'journal_entry';
type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

interface RecurringTemplate {
  id: string;
  name: string;
  docType: DocType;
  frequency: Frequency;
  nextRunDate: string | null;
  isActive: boolean;
  template: Record<string, unknown>;
  createdAt: string;
}

interface GeneratedDoc {
  templateId: string;
  templateName: string;
  docType: DocType;
  docId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOC_TYPE_OPTIONS: { value: DocType; label: string }[] = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'bill', label: 'Bill' },
  { value: 'journal_entry', label: 'Journal Entry' },
];

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const DOC_BADGES: Record<DocType, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  invoice: { label: 'Invoice', tone: 'success' },
  bill: { label: 'Bill', tone: 'warning' },
  journal_entry: { label: 'Journal Entry', tone: 'info' },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// New template form state
// ---------------------------------------------------------------------------

interface TemplateFormState {
  name: string;
  docType: DocType;
  frequency: Frequency;
  nextRunDate: string;
  // Invoice-specific guided fields
  customerId: string;
  lineDesc: string;
  lineQty: string;
  lineRate: string;
  // Raw JSON for bill / journal_entry
  rawJson: string;
}

const EMPTY_FORM: TemplateFormState = {
  name: '',
  docType: 'invoice',
  frequency: 'monthly',
  nextRunDate: todayIso(),
  customerId: '',
  lineDesc: 'Services rendered',
  lineQty: '1',
  lineRate: '0.00',
  rawJson: '{}',
};

function buildTemplatePayload(form: TemplateFormState): Record<string, unknown> {
  if (form.docType === 'invoice') {
    return {
      customerId: form.customerId.trim(),
      date: form.nextRunDate,
      lines: [
        {
          description: form.lineDesc.trim() || 'Services',
          quantity: form.lineQty || '1',
          rate: form.lineRate || '0.00',
        },
      ],
    };
  }
  // For bill / journal_entry, the user supplies raw JSON
  try {
    return JSON.parse(form.rawJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// TemplateFormFields component
// ---------------------------------------------------------------------------

function TemplateFormFields({
  form,
  onChange,
}: {
  form: TemplateFormState;
  onChange: (field: keyof TemplateFormState, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor="tpl-name">Template Name *</Label>
        <Input
          id="tpl-name"
          placeholder="e.g. Monthly Retainer"
          value={form.name}
          onChange={(e) => onChange('name', e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="tpl-docType">Document Type *</Label>
          <Select
            id="tpl-docType"
            value={form.docType}
            onChange={(e) => onChange('docType', e.target.value)}
          >
            {DOC_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="tpl-frequency">Frequency *</Label>
          <Select
            id="tpl-frequency"
            value={form.frequency}
            onChange={(e) => onChange('frequency', e.target.value)}
          >
            {FREQUENCY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="tpl-nextRunDate">Next Run Date *</Label>
        <Input
          id="tpl-nextRunDate"
          type="date"
          value={form.nextRunDate}
          onChange={(e) => onChange('nextRunDate', e.target.value)}
          required
        />
      </div>

      {/* Guided invoice fields */}
      {form.docType === 'invoice' && (
        <>
          <div>
            <Label htmlFor="tpl-customerId">Customer ID *</Label>
            <Input
              id="tpl-customerId"
              placeholder="UUID of the customer"
              value={form.customerId}
              onChange={(e) => onChange('customerId', e.target.value)}
            />
            <p className="text-xs text-navy/40 mt-1">
              Paste the customer UUID from the Customers page.
            </p>
          </div>
          <div>
            <Label htmlFor="tpl-lineDesc">Line Description</Label>
            <Input
              id="tpl-lineDesc"
              placeholder="Services rendered"
              value={form.lineDesc}
              onChange={(e) => onChange('lineDesc', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="tpl-lineQty">Quantity</Label>
              <Input
                id="tpl-lineQty"
                type="number"
                min="0.01"
                step="0.01"
                value={form.lineQty}
                onChange={(e) => onChange('lineQty', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="tpl-lineRate">Rate ($)</Label>
              <Input
                id="tpl-lineRate"
                type="number"
                min="0"
                step="0.01"
                value={form.lineRate}
                onChange={(e) => onChange('lineRate', e.target.value)}
              />
            </div>
          </div>
        </>
      )}

      {/* Raw JSON for bill / journal_entry */}
      {form.docType !== 'invoice' && (
        <div>
          <Label htmlFor="tpl-rawJson">
            Template Payload (JSON) *
          </Label>
          <textarea
            id="tpl-rawJson"
            rows={6}
            placeholder={
              form.docType === 'bill'
                ? '{\n  "vendorId": "...",\n  "lines": [{ "accountId": "...", "amount": "100.00" }]\n}'
                : '{\n  "description": "Monthly accrual",\n  "lines": [{ "accountId": "...", "debit": "500.00" }, { "accountId": "...", "credit": "500.00" }]\n}'
            }
            value={form.rawJson}
            onChange={(e) => onChange('rawJson', e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy font-mono outline-none focus:border-electric focus:ring-2 focus:ring-electric/30 placeholder:text-navy/30 resize-y"
          />
          <p className="text-xs text-navy/40 mt-1">
            Provide the full create-input payload (omit the date — it is set automatically).
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function RecurringPage() {
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  // New template modal
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<TemplateFormState>(EMPTY_FORM);
  const [addSaving, setAddSaving] = useState(false);

  // Run-now confirmation
  const [runNowTarget, setRunNowTarget] = useState<RecurringTemplate | null>(null);
  const [runNowLoading, setRunNowLoading] = useState(false);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  async function fetchTemplates() {
    setLoading(true);
    try {
      const data = await api.get<RecurringTemplate[]>('/api/recurring');
      setTemplates(data);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load templates', 'danger');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTemplates();
  }, []);

  // ---------------------------------------------------------------------------
  // Run due now (all)
  // ---------------------------------------------------------------------------

  async function handleRunDue() {
    setRunning(true);
    try {
      const result = await api.post<{ generated: GeneratedDoc[] }>('/api/recurring/run', {
        asOf: new Date().toISOString(),
      });
      const count = result.generated.length;
      toast(
        count === 0
          ? 'No templates were due. Nothing generated.'
          : `Generated ${count} document${count === 1 ? '' : 's'}.`,
        count === 0 ? 'info' : 'success',
      );
      await fetchTemplates();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Run failed', 'danger');
    } finally {
      setRunning(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Run individual template now
  // ---------------------------------------------------------------------------

  async function handleRunNow() {
    if (!runNowTarget) return;
    setRunNowLoading(true);
    try {
      await api.post('/api/recurring/run', { id: runNowTarget.id });
      toast(`Generated 1 ${runNowTarget.docType.replace('_', ' ')} from "${runNowTarget.name}"`, 'success');
      setRunNowTarget(null);
      await fetchTemplates();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Run failed', 'danger');
    } finally {
      setRunNowLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Add template
  // ---------------------------------------------------------------------------

  function openAddModal() {
    setAddForm({ ...EMPTY_FORM, nextRunDate: todayIso() });
    setAddOpen(true);
  }

  function updateAddForm(field: keyof TemplateFormState, value: string) {
    setAddForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleAdd() {
    if (!addForm.name.trim()) {
      toast('Template name is required', 'danger');
      return;
    }
    if (addForm.docType === 'invoice' && !addForm.customerId.trim()) {
      toast('Customer ID is required for invoice templates', 'danger');
      return;
    }

    const payload = buildTemplatePayload(addForm);

    if (addForm.docType !== 'invoice') {
      try {
        JSON.parse(addForm.rawJson);
      } catch {
        toast('Template payload is not valid JSON', 'danger');
        return;
      }
    }

    setAddSaving(true);
    try {
      await api.post('/api/recurring', {
        name: addForm.name.trim(),
        docType: addForm.docType,
        frequency: addForm.frequency,
        nextRunDate: addForm.nextRunDate,
        template: payload,
      });
      toast('Recurring template created', 'success');
      setAddOpen(false);
      await fetchTemplates();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to create template', 'danger');
    } finally {
      setAddSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Recurring / Memorized Transactions"
        icon={RefreshCw}
        action={
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleRunDue}
              disabled={running}
              title="Run all templates that are due today"
            >
              <Play className="h-4 w-4" />
              {running ? 'Running...' : 'Run Due Now'}
            </Button>
            <Button onClick={openAddModal}>
              <Plus className="h-4 w-4" />
              New Template
            </Button>
          </div>
        }
      />

      <Card>
        {loading ? (
          <div className="p-12 text-center text-navy/40 text-sm">Loading templates...</div>
        ) : templates.length === 0 ? (
          <div className="p-12 text-center">
            <RefreshCw className="mx-auto h-10 w-10 text-navy/20 mb-3" />
            <p className="text-navy/50 text-sm">
              No recurring templates yet. Click "New Template" to set up an automated transaction.
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Frequency</Th>
                <Th>Next Run</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {templates.map((tpl) => {
                const badge = DOC_BADGES[tpl.docType] ?? { label: tpl.docType, tone: 'neutral' as const };
                const isPastDue =
                  tpl.nextRunDate !== null && new Date(tpl.nextRunDate) <= new Date();
                return (
                  <Tr key={tpl.id}>
                    <Td className="font-semibold text-navy">{tpl.name}</Td>
                    <Td>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </Td>
                    <Td className="capitalize text-navy/70">{tpl.frequency}</Td>
                    <Td>
                      <span
                        className={
                          isPastDue && tpl.isActive
                            ? 'text-amber-600 font-semibold'
                            : 'text-navy/70'
                        }
                      >
                        {formatDate(tpl.nextRunDate)}
                        {isPastDue && tpl.isActive && (
                          <span className="ml-1 text-xs">(due)</span>
                        )}
                      </span>
                    </Td>
                    <Td>
                      {tpl.isActive ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="neutral">Inactive</Badge>
                      )}
                    </Td>
                    <Td className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRunNowTarget(tpl)}
                        title="Generate this document now"
                      >
                        <Clock className="h-3.5 w-3.5" />
                        Run Now
                      </Button>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* ---- New Template modal ---- */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="New Recurring Template"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={addSaving}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={addSaving}>
              {addSaving ? 'Saving...' : 'Create Template'}
            </Button>
          </>
        }
      >
        <TemplateFormFields form={addForm} onChange={updateAddForm} />
      </Modal>

      {/* ---- Run Now confirm modal ---- */}
      <Modal
        open={!!runNowTarget}
        onClose={() => setRunNowTarget(null)}
        title="Run Template Now"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setRunNowTarget(null)}
              disabled={runNowLoading}
            >
              Cancel
            </Button>
            <Button onClick={handleRunNow} disabled={runNowLoading}>
              {runNowLoading ? 'Generating...' : 'Yes, Generate Now'}
            </Button>
          </>
        }
      >
        <p className="text-navy/70 text-sm">
          Generate one{' '}
          <strong className="text-navy">
            {runNowTarget?.docType.replace('_', ' ')}
          </strong>{' '}
          from template{' '}
          <strong className="text-navy">"{runNowTarget?.name}"</strong> immediately?
          The next run date will be advanced by one {runNowTarget?.frequency} period.
        </p>
      </Modal>

      <Toaster />
    </main>
  );
}
