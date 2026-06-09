'use client';

/**
 * First-run onboarding wizard.
 * Step 1 — Welcome
 * Step 2 — Company details (name, industry, currency, fiscal year end)
 * Step 3 — Creates company via API, selects it, patches settings; shows success.
 */

import { useState } from 'react';
import Link from 'next/link';
import { BookOpen, Building2, CheckCircle2, ChevronRight, ChevronLeft } from 'lucide-react';
import { Button, Card, Input, Select, Label, toast } from '@/components/ui';
import { api, ApiError } from '@/lib/client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDUSTRIES = [
  { value: '', label: 'Select industry...' },
  { value: 'retail', label: 'Retail' },
  { value: 'wholesale', label: 'Wholesale' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'construction', label: 'Construction' },
  { value: 'professional_services', label: 'Professional Services' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'education', label: 'Education' },
  { value: 'hospitality', label: 'Hospitality & Food Service' },
  { value: 'technology', label: 'Technology' },
  { value: 'nonprofit', label: 'Non-profit' },
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'transportation', label: 'Transportation & Logistics' },
  { value: 'other', label: 'Other' },
];

const CURRENCIES = [
  { value: 'USD', label: 'USD — US Dollar ($)' },
  { value: 'EUR', label: 'EUR — Euro (€)' },
  { value: 'GBP', label: 'GBP — British Pound (£)' },
  { value: 'CAD', label: 'CAD — Canadian Dollar (C$)' },
  { value: 'AUD', label: 'AUD — Australian Dollar (A$)' },
  { value: 'NZD', label: 'NZD — New Zealand Dollar (NZ$)' },
  { value: 'JPY', label: 'JPY — Japanese Yen (¥)' },
  { value: 'CHF', label: 'CHF — Swiss Franc (Fr)' },
  { value: 'INR', label: 'INR — Indian Rupee (₹)' },
  { value: 'MXN', label: 'MXN — Mexican Peso (MX$)' },
  { value: 'BRL', label: 'BRL — Brazilian Real (R$)' },
  { value: 'SGD', label: 'SGD — Singapore Dollar (S$)' },
  { value: 'HKD', label: 'HKD — Hong Kong Dollar (HK$)' },
];

const TOTAL_STEPS = 3;

// ---------------------------------------------------------------------------
// Stepper indicator
// ---------------------------------------------------------------------------

