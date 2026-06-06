'use client';

/**
 * Payroll Forms page — W-2 and Form 941 PDF downloads.
 *
 * - W-2 section: select employee + year → "Download W-2" opens the PDF in a new tab.
 * - Form 941 section: pick quarter + year → "Download 941" opens the PDF in a new tab.
 */
import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import {
  Button,
  Card,
  Input,
  Select,
  Label,
  PageHeader,
  toast,
  Toaster,
} from '@/components/ui';
import { api, ApiError } from '@/lib/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const currentYear = new Date().getFullYear();

/** Build a list of recent years for the year picker. */
function recentYears(count = 5): number[] {
  return Array.from({ length: count }, (_, i) => currentYear - i);
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function PayrollFormsPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);

  // W-2 form state
  const [w2EmployeeId, setW2EmployeeId] = useState('');
  const [w2Year, setW2Year]             = useState(String(currentYear - 1));

  // 941 form state
  const [q941Quarter, setQ941Quarter] = useState('1');
  const [q941Year, setQ941Year]       = useState(String(currentYear));

  // ---------------------------------------------------------------------------
  // Load employees on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    async function load() {
      setLoadingEmployees(true);
      try {
        const data = await api.get<Employee[]>('/api/employees');
        const active = data.filter((e) => e.isActive);
        setEmployees(active);
        if (active.length > 0) setW2EmployeeId(active[0].id);
      } catch (err) {
        toast(err instanceof ApiError ? err.message : 'Failed to load employees', 'danger');
      } finally {
        setLoadingEmployees(false);
      }
    }
    load();
  }, []);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleDownloadW2() {
    if (!w2EmployeeId) { toast('Please select an employee', 'danger'); return; }
    if (!w2Year)        { toast('Please select a year', 'danger');     return; }
    const url = `/api/payroll/w2?employeeId=${encodeURIComponent(w2EmployeeId)}&year=${encodeURIComponent(w2Year)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function handleDownload941() {
    if (!q941Quarter) { toast('Please select a quarter', 'danger'); return; }
    if (!q941Year)    { toast('Please select a year', 'danger');   return; }
    const url = `/api/payroll/941?quarter=${encodeURIComponent(q941Quarter)}&year=${encodeURIComponent(q941Year)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader title="Payroll Tax Forms" icon={FileText} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6 max-w-3xl">

        {/* ---- W-2 Section ---- */}
        <Card className="p-6 flex flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold text-navy">W-2 — Wage and Tax Statement</h2>
            <p className="text-xs text-navy/50 mt-1">
              Download a W-2 statement for one employee for a full calendar year.
            </p>
          </div>

          <div>
            <Label htmlFor="w2Employee">Employee</Label>
            {loadingEmployees ? (
              <p className="text-xs text-navy/40 mt-1">Loading employees…</p>
            ) : employees.length === 0 ? (
              <p className="text-xs text-navy/40 mt-1">No active employees found.</p>
            ) : (
              <Select
                id="w2Employee"
                value={w2EmployeeId}
                onChange={(e) => setW2EmployeeId(e.target.value)}
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div>
            <Label htmlFor="w2Year">Tax Year</Label>
            <Select
              id="w2Year"
              value={w2Year}
              onChange={(e) => setW2Year(e.target.value)}
            >
              {recentYears().map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </Select>
          </div>

          <Button
            onClick={handleDownloadW2}
            disabled={loadingEmployees || employees.length === 0}
            className="mt-auto"
          >
            <FileText className="h-4 w-4" />
            Download W-2
          </Button>
        </Card>

        {/* ---- Form 941 Section ---- */}
        <Card className="p-6 flex flex-col gap-4">
          <div>
            <h2 className="text-base font-semibold text-navy">Form 941 — Quarterly Tax Return</h2>
            <p className="text-xs text-navy/50 mt-1">
              Download a Form 941 summary for a calendar quarter, covering all employees.
            </p>
          </div>

          <div>
            <Label htmlFor="q941Quarter">Quarter</Label>
            <Select
              id="q941Quarter"
              value={q941Quarter}
              onChange={(e) => setQ941Quarter(e.target.value)}
            >
              <option value="1">Q1 — January, February, March</option>
              <option value="2">Q2 — April, May, June</option>
              <option value="3">Q3 — July, August, September</option>
              <option value="4">Q4 — October, November, December</option>
            </Select>
          </div>

          <div>
            <Label htmlFor="q941Year">Year</Label>
            <Select
              id="q941Year"
              value={q941Year}
              onChange={(e) => setQ941Year(e.target.value)}
            >
              {recentYears().map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </Select>
          </div>

          <Button onClick={handleDownload941} className="mt-auto">
            <FileText className="h-4 w-4" />
            Download 941
          </Button>
        </Card>

      </div>

      <Toaster />
    </main>
  );
}
