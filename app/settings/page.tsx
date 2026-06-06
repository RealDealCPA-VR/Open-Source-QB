'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Settings, Database, BookOpen, Upload, Download } from 'lucide-react';
import { Button, Card, Input, Select, Label, PageHeader, Toaster, toast } from '@/components/ui';
import { api, ApiError } from '@/lib/client';

interface CompanySettings {
  fiscalYearEnd?: string;
  currency?: string;
  timezone?: string;
}

interface Company {
  id: string;
  name: string;
  settings?: CompanySettings | null;
}

const CURRENCIES = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — Pound Sterling' },
  { value: 'CAD', label: 'CAD — Canadian Dollar' },
  { value: 'AUD', label: 'AUD — Australian Dollar' },
  { value: 'JPY', label: 'JPY — Japanese Yen' },
  { value: 'CHF', label: 'CHF — Swiss Franc' },
  { value: 'MXN', label: 'MXN — Mexican Peso' },
];

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (US & Canada)' },
  { value: 'America/Chicago', label: 'Central Time (US & Canada)' },
  { value: 'America/Denver', label: 'Mountain Time (US & Canada)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (US & Canada)' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
  { value: 'America/Toronto', label: 'Eastern Time (Canada)' },
  { value: 'America/Vancouver', label: 'Pacific Time (Canada)' },
  { value: 'Europe/London', label: 'London' },
  { value: 'Europe/Paris', label: 'Paris / Berlin / Amsterdam' },
  { value: 'Europe/Helsinki', label: 'Helsinki / Kyiv / Tallinn' },
  { value: 'Asia/Dubai', label: 'Dubai' },
  { value: 'Asia/Kolkata', label: 'Mumbai / New Delhi' },
  { value: 'Asia/Singapore', label: 'Singapore / Hong Kong' },
  { value: 'Asia/Tokyo', label: 'Tokyo / Osaka' },
  { value: 'Australia/Sydney', label: 'Sydney / Melbourne' },
  { value: 'Pacific/Auckland', label: 'Auckland / Wellington' },
  { value: 'UTC', label: 'UTC' },
];

export default function SettingsPage() {
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [fiscalYearEnd, setFiscalYearEnd] = useState('12-31');
  const [timezone, setTimezone] = useState('America/New_York');

  useEffect(() => {
    api.get<Company>('/api/company')
      .then((data) => {
        setCompany(data);
        setName(data.name ?? '');
        setCurrency(data.settings?.currency ?? 'USD');
        setFiscalYearEnd(data.settings?.fiscalYearEnd ?? '12-31');
        setTimezone(data.settings?.timezone ?? 'America/New_York');
      })
      .catch((err: ApiError) => {
        toast(err.message || 'Failed to load company settings', 'danger');
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();

    // Validate fiscalYearEnd format MM-DD
    const fyePattern = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    if (!fyePattern.test(fiscalYearEnd)) {
      toast('Fiscal year end must be in MM-DD format (e.g. 12-31)', 'danger');
      return;
    }

    setSaving(true);
    try {
      const updated = await api.patch<Company>('/api/company', {
        name,
        currency,
        fiscalYearEnd,
        timezone,
      });
      setCompany(updated);
      toast('Settings saved successfully', 'success');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to save settings';
      toast(msg, 'danger');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <Toaster />
      <PageHeader title="Settings" icon={Settings} />

      {loading ? (
        <p className="text-navy/50 text-sm">Loading company settings...</p>
      ) : (
        <div className="flex flex-col gap-8 max-w-2xl">
          {/* Company settings form */}
          <Card className="p-8">
            <h2 className="text-lg font-bold text-navy mb-6">Company Settings</h2>
            <form onSubmit={handleSave} className="flex flex-col gap-5">
              <div>
                <Label htmlFor="company-name">Business Name</Label>
                <Input
                  id="company-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Corp, Inc."
                  required
                />
              </div>

              <div>
                <Label htmlFor="currency">Currency</Label>
                <Select
                  id="currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="fiscal-year-end">Fiscal Year End (MM-DD)</Label>
                <Input
                  id="fiscal-year-end"
                  value={fiscalYearEnd}
                  onChange={(e) => setFiscalYearEnd(e.target.value)}
                  placeholder="12-31"
                  pattern="(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])"
                  title="Format: MM-DD, e.g. 12-31"
                />
                <p className="mt-1 text-xs text-navy/50">Enter as MM-DD, e.g. 12-31 for December 31</p>
              </div>

              <div>
                <Label htmlFor="timezone">Timezone</Label>
                <Select
                  id="timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="pt-2">
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Settings'}
                </Button>
              </div>
            </form>
          </Card>

          {/* Data tools hub */}
          <Card className="p-8">
            <h2 className="text-lg font-bold text-navy mb-1 flex items-center gap-2">
              <Database className="h-5 w-5 text-electric" />
              Data
            </h2>
            <p className="text-sm text-navy/50 mb-6">Import, export, and manage your company data.</p>
            <div className="flex flex-col gap-3">
              <Link
                href="/qb-import"
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-navy font-medium hover:border-electric hover:bg-electric/5 transition-colors"
              >
                <Upload className="h-5 w-5 text-electric shrink-0" />
                <div>
                  <div className="font-semibold text-sm">QuickBooks Import</div>
                  <div className="text-xs text-navy/50 mt-0.5">Import QBO, IIF, or CSV files from QuickBooks</div>
                </div>
              </Link>

              <Link
                href="/backup"
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-navy font-medium hover:border-electric hover:bg-electric/5 transition-colors"
              >
                <Download className="h-5 w-5 text-electric shrink-0" />
                <div>
                  <div className="font-semibold text-sm">Backup &amp; Export</div>
                  <div className="text-xs text-navy/50 mt-0.5">Download a backup of your company data</div>
                </div>
              </Link>

              <Link
                href="/accounts"
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 text-navy font-medium hover:border-electric hover:bg-electric/5 transition-colors"
              >
                <BookOpen className="h-5 w-5 text-electric shrink-0" />
                <div>
                  <div className="font-semibold text-sm">Chart of Accounts</div>
                  <div className="text-xs text-navy/50 mt-0.5">View and manage your general ledger accounts</div>
                </div>
              </Link>
            </div>
          </Card>
        </div>
      )}
    </main>
  );
}