function StepIndicator({ current }: { current: number }) {
  const steps = [
    { label: 'Welcome' },
    { label: 'Details' },
    { label: 'Create' },
  ];
  return (
    <div className="flex items-center gap-0 mb-10 w-full max-w-sm mx-auto">
      {steps.map((s, i) => {
        const idx = i + 1;
        const done = current > idx;
        const active = current === idx;
        return (
          <div key={idx} className="flex items-center flex-1">
            {/* circle */}
            <div className="flex flex-col items-center">
              <div
                className={[
                  'h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors',
                  done
                    ? 'bg-emerald border-emerald text-white'
                    : active
                      ? 'bg-electric border-electric text-white'
                      : 'bg-white border-slate-200 text-navy/30',
                ].join(' ')}
              >
                {done ? <CheckCircle2 className="h-4 w-4" /> : idx}
              </div>
              <span
                className={[
                  'mt-1 text-xs font-medium whitespace-nowrap',
                  active ? 'text-electric' : done ? 'text-emerald' : 'text-navy/30',
                ].join(' ')}
              >
                {s.label}
              </span>
            </div>
            {/* connector line (not after last) */}
            {i < steps.length - 1 && (
              <div
                className={[
                  'flex-1 h-0.5 mx-1 mb-5 transition-colors',
                  done ? 'bg-emerald' : 'bg-slate-200',
                ].join(' ')}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Welcome
// ---------------------------------------------------------------------------

function StepWelcome({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-6">
      <div className="h-20 w-20 rounded-2xl bg-electric/10 flex items-center justify-center">
        <BookOpen className="h-10 w-10 text-electric" />
      </div>
      <div>
        <h2 className="text-2xl font-extrabold text-navy mb-2">Welcome to BookKeeper AI</h2>
        <p className="text-navy/60 text-sm max-w-sm leading-relaxed">
          Your open-source, double-entry accounting companion. We&apos;ll walk you through setting up your
          first company in under two minutes.
        </p>
      </div>
      <ul className="text-left text-sm text-navy/70 space-y-2 w-full max-w-xs">
        {[
          'Full double-entry general ledger',
          'Invoicing, bills, payments & bank reconciliation',
          'AI-powered transaction review',
          'Default Chart of Accounts — ready to go',
        ].map((item) => (
          <li key={item} className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald shrink-0 mt-0.5" />
            {item}
          </li>
        ))}
      </ul>
      <Button className="w-full max-w-xs" onClick={onNext}>
        Get Started
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Company details
// ---------------------------------------------------------------------------

interface DetailsForm {
  name: string;
  industry: string;
  currency: string;
  fiscalYearEnd: string;
}

function StepDetails({
  form,
  onChange,
  onBack,
  onNext,
}: {
  form: DetailsForm;
  onChange: (field: keyof DetailsForm, value: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  function validate() {
    if (!form.name.trim()) {
      toast('Company name is required', 'danger');
      return false;
    }
    // Same pattern the Settings page uses — rejects impossible dates like 13-45.
    if (form.fiscalYearEnd && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(form.fiscalYearEnd)) {
      toast('Fiscal year end must be in MM-DD format (e.g. 12-31)', 'danger');
      return false;
    }
    return true;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 mb-2">
        <Building2 className="h-6 w-6 text-electric" />
        <div>
          <h2 className="text-xl font-extrabold text-navy">Company Details</h2>
          <p className="text-navy/50 text-xs">Tell us a bit about your business.</p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {/* Company name */}
        <div>
          <Label htmlFor="co-name">Company Name *</Label>
          <Input
            id="co-name"
            placeholder="e.g. Acme Corp"
            value={form.name}
            onChange={(e) => onChange('name', e.target.value)}
            autoFocus
          />
        </div>

        {/* Industry — cosmetic */}
        <div>
          <Label htmlFor="co-industry">Industry</Label>
          <Select
            id="co-industry"
            value={form.industry}
            onChange={(e) => onChange('industry', e.target.value)}
          >
            {INDUSTRIES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>

        {/* Currency */}
        <div>
          <Label htmlFor="co-currency">Reporting Currency</Label>
          <Select
            id="co-currency"
            value={form.currency}
            onChange={(e) => onChange('currency', e.target.value)}
          >
            {CURRENCIES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>

        {/* Fiscal year end */}
        <div>
          <Label htmlFor="co-fye">Fiscal Year End (MM-DD)</Label>
          <Input
            id="co-fye"
            placeholder="12-31"
            value={form.fiscalYearEnd}
            onChange={(e) => onChange('fiscalYearEnd', e.target.value)}
            maxLength={5}
          />
          <p className="mt-1 text-xs text-navy/40">
            Most companies use 12-31 (calendar year). Leave blank to use the default.
          </p>
        </div>
      </div>

      <div className="flex gap-3 mt-2">
        <Button variant="secondary" onClick={onBack} className="flex-1">
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={() => {
            if (validate()) onNext();
          }}
          className="flex-1"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Create + success
// ---------------------------------------------------------------------------

function StepCreate({
  form,
  onBack,
}: {
  form: DetailsForm;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle');

  async function handleCreate() {
    setStatus('loading');
    try {
      // 1. Create the company
      const company = await api.post<{ id: string }>('/api/companies', { name: form.name.trim() });

      // 2. Select / activate it
      await api.post('/api/companies/select', { companyId: company.id });

      // 3. Patch settings (currency + fiscal year end + industry)
      const patch: Record<string, string> = {};
      if (form.currency) patch.currency = form.currency;
      if (form.fiscalYearEnd.trim()) patch.fiscalYearEnd = form.fiscalYearEnd.trim();
      if (form.industry) patch.industry = form.industry;
      if (Object.keys(patch).length > 0) {
        await api.patch('/api/company', patch);
      }

      setStatus('done');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.', 'danger');
      setStatus('idle');
    }
  }

  // ---- success screen ----
  if (status === 'done') {
    return (
      <div className="flex flex-col items-center text-center gap-6">
        <div className="h-20 w-20 rounded-full bg-emerald/10 flex items-center justify-center">
          <CheckCircle2 className="h-12 w-12 text-emerald" />
        </div>
        <div>
          <h2 className="text-2xl font-extrabold text-navy mb-2">You&apos;re all set!</h2>
          <p className="text-navy/60 text-sm max-w-sm leading-relaxed">
            <strong className="text-navy">{form.name}</strong> has been created and a default
            Chart of Accounts has been seeded — including assets, liabilities, equity, income,
            and expense accounts.
          </p>
        </div>
        <div className="bg-electric/5 border border-electric/20 rounded-xl p-4 w-full max-w-sm text-left text-sm text-navy/70 space-y-1">
          <p className="font-semibold text-navy text-xs uppercase tracking-wide mb-2">What was created</p>
          {[
            'Company profile & settings',
            'Default Chart of Accounts (50+ accounts)',
            'Opening equity & retained earnings accounts',
            'Ready for your first transaction',
          ].map((item) => (
            <div key={item} className="flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald shrink-0" />
              <span>{item}</span>
            </div>
          ))}
        </div>
        <Link href="/dashboard" className="w-full max-w-sm">
          <Button className="w-full">
            Go to Dashboard
            <ChevronRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>
    );
  }

  // ---- review + create screen ----
  const currencyLabel =
    CURRENCIES.find((c) => c.value === form.currency)?.label ?? form.currency;
  const industryLabel =
    INDUSTRIES.find((i) => i.value === form.industry)?.label ?? form.industry;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-extrabold text-navy mb-1">Review & Create</h2>
        <p className="text-navy/50 text-sm">Confirm your details before we set everything up.</p>
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50 divide-y divide-slate-100 text-sm">
        {[
          { label: 'Company Name', value: form.name },
          { label: 'Industry', value: industryLabel || 'Not specified' },
          { label: 'Currency', value: currencyLabel },
          { label: 'Fiscal Year End', value: form.fiscalYearEnd || '12-31 (default)' },
        ].map(({ label, value }) => (
          <div key={label} className="flex justify-between px-4 py-3">
            <span className="text-navy/50 font-medium">{label}</span>
            <span className="text-navy font-semibold">{value}</span>
          </div>
        ))}
      </div>

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onBack} disabled={status === 'loading'} className="flex-1">
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <Button onClick={handleCreate} loading={status === 'loading'} className="flex-1">
          Create Company
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page root
// ---------------------------------------------------------------------------

const EMPTY_FORM: DetailsForm = {
  name: '',
  industry: '',
  currency: 'USD',
  fiscalYearEnd: '12-31',
};

export default function OnboardingPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<DetailsForm>(EMPTY_FORM);

  function updateForm(field: keyof DetailsForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans flex items-center justify-center">
      <div className="w-full max-w-md">
        {/* Brand mark */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="h-9 w-9 rounded-xl bg-electric flex items-center justify-center">
            <BookOpen className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-extrabold text-navy tracking-tight">BookKeeper AI</span>
        </div>

        <StepIndicator current={step} />

        <Card className="p-8">
          {step === 1 && <StepWelcome onNext={() => setStep(2)} />}
          {step === 2 && (
            <StepDetails
              form={form}
              onChange={updateForm}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}
          {step === 3 && (
            <StepCreate
              form={form}
              onBack={() => setStep(2)}
            />
          )}
        </Card>

        <p className="text-center text-xs text-navy/30 mt-6">
          Step {step} of {TOTAL_STEPS}
        </p>
      </div>
    </main>
  );
}
