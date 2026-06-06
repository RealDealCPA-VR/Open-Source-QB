'use client';
import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button, Card, Input, Label, PageHeader, toast } from '@/components/ui';
import { api } from '@/lib/client';

export default function SecurityPage() {
  const [secret, setSecret] = useState('');
  const [otpUrl, setOtpUrl] = useState('');
  const [code, setCode] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  async function setup() {
    setBusy(true);
    try {
      const r = await api.post<{ secret: string; otpauthUrl: string }>('/api/auth/2fa/setup');
      setSecret(r.secret);
      setOtpUrl(r.otpauthUrl);
      toast('Scan or enter the secret in your authenticator app, then enter a code.', 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'danger');
    } finally {
      setBusy(false);
    }
  }
  async function enable() {
    setBusy(true);
    try {
      await api.post('/api/auth/2fa/enable', { token: code });
      setEnabled(true);
      toast('Two-factor authentication enabled.', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Invalid code', 'danger');
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    try {
      await api.post('/api/auth/2fa/disable', { token: code });
      setEnabled(false);
      setSecret('');
      setOtpUrl('');
      toast('Two-factor authentication disabled.', 'info');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader title="Security" icon={ShieldCheck} />
      <Card className="p-6 max-w-xl">
        <h2 className="text-lg font-bold text-navy mb-1">Two-Factor Authentication (TOTP)</h2>
        <p className="text-sm text-navy/50 mb-4">
          Add a second step at sign-in using Google Authenticator, Authy, or 1Password.
        </p>

        {!secret && !enabled && (
          <Button onClick={setup} disabled={busy}>Set up authenticator</Button>
        )}

        {secret && !enabled && (
          <div className="space-y-3">
            <div>
              <Label>Secret key (enter in your app)</Label>
              <code className="block bg-navy/5 rounded-lg px-3 py-2 text-navy font-mono text-sm break-all">{secret}</code>
            </div>
            <div>
              <Label>otpauth URL</Label>
              <code className="block bg-navy/5 rounded-lg px-3 py-2 text-navy/70 font-mono text-xs break-all">{otpUrl}</code>
            </div>
            <div>
              <Label>Enter the 6-digit code to confirm</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" />
            </div>
            <Button onClick={enable} disabled={busy || code.length < 6}>Enable 2FA</Button>
          </div>
        )}

        {enabled && (
          <div className="space-y-3">
            <p className="text-emerald font-semibold">✓ Two-factor authentication is enabled.</p>
            <div>
              <Label>Enter a current code to disable</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" inputMode="numeric" />
            </div>
            <Button variant="danger" onClick={disable} disabled={busy}>Disable 2FA</Button>
          </div>
        )}
      </Card>
    </main>
  );
}
