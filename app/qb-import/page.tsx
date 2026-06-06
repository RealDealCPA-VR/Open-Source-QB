'use client';

/**
 * QuickBooks Import page.
 *
 * Supports two import paths:
 *   IIF  — paste (or open-file) the raw IIF text; imports accounts, customers, vendors.
 *   CSV  — paste CSV, choose kind (customers | vendors), map columns.
 *
 * Uses window.bookkeeper?.openFile?.() when running inside the Electron shell,
 * with a plain <textarea> fallback for browser use.
 */
import { useState } from 'react';
import { Upload } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Select,
  Label,
  Badge,
  PageHeader,
  toast,
  Toaster,
} from '@/components/ui';
import { api, ApiError } from '@/lib/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Format = 'iif' | 'csv';
type CsvKind = 'customers' | 'vendors';

interface ImportCounts {
  accounts: number;
  customers: number;
  vendors: number;
  skipped: number;
}

/** CSV column-mapping fields shown in the UI */
const CSV_CUSTOMER_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'displayName', label: 'Display Name *' },
  { key: 'companyName', label: 'Company Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'billingAddress_line1', label: 'Billing Address Line 1' },
  { key: 'billingAddress_city', label: 'Billing City' },
  { key: 'billingAddress_state', label: 'Billing State' },
  { key: 'billingAddress_zip', label: 'Billing Zip' },
  { key: 'notes', label: 'Notes' },
];

