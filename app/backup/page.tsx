'use client';

import { useEffect, useRef, useState } from 'react';
import { ArchiveRestore, Building2, Download } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Label,
  Modal,
  PageHeader,
  Select,
  toast,
} from '@/components/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Company {
  id: string;
  name: string;
}

interface RestoreCompanyResult {
  companyId: string;
  name: string;
  tableCounts: Record<string, number>;
}

/** Download a fetch Response as a file, using Content-Disposition when present. */
async function downloadResponse(res: Response, fallbackName: string) {
  let filename = fallbackName;
  const cd = res.headers.get('Content-Disposition') ?? '';
  const match = cd.match(/filename="([^"]+)"/);
  if (match) filename = match[1];

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BackupPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const companyFileInputRef = useRef<HTMLInputElement>(null);

  // ---- Companies (per-company backup selector) ----
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState('');

  // ---- Download state ----
  const [downloading, setDownloading] = useState(false);
  const [downloadingCompany, setDownloadingCompany] = useState(false);

  // ---- Full-restore confirm modal ----
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);

  // ---- Company-restore confirm modal ----
  const [companyRestoreModalOpen, setCompanyRestoreModalOpen] = useState(false);
  const [pendingCompanyFile, setPendingCompanyFile] = useState<File | null>(null);
  const [restoreName, setRestoreName] = useState('');
  const [restoringCompany, setRestoringCompany] = useState(false);

  async function loadCompanies() {
    try {
      const res = await fetch('/api/companies', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as Company[];
      setCompanies(data);
      setSelectedCompanyId((prev) => prev || data[0]?.id || '');
    } catch {
      /* companies list is a convenience — page still works without it */
    }
  }

  useEffect(() => {
    loadCompanies();
  }, []);

  // ---------------------------------------------------------------------------
  // Full backup (whole data dir — all companies)
  // ---------------------------------------------------------------------------

  async function handleDownload() {
    setDownloading(true);
    try {
      const res = await fetch('/api/backup', { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? 'Backup failed. Please try again.', 'danger');
        return;
      }
      await downloadResponse(res, 'bookkeeper-backup.bka');
      toast('Full backup downloaded successfully.', 'success');
    } catch {
      toast('Backup failed. Please try again.', 'danger');
    } finally {
      setDownloading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Per-company backup
  // ---------------------------------------------------------------------------

  async function handleDownloadCompany() {
    if (!selectedCompanyId) {
      toast('Select a company first.', 'danger');
      return;
    }
    setDownloadingCompany(true);
    try {
      const res = await fetch(
        `/api/backup/company?companyId=${encodeURIComponent(selectedCompanyId)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? 'Company backup failed. Please try again.', 'danger');
        return;
      }
      await downloadResponse(res, 'bookkeeper-company.bka');
      toast('Company backup downloaded successfully.', 'success');
    } catch {
      toast('Company backup failed. Please try again.', 'danger');
    } finally {
      setDownloadingCompany(false);
    }
  }

  function handleCompanyFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!file) return;
    setPendingCompanyFile(file);
    setRestoreName('');
    setCompanyRestoreModalOpen(true);
  }

  async function handleCompanyRestoreConfirm() {
    if (!pendingCompanyFile) return;
    setRestoringCompany(true);
    try {
      const arrayBuffer = await pendingCompanyFile.arrayBuffer();
      const qs = restoreName.trim() ? `?name=${encodeURIComponent(restoreName.trim())}` : '';
      const res = await fetch(`/api/backup/company${qs}`, {
        method: 'POST',
        body: arrayBuffer,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? 'Restore failed. The file may be corrupt or invalid.', 'danger');
        return;
      }
      const result = (await res.json()) as RestoreCompanyResult;
      toast(`Restored as new company "${result.name}". Switch to it from the company picker.`, 'success');
      setCompanyRestoreModalOpen(false);
      setPendingCompanyFile(null);
      await loadCompanies();
    } catch {
      toast('Restore failed. Please check the file and try again.', 'danger');
    } finally {
      setRestoringCompany(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Full restore — file selection (opens confirm modal)
  // ---------------------------------------------------------------------------

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    // Reset input so same file can be selected again after a cancel.
    e.target.value = '';
    if (!file) return;
    setPendingFile(file);
    setRestoreModalOpen(true);
  }

  async function handleRestoreConfirm() {
    if (!pendingFile) return;
    setRestoring(true);
    try {
      const arrayBuffer = await pendingFile.arrayBuffer();
      const res = await fetch('/api/backup', {
        method: 'POST',
        body: arrayBuffer,
        headers: { 'Content-Type': 'application/octet-stream' },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data?.error ?? 'Restore failed. The file may be corrupt or invalid.', 'danger');
        return;
      }

      toast(
        'Restore complete. Please restart the application to see the restored data.',
        'success',
      );
      setRestoreModalOpen(false);
      setPendingFile(null);
    } catch {
      toast('Restore failed. Please check the file and try again.', 'danger');
    } finally {
      setRestoring(false);
    }
  }

  function handleRestoreCancel() {
    setRestoreModalOpen(false);
    setPendingFile(null);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
        <PageHeader title="Backup & Restore" icon={ArchiveRestore} />

        <div className="max-w-xl flex flex-col gap-6">
          {/* Per-company backup card */}
          <Card className="p-6 flex flex-col gap-3">
            <h2 className="text-lg font-bold text-navy flex items-center gap-2">
              <Building2 className="h-5 w-5 text-electric" />
              Company Backup
            </h2>
            <p className="text-sm text-navy/60">
              Export a single company&apos;s data (accounts, transactions, lists, settings) as a
              portable <span className="font-mono text-navy/80">.bka</span> file. Restoring it
              creates a <span className="font-semibold">new</span> company — other companies are
              never touched.
            </p>
            <div className="flex flex-col gap-3">
              <div>
                <Label>Company</Label>
                <Select
                  value={selectedCompanyId}
                  onChange={(e) => setSelectedCompanyId(e.target.value)}
                  className="max-w-xs"
                >
                  {companies.length === 0 && <option value="">(no companies found)</option>}
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button onClick={handleDownloadCompany} loading={downloadingCompany} disabled={!selectedCompanyId}>
                  <Download className="h-4 w-4" />
                  Download Company Backup
                </Button>
                <input
                  ref={companyFileInputRef}
                  type="file"
                  accept=".bka,.zip"
                  className="hidden"
                  onChange={handleCompanyFileChange}
                />
                <Button
                  variant="secondary"
                  onClick={() => companyFileInputRef.current?.click()}
                  disabled={restoringCompany}
                >
                  <ArchiveRestore className="h-4 w-4" />
                  Restore Company as New…
                </Button>
              </div>
            </div>
          </Card>

          {/* Full download card */}
          <Card className="p-6 flex flex-col gap-3">
            <h2 className="text-lg font-bold text-navy">Full Backup (all companies)</h2>
            <p className="text-sm text-navy/60">
              Save a complete snapshot of the whole data directory — every company file — to your
              computer as a <span className="font-mono text-navy/80">.bka</span> file. Keep this
              file in a safe place.
            </p>
            <div>
              <Button onClick={handleDownload} loading={downloading}>
                <Download className="h-4 w-4" />
                Download Full Backup (.bka)
              </Button>
            </div>
          </Card>

          {/* Full restore card */}
          <Card className="p-6 flex flex-col gap-3">
            <h2 className="text-lg font-bold text-navy">Restore Full Backup</h2>
            <p className="text-sm text-navy/60">
              Overwrite <span className="font-semibold">all</span> company data with a previously
              saved full <span className="font-mono text-navy/80">.bka</span> backup. This cannot
              be undone — to bring back just one company without touching the others, use{' '}
              <span className="font-semibold">Restore Company as New</span> above.
            </p>
            <div>
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".bka,.zip"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={restoring}
              >
                <ArchiveRestore className="h-4 w-4" />
                Restore from File…
              </Button>
            </div>
          </Card>
        </div>

        {/* Full-restore confirmation modal */}
        <Modal
          open={restoreModalOpen}
          onClose={handleRestoreCancel}
          title="Restore Full Backup?"
          footer={
            <>
              <Button variant="secondary" onClick={handleRestoreCancel} disabled={restoring}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleRestoreConfirm} loading={restoring}>
                Yes, Overwrite &amp; Restore
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-sm text-navy/70">
            <p>
              You are about to restore from{' '}
              <span className="font-semibold text-navy break-all">{pendingFile?.name}</span>.
            </p>
            <p className="text-red-600 font-medium">
              This will overwrite ALL current company data and cannot be undone.
            </p>
            <p>
              After restoring, you must restart the application for the restored data to become
              active.
            </p>
            <p>Are you sure you want to continue?</p>
          </div>
        </Modal>

        {/* Company-restore confirmation modal */}
        <Modal
          open={companyRestoreModalOpen}
          onClose={() => {
            setCompanyRestoreModalOpen(false);
            setPendingCompanyFile(null);
          }}
          title="Restore Company as New?"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setCompanyRestoreModalOpen(false);
                  setPendingCompanyFile(null);
                }}
                disabled={restoringCompany}
              >
                Cancel
              </Button>
              <Button type="submit" form="company-restore-form" loading={restoringCompany}>
                Restore as New Company
              </Button>
            </>
          }
        >
          <form
            id="company-restore-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleCompanyRestoreConfirm();
            }}
            className="flex flex-col gap-3 text-sm text-navy/70"
          >
            <p>
              You are about to restore{' '}
              <span className="font-semibold text-navy break-all">{pendingCompanyFile?.name}</span>{' '}
              as a <span className="font-semibold">new</span> company. Existing companies are not
              modified.
            </p>
            <div>
              <Label>New company name (optional — defaults to the backed-up name)</Label>
              <Input
                autoFocus
                value={restoreName}
                onChange={(e) => setRestoreName(e.target.value)}
                placeholder="e.g. Acme Corp (restored)"
              />
            </div>
          </form>
        </Modal>
      </main>
    </>
  );
}
