'use client';

import { useEffect, useState } from 'react';
import { Users, Plus, Play, KeyRound } from 'lucide-react';
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
  PageHeader,
  toast,
  Toaster,
} from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';
import Decimal from 'decimal.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  payType: 'hourly' | 'salary' | 'commission';
  payRate: string;
  isActive: boolean;
}

interface Paycheck {
  id: string;
  employeeId: string;
  payDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  grossPay: string;
  totalTaxes: string;
  totalDeductions: string;
  netPay: string;
  postedEntryId: string | null;
}

interface EmployeeFormState {
  firstName: string;
  lastName: string;
  email: string;
  payType: 'hourly' | 'salary' | 'commission';
  payRate: string;
}

interface PayrollLineInput {
  name: string;
  amount: string;
}

interface PayrollFormState {
  employeeId: string;
  payDate: string;
  periodStart: string;
  periodEnd: string;
  grossPay: string;
  taxes: PayrollLineInput[];
  deductions: PayrollLineInput[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY_EMPLOYEE_FORM: EmployeeFormState = {
  firstName: '',
  lastName: '',
  email: '',
  payType: 'salary',
  payRate: '',
};

const EMPTY_PAYROLL_FORM: PayrollFormState = {
  employeeId: '',
  payDate: new Date().toISOString().slice(0, 10),
  periodStart: '',
  periodEnd: '',
  grossPay: '',
  taxes: [{ name: '', amount: '' }],
  deductions: [],
};

const PAY_TYPE_LABELS: Record<string, string> = {
  hourly: 'Hourly',
  salary: 'Salary',
  commission: 'Commission',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDecimalSafe(val: string): Decimal {
  try {
    return new Decimal(val || '0');
  } catch {
    return new Decimal(0);
  }
}

function computeNet(form: PayrollFormState): string {
  const gross = toDecimalSafe(form.grossPay);
  const taxSum = form.taxes.reduce((s, t) => s.plus(toDecimalSafe(t.amount)), new Decimal(0));
  const dedSum = form.deductions.reduce((s, d) => s.plus(toDecimalSafe(d.amount)), new Decimal(0));
  return gross.minus(taxSum).minus(dedSum).toFixed(2);
}

function employeeName(emp: Employee) {
  return `${emp.firstName} ${emp.lastName}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmployeeForm({
  form,
  onChange,
}: {
  form: EmployeeFormState;
  onChange: (field: keyof EmployeeFormState, value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="firstName">First Name *</Label>
          <Input
            id="firstName"
            placeholder="Jane"
            value={form.firstName}
            onChange={(e) => onChange('firstName', e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="lastName">Last Name *</Label>
          <Input
            id="lastName"
            placeholder="Doe"
            value={form.lastName}
            onChange={(e) => onChange('lastName', e.target.value)}
            required
          />
        </div>
      </div>
      <div>
        <Label htmlFor="empEmail">Email</Label>
        <Input
          id="empEmail"
          type="email"
          placeholder="jane@example.com"
          value={form.email}
          onChange={(e) => onChange('email', e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="payType">Pay Type *</Label>
          <Select
            id="payType"
            value={form.payType}
            onChange={(e) => onChange('payType', e.target.value)}
          >
            <option value="salary">Salary</option>
            <option value="hourly">Hourly</option>
            <option value="commission">Commission</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="payRate">Pay Rate *</Label>
          <Input
            id="payRate"
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.payRate}
            onChange={(e) => onChange('payRate', e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

function LineEditor({
  label,
  lines,
  onChange,
  onAdd,
  onRemove,
}: {
  label: string;
  lines: PayrollLineInput[];
  onChange: (idx: number, field: 'name' | 'amount', value: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label>{label}</Label>
        <button
          type="button"
          onClick={onAdd}
          className="text-xs text-electric hover:underline"
        >
          + Add line
        </button>
      </div>
      {lines.length === 0 && (
        <p className="text-xs text-navy/40 italic">No {label.toLowerCase()} lines.</p>
      )}
      {lines.map((line, idx) => (
        <div key={idx} className="flex gap-2 mb-2">
          <Input
            placeholder="Description"
            value={line.name}
            onChange={(e) => onChange(idx, 'name', e.target.value)}
            className="flex-1"
          />
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={line.amount}
            onChange={(e) => onChange(idx, 'amount', e.target.value)}
            className="w-28"
          />
          <button
            type="button"
            onClick={() => onRemove(idx)}
            className="text-red-400 hover:text-red-600 text-xs px-1"
            title="Remove line"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [paychecks, setPaychecks] = useState<Paycheck[]>([]);
  const [loading, setLoading] = useState(true);

  // Add employee modal
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<EmployeeFormState>(EMPTY_EMPLOYEE_FORM);
  const [addSaving, setAddSaving] = useState(false);

  // Run payroll modal
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [payrollForm, setPayrollForm] = useState<PayrollFormState>(EMPTY_PAYROLL_FORM);
  const [payrollSaving, setPayrollSaving] = useState(false);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  async function fetchAll() {
    setLoading(true);
    try {
      const [empData, pcData] = await Promise.all([
        api.get<Employee[]>('/api/employees'),
        api.get<Paycheck[]>('/api/payroll'),
      ]);
      setEmployees(empData);
      setPaychecks(pcData);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load data', 'danger');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Add employee
  // ---------------------------------------------------------------------------

  function openAddModal() {
    setAddForm(EMPTY_EMPLOYEE_FORM);
    setAddOpen(true);
  }

  function updateAddForm(field: keyof EmployeeFormState, value: string) {
    setAddForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleAdd() {
    if (!addForm.firstName.trim()) { toast('First name is required', 'danger'); return; }
    if (!addForm.lastName.trim()) { toast('Last name is required', 'danger'); return; }
    if (!addForm.payRate || Number(addForm.payRate) < 0) {
      toast('Pay rate must be 0 or more', 'danger'); return;
    }
    setAddSaving(true);
    try {
      await api.post('/api/employees', {
        firstName: addForm.firstName.trim(),
        lastName: addForm.lastName.trim(),
        email: addForm.email.trim() || undefined,
        payType: addForm.payType,
        payRate: addForm.payRate,
      });
      toast('Employee created', 'success');
      setAddOpen(false);
      await fetchAll();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to create employee', 'danger');
    } finally {
      setAddSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Run payroll
  // ---------------------------------------------------------------------------

  function openPayrollModal(empId?: string) {
    setPayrollForm({
      ...EMPTY_PAYROLL_FORM,
      employeeId: empId ?? (employees[0]?.id ?? ''),
      payDate: new Date().toISOString().slice(0, 10),
    });
    setPayrollOpen(true);
  }

  function updatePayrollField(field: keyof Omit<PayrollFormState, 'taxes' | 'deductions'>, value: string) {
    setPayrollForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateTaxLine(idx: number, field: 'name' | 'amount', value: string) {
    setPayrollForm((prev) => {
      const taxes = [...prev.taxes];
      taxes[idx] = { ...taxes[idx], [field]: value };
      return { ...prev, taxes };
    });
  }

  function addTaxLine() {
    setPayrollForm((prev) => ({ ...prev, taxes: [...prev.taxes, { name: '', amount: '' }] }));
  }

  function removeTaxLine(idx: number) {
    setPayrollForm((prev) => ({ ...prev, taxes: prev.taxes.filter((_, i) => i !== idx) }));
  }

  function updateDeductionLine(idx: number, field: 'name' | 'amount', value: string) {
    setPayrollForm((prev) => {
      const deductions = [...prev.deductions];
      deductions[idx] = { ...deductions[idx], [field]: value };
      return { ...prev, deductions };
    });
  }

  function addDeductionLine() {
    setPayrollForm((prev) => ({
      ...prev,
      deductions: [...prev.deductions, { name: '', amount: '' }],
    }));
  }

  function removeDeductionLine(idx: number) {
    setPayrollForm((prev) => ({
      ...prev,
      deductions: prev.deductions.filter((_, i) => i !== idx),
    }));
  }

  async function handleRunPayroll() {
    if (!payrollForm.employeeId) { toast('Select an employee', 'danger'); return; }
    if (!payrollForm.payDate) { toast('Pay date is required', 'danger'); return; }
    if (!payrollForm.grossPay || Number(payrollForm.grossPay) <= 0) {
      toast('Gross pay must be greater than zero', 'danger'); return;
    }
    const net = parseFloat(computeNet(payrollForm));
    if (net < 0) {
      toast('Taxes + deductions exceed gross pay — net pay would be negative', 'danger'); return;
    }

    setPayrollSaving(true);
    try {
      await api.post('/api/payroll', {
        employeeId: payrollForm.employeeId,
        payDate: payrollForm.payDate,
        periodStart: payrollForm.periodStart || undefined,
        periodEnd: payrollForm.periodEnd || undefined,
        grossPay: payrollForm.grossPay,
        taxes: payrollForm.taxes
          .filter((t) => t.name.trim() && Number(t.amount) > 0)
          .map((t) => ({ kind: 'tax', name: t.name.trim(), amount: t.amount })),
        deductions: payrollForm.deductions
          .filter((d) => d.name.trim() && Number(d.amount) > 0)
          .map((d) => ({ kind: 'deduction', name: d.name.trim(), amount: d.amount })),
      });
      toast('Paycheck posted to GL', 'success');
      setPayrollOpen(false);
      await fetchAll();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to run payroll', 'danger');
    } finally {
      setPayrollSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Derived values for payroll modal preview
  // ---------------------------------------------------------------------------

  const netPreview = computeNet(payrollForm);
  const netIsNegative = parseFloat(netPreview) < 0;

  const selectedEmployee = employees.find((e) => e.id === payrollForm.employeeId);

  const paycheckWithName = paychecks.map((pc) => {
    const emp = employees.find((e) => e.id === pc.employeeId);
    return { ...pc, employeeName: emp ? employeeName(emp) : pc.employeeId };
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Employees & Payroll"
        icon={Users}
        action={
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => openPayrollModal()} disabled={employees.length === 0}>
              <Play className="h-4 w-4" />
              Run Payroll
            </Button>
            <Button onClick={openAddModal}>
              <Plus className="h-4 w-4" />
              Add Employee
            </Button>
          </div>
        }
      />

      {/* ---- Employees table ---- */}
      <Card className="mb-6">
        <div className="px-5 pt-4 pb-2">
          <h2 className="text-sm font-semibold text-navy/60 uppercase tracking-wide">Employees</h2>
        </div>
        {loading ? (
          <div className="p-12 text-center text-navy/40 text-sm">Loading...</div>
        ) : employees.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="mx-auto h-10 w-10 text-navy/20 mb-3" />
            <p className="text-navy/50 text-sm">No employees yet. Click "Add Employee" to get started.</p>
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Pay Type</Th>
                <Th className="text-right">Pay Rate</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <Tr key={emp.id}>
                  <Td className="font-semibold text-navy">{employeeName(emp)}</Td>
                  <Td className="text-navy/70">{emp.email ?? '-'}</Td>
                  <Td className="text-navy/70">{PAY_TYPE_LABELS[emp.payType] ?? emp.payType}</Td>
                  <Td className="text-right font-mono text-navy">
                    {formatCurrency(emp.payRate)}
                    {emp.payType === 'hourly' && <span className="text-navy/40 text-xs ml-1">/hr</span>}
                  </Td>
                  <Td>
                    {emp.isActive ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="neutral">Inactive</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openPayrollModal(emp.id)}
                      disabled={!emp.isActive}
                      title="Run paycheck for this employee"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Paycheck
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Set this employee's self-service portal password"
                      onClick={async () => {
                        const pw = window.prompt('Set a portal password for this employee (min 6 chars):');
                        if (!pw) return;
                        const res = await fetch(`/api/employees/${emp.id}/portal-password`, {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ password: pw }),
                        });
                        toast(res.ok ? 'Portal access enabled' : 'Failed to set password', res.ok ? 'success' : 'danger');
                      }}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Portal
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* ---- Recent paychecks table ---- */}
      <Card>
        <div className="px-5 pt-4 pb-2">
          <h2 className="text-sm font-semibold text-navy/60 uppercase tracking-wide">Recent Paychecks</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-navy/40 text-sm">Loading...</div>
        ) : paycheckWithName.length === 0 ? (
          <div className="p-8 text-center text-navy/40 text-sm">No paychecks yet.</div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Pay Date</Th>
                <Th>Period</Th>
                <Th className="text-right">Gross</Th>
                <Th className="text-right">Taxes</Th>
                <Th className="text-right">Deductions</Th>
                <Th className="text-right">Net Pay</Th>
                <Th>GL Entry</Th>
              </tr>
            </thead>
            <tbody>
              {paycheckWithName.map((pc) => (
                <Tr key={pc.id}>
                  <Td className="font-semibold text-navy">{pc.employeeName}</Td>
                  <Td className="text-navy/70">{new Date(pc.payDate).toLocaleDateString()}</Td>
                  <Td className="text-navy/50 text-xs">
                    {pc.periodStart && pc.periodEnd
                      ? `${new Date(pc.periodStart).toLocaleDateString()} – ${new Date(pc.periodEnd).toLocaleDateString()}`
                      : '-'}
                  </Td>
                  <Td className="text-right font-mono text-navy">{formatCurrency(pc.grossPay)}</Td>
                  <Td className="text-right font-mono text-navy/70">{formatCurrency(pc.totalTaxes)}</Td>
                  <Td className="text-right font-mono text-navy/70">{formatCurrency(pc.totalDeductions)}</Td>
                  <Td className="text-right font-mono font-semibold text-navy">{formatCurrency(pc.netPay)}</Td>
                  <Td>
                    {pc.postedEntryId ? (
                      <Badge tone="success">Posted</Badge>
                    ) : (
                      <Badge tone="neutral">Draft</Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* ---- Add Employee Modal ---- */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add Employee"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={addSaving}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={addSaving}>
              {addSaving ? 'Saving...' : 'Create Employee'}
            </Button>
          </>
        }
      >
        <EmployeeForm form={addForm} onChange={updateAddForm} />
      </Modal>

      {/* ---- Run Payroll Modal ---- */}
      <Modal
        open={payrollOpen}
        onClose={() => setPayrollOpen(false)}
        title="Run Payroll"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPayrollOpen(false)} disabled={payrollSaving}>
              Cancel
            </Button>
            <Button onClick={handleRunPayroll} disabled={payrollSaving || netIsNegative}>
              {payrollSaving ? 'Posting...' : 'Post Paycheck'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {/* Employee selector */}
          <div>
            <Label htmlFor="prEmployee">Employee *</Label>
            <Select
              id="prEmployee"
              value={payrollForm.employeeId}
              onChange={(e) => updatePayrollField('employeeId', e.target.value)}
            >
              {employees.filter((e) => e.isActive).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {employeeName(emp)} ({PAY_TYPE_LABELS[emp.payType]} — {formatCurrency(emp.payRate)})
                </option>
              ))}
            </Select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="prPayDate">Pay Date *</Label>
              <Input
                id="prPayDate"
                type="date"
                value={payrollForm.payDate}
                onChange={(e) => updatePayrollField('payDate', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="prPeriodStart">Period Start</Label>
              <Input
                id="prPeriodStart"
                type="date"
                value={payrollForm.periodStart}
                onChange={(e) => updatePayrollField('periodStart', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="prPeriodEnd">Period End</Label>
              <Input
                id="prPeriodEnd"
                type="date"
                value={payrollForm.periodEnd}
                onChange={(e) => updatePayrollField('periodEnd', e.target.value)}
              />
            </div>
          </div>

          {/* Gross pay */}
          <div>
            <Label htmlFor="prGross">Gross Pay *</Label>
            <Input
              id="prGross"
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0.00"
              value={payrollForm.grossPay}
              onChange={(e) => updatePayrollField('grossPay', e.target.value)}
            />
          </div>

          {/* Tax lines */}
          <LineEditor
            label="Tax Withholdings"
            lines={payrollForm.taxes}
            onChange={updateTaxLine}
            onAdd={addTaxLine}
            onRemove={removeTaxLine}
          />

          {/* Deduction lines */}
          <LineEditor
            label="Deductions"
            lines={payrollForm.deductions}
            onChange={updateDeductionLine}
            onAdd={addDeductionLine}
            onRemove={removeDeductionLine}
          />

          {/* Net pay preview */}
          <div className={`rounded-lg p-4 border ${netIsNegative ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-navy/70">Computed Net Pay</span>
              <span className={`text-lg font-bold font-mono ${netIsNegative ? 'text-red-600' : 'text-navy'}`}>
                {formatCurrency(netIsNegative ? '0' : netPreview)}
              </span>
            </div>
            {selectedEmployee && (
              <p className="text-xs text-navy/40 mt-1">
                GL: Dr 6500 Payroll Expense {formatCurrency(payrollForm.grossPay || '0')} |
                Cr 2300 Payroll Liabilities + Cr 1000 Checking
              </p>
            )}
            {netIsNegative && (
              <p className="text-xs text-red-500 mt-1 font-medium">
                Taxes + deductions exceed gross pay. Adjust the amounts before posting.
              </p>
            )}
          </div>
        </div>
      </Modal>

      <Toaster />
    </main>
  );
}
