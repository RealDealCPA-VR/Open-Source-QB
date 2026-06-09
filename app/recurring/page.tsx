'use client';

import { useEffect, useState } from 'react';
import { Repeat, Plus, Play, Clock } from 'lucide-react';
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
  ConfirmDialog,
  EmptyState,
  Spinner,
  PageHeader,
  toast,
} from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatDate } from '@/lib/dates';

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

interface CustomerOption {
  id: string;
  name: string;
}

interface VendorOption {
  id: string;
  name: string;
}

interface AccountOption {
  id: string;
  code: string;
  name: string;
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
  // Bill-specific guided fields
  vendorId: string;
  billAccountId: string;
  billLineDesc: string;
  billAmount: string;
  // Raw JSON for journal_entry
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
  vendorId: '',
  billAccountId: '',
  billLineDesc: '',
  billAmount: '0.00',
  rawJson: '{}',
};

function buildTemplatePayload(form: TemplateFormState): Record<string, unknown> {
  if (form.docType === 'invoice') {
    return {
      customerId: form.customerId,
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
  if (form.docType === 'bill') {
    return {
      vendorId: form.vendorId,
      date: form.nextRunDate,
      lines: [
        {
          accountId: form.billAccountId,
          description: form.billLineDesc.trim() || null,
          amount: form.billAmount || '0.00',
        },
      ],
    };
  }
  // For journal_entry, the user supplies raw JSON
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
  customers,
  vendors,
  accounts,
}: {
  form: TemplateFormState;
  onChange: (field: keyof TemplateFormState, value: string) => void;
  customers: CustomerOption[];
  vendors: VendorOption[];
  accounts: AccountOption[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor="tpl-name">Template Name *</Label>
        <Input
          id="tpl-name"
          placeholder="e.g. Monthly Retainer"
          autoFocus
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
            <Label htmlFor="tpl-customerId">Customer *</Label>
            <Select
              id="tpl-customerId"
              value={form.customerId}
              onChange={(e) => onChange('customerId', e.target.value)}
            >
              <option value="">— Select customer —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {customers.length === 0 && (
              <p className="text-xs text-navy/40 mt-1">
                No customers found — create one on the Customers page first.
              </p>
            )}
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

      {/* Guided bill fields */}
      {form.docType === 'bill' && (
        <>
          <div>
            <Label htmlFor="tpl-vendorId">Vendor *</Label>
            <Select
              id="tpl-vendorId"
              value={form.vendorId}
              onChange={(e) => onChange('vendorId', e.target.value)}
            >
              <option value="">— Select vendor —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
            {vendors.length === 0 && (
              <p className="text-xs text-navy/40 mt-1">
                No vendors found — create one on the Vendors page first.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="tpl-billAccountId">Expense Account *</Label>
            <Select
              id="tpl-billAccountId"
              value={form.billAccountId}
              onChange={(e) => onChange('billAccountId', e.target.value)}
            >
              <option value="">— Select account —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tpl-billLineDesc">Line Description</Label>
            <Input
              id="tpl-billLineDesc"
              placeholder="e.g. Office rent"
              value={form.billLineDesc}
              onChange={(e) => onChange('billLineDesc', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="tpl-billAmount">Amount ($) *</Label>
            <Input
              id="tpl-billAmount"
              type="number"
              min="0.01"
              step="0.01"
              value={form.billAmount}
              onChange={(e) => onChange('billAmount', e.target.value)}
            />
          </div>
        </>
      )}

      {/* Raw JSON for journal_entry */}
      {form.docType === 'journal_entry' && (
        <div>
          <Label htmlFor="tpl-rawJson">
            Template Payload (JSON) *
          </Label>
          <textarea
            id="tpl-rawJson"
            rows={6}
            placeholder={
              '{\n  "description": "Monthly accrual",\n  "lines": [{ "accountId": "...", "debit": "500.00" }, { "accountId": "...", "credit": "500.00" }]\n}'
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

  // Picker data for guided invoice/bill templates
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);

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
    // Picker data — each is non-fatal if it fails (selects degrade to empty).
    api.get<CustomerOption[]>('/api/customers').then(setCustomers).catch(() => {});
    api.get<VendorOption[]>('/api/vendors').then(setVendors).catch(() => {});
    api.get<AccountOption[]>('/api/accounts').then(setAccounts).catch(() => {});
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
    if (addForm.docType === 'invoice' && !addForm.customerId) {
      toast('Select a customer for invoice templates', 'danger');
      return;
    }
    if (addForm.docType === 'bill') {
      if (!addForm.vendorId) {
        toast('Select a vendor for bill templates', 'danger');
        return;
      }
      if (!addForm.billAccountId) {
        toast('Select an expense account for bill templates', 'danger');
        return;
      }
      if (!addForm.billAmount || Number(addForm.billAmount) <= 0) {
        toast('Bill amount must be greater than zero', 'danger');
        return;
      }
    }

    const payload = buildTemplatePayload(addForm);

    if (addForm.docType === 'journal_entry') {
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
        icon={Repeat}
        action={
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleRunDue}
              loading={running}
              title="Run all templates that are due today"
            >
              <Play className="h-4 w-4" />
              Run Due Now
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
          <div className="p-12 flex justify-center text-electric">
            <Spinner className="h-6 w-6" />
          </div>
        ) : templates.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title="No recurring templates yet"
            message="Set up a template to generate invoices, bills, or journal entries automatically."
            action={
              <Button onClick={openAddModal}>
                <Plus className="h-4 w-4" /> New Template
              </Button>
            }
          />
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
                            ? 'text-gold font-semibold'
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
            <Button onClick={handleAdd} loading={addSaving}>
              Create Template
            </Button>
          </>
        }
      >
        <TemplateFormFields
          form={addForm}
          onChange={updateAddForm}
          customers={customers}
          vendors={vendors}
          accounts={accounts}
        />
      </Modal>

      {/* ---- Run Now confirm dialog ---- */}
      <ConfirmDialog
        open={!!runNowTarget}
        title="Run Template Now"
        message={
          <>
            Generate one{' '}
            <strong className="text-navy">
              {runNowTarget?.docType.replace('_', ' ')}
            </strong>{' '}
            from template{' '}
            <strong className="text-navy">&quot;{runNowTarget?.name}&quot;</strong> immediately?
            The next run date will be advanced by one {runNowTarget?.frequency} period.
          </>
        }
        confirmLabel="Yes, Generate Now"
        loading={runNowLoading}
        onConfirm={handleRunNow}
        onClose={() => setRunNowTarget(null)}
      />
    </main>
  );
}
