'use client';

import { useRef, useState } from 'react';
import { ArchiveRestore, Download } from 'lucide-react';
import {
  Button,
  Card,
  Modal,
  PageHeader,
  toast,
  Toaster,
} from '@/components/ui';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BackupPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Download state ----
  const [downloading, setDownloading] = useState(false);

  // ---- Restore confirm modal ----
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);

  // ---------------------------------------------------------------------------
  // Download backup
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

      // Extract filename from Content-Disposition or fall back.
      let filename = 'bookkeeper-backup.bka';
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

      toast('Backup downloaded successfully.', 'success');
    } catch {
      toast('Backup failed. Please try again.', 'danger');
    } finally {
      setDownloading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Restore — file selection (opens confirm modal)
  // ---------------------------------------------------------------------------

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    // Reset input so same file can be selected again after a cancel.
    e.target.value = '';
    if (!file) return;
    setPendingFile(file);
    setRestoreModalOpen(true);
  }

  // ---------------------------------------------------------------------------
  // Restore — confirmed, POST bytes to API
  // ---------------------------------------------------------------------------

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
      <Toaster />
      <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
        <PageHeader title="Backup & Restore" icon={ArchiveRestore} />

        <div className="max-w-xl flex flex-col gap-6">
          {/* Download card */}
          <Card className="p-6 flex flex-col gap-3">
            <h2 className="text-lg font-bold text-navy">Download Backup</h2>
            <p className="text-sm text-navy/60">
              Save a complete snapshot of your company data to your computer as a{' '}
              <span className="font-mono text-navy/80">.bka</span> file. Keep this file in a safe
              place — it contains all your accounts, transactions, and settings.
            </p>
            <div>
              <Button onClick={handleDownload} disabled={downloading}>
                <Download className="h-4 w-4" />
                {downloading ? 'Preparing backup…' : 'Download Backup (.bka)'}
              </Button>
            </div>
          </Card>

          {/* Restore card */}
          <Card className="p-6 flex flex-col gap-3">
            <h2 className="text-lg font-bold text-navy">Restore from Backup</h2>
            <p className="text-sm text-navy/60">
              Overwrite the current company data with a previously saved{' '}
              <span className="font-mono text-navy/80">.bka</span> backup file. This cannot be
              undone — make sure to download a backup of the current data first if needed.
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

        {/* Confirmation modal */}
        <Modal
          open={restoreModalOpen}
          onClose={handleRestoreCancel}
          title="Restore Backup?"
          footer={
            <>
              <Button variant="secondary" onClick={handleRestoreCancel} disabled={restoring}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleRestoreConfirm} disabled={restoring}>
                {restoring ? 'Restoring…' : 'Yes, Overwrite & Restore'}
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
      </main>
    </>
  );
}
