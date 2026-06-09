'use client';
import { useEffect, useState } from 'react';
import { Building2, Plus, Check } from 'lucide-react';
import { Button, Card, EmptyState, Input, Label, Modal, PageHeader, PageSkeleton, toast } from '@/components/ui';
import { api } from '@/lib/client';

interface Company {
  id: string;
  name: string;
  createdAt: string;
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setCompanies(await api.get<Company[]>('/api/companies'));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to load', 'danger');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.post('/api/companies', { name });
      toast('Company created', 'success');
      setOpen(false);
      setName('');
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'danger');
    } finally {
      setSaving(false);
    }
  }

  async function open_(id: string) {
    try {
      await api.post('/api/companies/select', { companyId: id });
      toast('Switched company', 'success');
      window.location.href = '/dashboard';
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed', 'danger');
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Companies"
        icon={Building2}
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> New Company
          </Button>
        }
      />
      {loading ? (
        <PageSkeleton rows={4} />
      ) : companies.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="No companies yet"
            message="Create your first company file to get started."
            action={
              <Button onClick={() => setOpen(true)}>
                <Plus className="h-4 w-4" /> New Company
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {companies.map((c) => (
            <Card key={c.id} className="p-6 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-navy h-10 w-10 flex items-center justify-center">
                  <Building2 className="text-gold h-5 w-5" />
                </div>
                <div>
                  <div className="font-bold text-navy">{c.name}</div>
                  <div className="text-xs text-navy/40">Company file</div>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => open_(c.id)}>
                <Check className="h-4 w-4" /> Open
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New Company"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="new-company-form" loading={saving}>
              Create
            </Button>
          </>
        }
      >
        <form
          id="new-company-form"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Label htmlFor="company-name">Company name</Label>
          <Input id="company-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc." autoFocus />
          <p className="mt-2 text-xs text-navy/40">A default Chart of Accounts will be created for you.</p>
        </form>
      </Modal>
    </main>
  );
}
