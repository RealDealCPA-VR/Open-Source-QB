'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Settings, Database, BookOpen, Upload, Download, Lock, Users } from 'lucide-react';
import { Badge, Button, Card, Input, Select, Label, PageHeader, PageSkeleton, toast } from '@/components/ui';
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

interface ClosingDateSettings {
  closingDate: string | null;
  hasPassword: boolean;
}

interface Member {
  userId: string;
  email: string;
  name: string;
  role: string;
  isOwner: boolean;
}

const ROLES = [
  { value: 'viewer', label: 'Viewer (read-only)' },
  { value: 'accountant', label: 'Accountant' },
  { value: 'admin', label: 'Admin' },
  { value: 'owner', label: 'Owner' },
];

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

  // Closing date (books protection)
  const [closingDate, setClosingDate] = useState('');
  const [closingHasPassword, setClosingHasPassword] = useState(false);
  const [closingPassword, setClosingPassword] = useState('');
  const [savingClosing, setSavingClosing] = useState(false);

  // Users & roles
  const [members, setMembers] = useState<Member[]>([]);
  const [savingRole, setSavingRole] = useState<string | null>(null);

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

    api.get<ClosingDateSettings>('/api/company/closing-date')
      .then((data) => {
        setClosingDate(data.closingDate ?? '');
        setClosingHasPassword(data.hasPassword);
      })
      .catch(() => {});

    api.get<Member[]>('/api/users')
      .then(setMembers)
      .catch(() => {});
  }, []);

  async function handleSaveClosingDate(e: React.FormEvent) {
    e.preventDefault();
    if (!closingDate) {
      toast('Pick a closing date first (or use Clear to remove it)', 'danger');
      return;
    }
    setSavingClosing(true);
    try {
      const updated = await api.patch<ClosingDateSettings>('/api/company/closing-date', {
        closingDate,
        // Only send a password when the user typed one — undefined keeps the existing password.
        ...(closingPassword ? { password: closingPassword } : {}),
      });
      setClosingDate(updated.closingDate ?? '');
      setClosingHasPassword(updated.hasPassword);
      setClosingPassword('');
      toast('Closing date saved. Transactions on or before this date are now protected.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to save closing date', 'danger');
    } finally {
      setSavingClosing(false);
    }
  }

  async function handleClearClosingDate() {
    setSavingClosing(true);
    try {
      const updated = await api.patch<ClosingDateSettings>('/api/company/closing-date', {
        closingDate: null,
      });
      setClosingDate(updated.closingDate ?? '');
      setClosingHasPassword(updated.hasPassword);
      setClosingPassword('');
      toast('Closing date cleared', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to clear closing date', 'danger');
    } finally {
      setSavingClosing(false);
    }
  }

  async function handleRoleChange(userId: string, role: string) {
    setSavingRole(userId);
    try {
      const updated = await api.patch<Member>(`/api/users/${userId}`, { role });
      setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, role: updated.role } : m)));
      toast('Role updated', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to update role', 'danger');
    } finally {
      setSavingRole(null);
    }
  }

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
      <PageHeader title="Settings" icon={Settings} />

      {loading ? (
        <PageSkeleton />
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
                <Button type="submit" loading={saving}>
                  Save Settings
                </Button>
              </div>
            </form>
          </Card>

          {/* Closing date (books protection) */}
          <Card className="p-8">
            <h2 className="text-lg font-bold text-navy mb-1 flex items-center gap-2">
              <Lock className="h-5 w-5 text-electric" />
              Set Closing Date
            </h2>
            <p className="text-sm text-navy/50 mb-6">
              Protect prior-period books: transactions dated on or before the closing date cannot be
              added, edited, or voided without the closing-date password.
            </p>
            <form onSubmit={handleSaveClosingDate} className="flex flex-col gap-5">
              <div>
                <Label htmlFor="closing-date">Closing Date</Label>
                <Input
                  id="closing-date"
                  type="date"
                  value={closingDate}
                  onChange={(e) => setClosingDate(e.target.value)}
                />
                {closingDate ? (
                  <p className="mt-1 text-xs text-navy/50">
                    Books are closed through {closingDate}
                    {closingHasPassword ? ' (password protected)' : ' (no password set)'}.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-navy/50">No closing date is currently set.</p>
                )}
              </div>
              <div>
                <Label htmlFor="closing-password">Closing Date Password</Label>
                <Input
                  id="closing-password"
                  type="password"
                  value={closingPassword}
                  onChange={(e) => setClosingPassword(e.target.value)}
                  placeholder={closingHasPassword ? 'Leave blank to keep current password' : 'Optional password'}
                  autoComplete="new-password"
                />
                <p className="mt-1 text-xs text-navy/50">
                  Required to post or void transactions dated on or before the closing date.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <Button type="submit" loading={savingClosing}>
                  Save Closing Date
                </Button>
                {closingDate && (
                  <Button type="button" variant="ghost" disabled={savingClosing} onClick={handleClearClosingDate}>
                    Clear Closing Date
                  </Button>
                )}
              </div>
            </form>
          </Card>

          {/* Users & roles */}
          <Card className="p-8">
            <h2 className="text-lg font-bold text-navy mb-1 flex items-center gap-2">
              <Users className="h-5 w-5 text-electric" />
              Users &amp; Roles
            </h2>
            <p className="text-sm text-navy/50 mb-6">
              Viewers are read-only across the whole app. Accountants can post transactions; admins can
              also manage users and settings.
            </p>
            {members.length === 0 ? (
              <p className="text-sm text-navy/50">No members found.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {members.map((m) => (
                  <div
                    key={m.userId}
                    className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-navy truncate">{m.name}</div>
                      <div className="text-xs text-navy/50 truncate">{m.email}</div>
                    </div>
                    {m.isOwner ? (
                      <Badge>Owner</Badge>
                    ) : (
                      <Select
                        value={m.role}
                        disabled={savingRole === m.userId}
                        onChange={(e) => handleRoleChange(m.userId, e.target.value)}
                        className="w-48"
                      >
                        {ROLES.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                ))}
              </div>
            )}
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