const CSV_VENDOR_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'displayName', label: 'Display Name *' },
  { key: 'companyName', label: 'Company Name' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'address_line1', label: 'Address Line 1' },
  { key: 'address_city', label: 'City' },
  { key: 'address_state', label: 'State' },
  { key: 'address_zip', label: 'Zip' },
  { key: 'notes', label: 'Notes' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the first CSV header row to offer as mapping options. */
function parseCsvHeaders(content: string): string[] {
  const firstLine = content.split(/\r?\n/)[0] ?? '';
  if (!firstLine.trim()) return [];
  return firstLine.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function QbImportPage() {
  const [format, setFormat] = useState<Format>('iif');
  const [csvKind, setCsvKind] = useState<CsvKind>('customers');
  const [content, setContent] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportCounts | null>(null);

  // Detect whether Electron file-open API is available.
  const canOpenFile =
    typeof window !== 'undefined' &&
    typeof (window as unknown as Record<string, unknown>).bookkeeper === 'object' &&
    typeof ((window as unknown as Record<string, unknown>).bookkeeper as Record<string, unknown>)?.openFile === 'function';

  const csvFields = csvKind === 'customers' ? CSV_CUSTOMER_FIELDS : CSV_VENDOR_FIELDS;
  const csvHeaders = parseCsvHeaders(content);

  // ---- Open file via Electron bridge ----
  async function handleOpenFile() {
    try {
      const bk = (window as unknown as Record<string, unknown>).bookkeeper as Record<string, unknown>;
      const fileContent = await (bk.openFile as () => Promise<string>)();
      if (fileContent) setContent(fileContent);
    } catch {
      toast('Could not open file.', 'danger');
    }
  }

  // ---- Column mapping change ----
  function handleMappingChange(field: string, csvCol: string) {
    setMapping((prev) => ({ ...prev, [field]: csvCol }));
  }

  // ---- Submit ----
  async function handleImport() {
    if (!content.trim()) {
      toast('Please paste or open a file first.', 'danger');
      return;
    }
    if (format === 'csv' && !mapping.displayName) {
      toast('Please map the Display Name column.', 'danger');
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const body =
        format === 'iif'
          ? { format: 'iif', content }
          : { format: 'csv', kind: csvKind, content, mapping };

      const counts = await api.post<ImportCounts>('/api/qb-import', body);
      setResult(counts);
      const total = counts.accounts + counts.customers + counts.vendors;
      toast(
        `Import complete: ${total} created, ${counts.skipped} skipped.`,
        total > 0 ? 'success' : 'info',
      );
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Import failed.';
      toast(msg, 'danger');
    } finally {
      setLoading(false);
    }
  }

  // ---- Reset ----
  function handleReset() {
    setContent('');
    setMapping({});
    setResult(null);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <Toaster />
      <PageHeader title="Import from QuickBooks" icon={Upload} />

      <div className="max-w-3xl mx-auto space-y-6">

        {/* ---- Format selector ---- */}
        <Card className="p-6 space-y-4">
          <h2 className="text-lg font-bold text-navy">1. Choose import format</h2>
          <div className="flex gap-3">
            {(['iif', 'csv'] as Format[]).map((f) => (
              <button
                key={f}
                onClick={() => { setFormat(f); handleReset(); }}
                className={[
                  'px-5 py-2 rounded-lg font-semibold text-sm border transition-colors',
                  format === f
                    ? 'bg-electric text-white border-electric'
                    : 'bg-white text-navy border-slate-200 hover:bg-slate-50',
                ].join(' ')}
              >
                {f.toUpperCase()}
                {f === 'iif' && (
                  <span className="ml-1 text-xs opacity-70">(accounts + customers + vendors)</span>
                )}
              </button>
            ))}
          </div>

          {format === 'csv' && (
            <div>
              <Label>Import kind</Label>
              <Select
                value={csvKind}
                onChange={(e) => { setCsvKind(e.target.value as CsvKind); setMapping({}); }}
                className="max-w-xs"
              >
                <option value="customers">Customers</option>
                <option value="vendors">Vendors</option>
              </Select>
            </div>
          )}
        </Card>

        {/* ---- File content ---- */}
        <Card className="p-6 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-navy">2. Paste or open file</h2>
            {canOpenFile && (
              <Button variant="secondary" size="sm" onClick={handleOpenFile}>
                Open file…
              </Button>
            )}
          </div>

          <textarea
            value={content}
            onChange={(e) => { setContent(e.target.value); setMapping({}); }}
            placeholder={
              format === 'iif'
                ? 'Paste IIF file content here…'
                : 'Paste CSV file content here (first row must be headers)…'
            }
            rows={10}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy font-mono outline-none focus:border-electric focus:ring-2 focus:ring-electric/30 placeholder:text-navy/30 resize-y"
          />

          {content && (
            <p className="text-xs text-navy/50">
              {content.split('\n').length} lines loaded.
            </p>
          )}
        </Card>

        {/* ---- CSV column mapping ---- */}
        {format === 'csv' && content && csvHeaders.length > 0 && (
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-bold text-navy">3. Map columns</h2>
            <p className="text-sm text-navy/60">
              Match each field to the column in your CSV. Only Display Name is required.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              {csvFields.map(({ key, label }) => (
                <div key={key}>
                  <Label>{label}</Label>
                  <Select
                    value={mapping[key] ?? ''}
                    onChange={(e) => handleMappingChange(key, e.target.value)}
                  >
                    <option value="">(not mapped)</option>
                    {csvHeaders.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* ---- Submit ---- */}
        <div className="flex items-center gap-4">
          <Button
            onClick={handleImport}
            disabled={loading || !content.trim()}
            className="min-w-[140px]"
          >
            {loading ? 'Importing…' : 'Run Import'}
          </Button>
          {content && (
            <Button variant="ghost" onClick={handleReset} disabled={loading}>
              Clear
            </Button>
          )}
        </div>

        {/* ---- Results ---- */}
        {result && (
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-bold text-navy">Import results</h2>
            <div className="flex flex-wrap gap-3">
              {format === 'iif' && (
                <ResultBadge label="Accounts" count={result.accounts} />
              )}
              <ResultBadge label="Customers" count={result.customers} />
              <ResultBadge label="Vendors" count={result.vendors} />
              <ResultBadge label="Skipped" count={result.skipped} tone="neutral" />
            </div>
            <p className="text-sm text-navy/60">
              {result.skipped > 0 &&
                'Skipped rows already exist in this company or had invalid/missing data.'}
            </p>
          </Card>
        )}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Small helper component
// ---------------------------------------------------------------------------

function ResultBadge({
  label,
  count,
  tone = count > 0 ? 'success' : 'neutral',
}: {
  label: string;
  count: number;
  tone?: 'success' | 'neutral' | 'warning' | 'danger' | 'info';
}) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-[80px]">
      <span className="text-2xl font-extrabold text-navy">{count}</span>
      <Badge tone={tone}>{label}</Badge>
    </div>
  );
}
