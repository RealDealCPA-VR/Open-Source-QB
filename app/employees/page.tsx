'use client';

import { useEffect, useState } from 'react';
import { UserSquare, Plus, Play, KeyRound, Pencil, Ban, RotateCcw, MinusCircle } from 'lucide-react';
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
  ConfirmDialog,
  EmptyState,
  Spinner,
  PageHeader,
  toast,
} from '@/components/ui';
import { api, ApiError } from '@/lib/client';
import { formatCurrency } from '@/lib/money';
import { formatDate } from '@/lib/dates';
import Decimal from 'decimal.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EmployeeAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
}

interface EmployeeW4 {
  filingStatus?: 'single' | 'married';
  dependents?: number;
  extraWithholding?: string;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  payType: 'hourly' | 'salary' | 'commission';
  payRate: string;
  ssnLast4: string | null;
  w4: EmployeeW4 | null;
  address: EmployeeAddress | null;
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
  isVoid: boolean;
  ytdGross: string | null;
  ytdNet: string | null;
}

interface EmployeeFormState {
  firstName: string;
  lastName: string;
  email: string;
  payType: 'hourly' | 'salary' | 'commission';
  payRate: string;
  // Payroll info (edit modal)
  ssn: string; // new entry only — existing value shown masked
  filingStatus: 'single' | 'married';
  dependents: string;
  extraWithholding: string;
  addrLine1: string;
  addrLine2: string;
  addrCity: string;
  addrState: string;
  addrZip: string;
  isActive: boolean;
}

type EarningKind = 'regular' | 'overtime' | 'bonus' | 'commission';

interface EarningRow {
  kind: EarningKind;
  hours: string;
  rate: string;
  amount: string;
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
  earnings: EarningRow[];
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
  ssn: '',
  filingStatus: 'single',
  dependents: '',
  extraWithholding: '',
  addrLine1: '',
  addrLine2: '',
  addrCity: '',
  addrState: '',
  addrZip: '',
  isActive: true,
};

const EMPTY_PAYROLL_FORM: PayrollFormState = {
  employeeId: '',
  payDate: new Date().toISOString().slice(0, 10),
  periodStart: '',
  periodEnd: '',
  earnings: [{ kind: 'regular', hours: '', rate: '', amount: '' }],
  taxes: [{ name: '', amount: '' }],
  deductions: [],
};

const PAY_TYPE_LABELS: Record<string, string> = {
  hourly: 'Hourly',
  salary: 'Salary',
  commission: 'Commission',
};

const EARNING_LABELS: Record<EarningKind, string> = {
  regular: 'Regular',
  overtime: 'Overtime',
  bonus: 'Bonus',
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

function computeGross(earnings: EarningRow[]): Decimal {
  return earnings.reduce((s, e) => s.plus(toDecimalSafe(e.amount)), new Decimal(0));
}

function computeNet(form: PayrollFormState): string {
  const gross = computeGross(form.earnings);
  const taxSum = form.taxes.reduce((s, t) => s.plus(toDecimalSafe(t.amount)), new Decimal(0));
  const dedSum = form.deductions.reduce((s, d) => s.plus(toDecimalSafe(d.amount)), new Decimal(0));
  return gross.minus(taxSum).minus(dedSum).toFixed(2);
}

function employeeName(emp: Employee) {
  return `${emp.firstName} ${emp.lastName}`;
}

function employeeToForm(emp: Employee): EmployeeFormState {
  return {
    firstName: emp.firstName,
    lastName: emp.lastName,
    email: emp.email ?? '',
    payType: emp.payType,
    payRate: emp.payRate,
    ssn: '',
    filingStatus: emp.w4?.filingStatus === 'married' ? 'married' : 'single',
    dependents: emp.w4?.dependents != null ? String(emp.w4.dependents) : '',
    extraWithholding: emp.w4?.extraWithholding != null ? String(emp.w4.extraWithholding) : '',
    addrLine1: emp.address?.line1 ?? '',
    addrLine2: emp.address?.line2 ?? '',
    addrCity: emp.address?.city ?? '',
    addrState: emp.address?.state ?? '',
    addrZip: emp.address?.zip ?? '',
    isActive: emp.isActive,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmployeeForm({
  form,
  onChange,
  ssnLast4,
  showPayrollInfo,
}: {
  form: EmployeeFormState;
  onChange: (field: keyof EmployeeFormState, value: string) => void;
  ssnLast4?: string | null;
  showPayrollInfo?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="firstName">First Name *</Label>
          <Input
            id="firstName"
            placeholder="Jane"
            autoFocus
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

      {showPayrollInfo && (
        <>
          <div className="border-t border-slate-200 pt-3">
            <p className="text-xs font-semibold text-navy/50 uppercase tracking-wide mb-3">
              Payroll Info
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="empSsn">SSN</Label>
                <Input
                  id="empSsn"
                  placeholder={ssnLast4 ? `•••-••-${ssnLast4} (on file)` : '123-45-6789'}
                  value={form.ssn}
                  onChange={(e) => onChange('ssn', e.target.value)}
                  autoComplete="off"
                />
                {ssnLast4 && (
                  <p className="text-[11px] text-navy/40 mt-1">
                    Leave blank to keep the SSN on file.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="empFiling">W-4 Filing Status</Label>
                <Select
                  id="empFiling"
                  value={form.filingStatus}
                  onChange={(e) => onChange('filingStatus', e.target.value)}
                >
                  <option value="single">Single</option>
                  <option value="married">Married</option>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <Label htmlFor="empDependents">W-4 Dependents</Label>
                <Input
                  id="empDependents"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={form.dependents}
                  onChange={(e) => onChange('dependents', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="empExtraWh">Extra Withholding / Period</Label>
                <Input
                  id="empExtraWh"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.extraWithholding}
                  onChange={(e) => onChange('extraWithholding', e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <p className="text-xs font-semibold text-navy/50 uppercase tracking-wide mb-3">
              Address
            </p>
            <div className="flex flex-col gap-3">
              <Input
                placeholder="Street address"
                value={form.addrLine1}
                onChange={(e) => onChange('addrLine1', e.target.value)}
              />
              <Input
                placeholder="Apt / Suite (optional)"
                value={form.addrLine2}
                onChange={(e) => onChange('addrLine2', e.target.value)}
              />
              <div className="grid grid-cols-3 gap-3">
                <Input
                  placeholder="City"
                  value={form.addrCity}
                  onChange={(e) => onChange('addrCity', e.target.value)}
                />
                <Input
                  placeholder="State"
                  maxLength={2}
                  value={form.addrState}
                  onChange={(e) => onChange('addrState', e.target.value.toUpperCase())}
                />
                <Input
                  placeholder="ZIP"
                  value={form.addrZip}
                  onChange={(e) => onChange('addrZip', e.target.value)}
                />
              </div>
            </div>
          </div>
        </>
      )}
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
            className="text-red-400 hover:text-red-600 px-1 transition-colors"
            title="Remove line"
          >
            <MinusCircle className="h-4 w-4" />
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
  const [showInactive, setShowInactive] = useState(false);

  // Add employee modal
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<EmployeeFormState>(EMPTY_EMPLOYEE_FORM);
  const [addSaving, setAddSaving] = useState(false);

  // Edit employee modal
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EmployeeFormState>(EMPTY_EMPLOYEE_FORM);
  const [editSaving, setEditSaving] = useState(false);

  // Run payroll modal
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [payrollForm, setPayrollForm] = useState<PayrollFormState>(EMPTY_PAYROLL_FORM);
  const [payrollSaving, setPayrollSaving] = useState(false);

  // Voiding state (paycheck pending confirmation + id being voided)
  const [pendingVoid, setPendingVoid] = useState<(Paycheck & { employeeName: string }) | null>(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);

  // Deactivation confirm state
  const [pendingDeactivate, setPendingDeactivate] = useState<Employee | null>(null);
  const [deactivating, setDeactivating] = useState(false);

  // Portal password modal state
  const [portalTarget, setPortalTarget] = useState<Employee | null>(null);
  const [portalPassword, setPortalPassword] = useState('');
  const [portalSaving, setPortalSaving] = useState(false);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  async function fetchAll() {
    setLoading(true);
    try {
      const [empData, pcData] = await Promise.all([
        api.get<Employee[]>('/api/employees?includeInactive=true'),
        api.get<Paycheck[]>('/api/payroll?includeVoided=true'),
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
  // Edit employee
  // ---------------------------------------------------------------------------

  function openEditModal(emp: Employee) {
    setEditId(emp.id);
    setEditForm(employeeToForm(emp));
    setEditOpen(true);
  }

  function updateEditForm(field: keyof EmployeeFormState, value: string) {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  }

  function buildPatchBody(form: EmployeeFormState) {
    const hasAddress =
      form.addrLine1.trim() || form.addrLine2.trim() || form.addrCity.trim() ||
      form.addrState.trim() || form.addrZip.trim();
    return {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim() || null,
      payType: form.payType,
      payRate: form.payRate,
      // SSN only when a new value was typed — blank keeps what is on file.
      ...(form.ssn.trim() ? { ssn: form.ssn.trim() } : {}),
      w4: {
        filingStatus: form.filingStatus,
        dependents: form.dependents ? Number(form.dependents) : 0,
        extraWithholding: form.extraWithholding || '0',
      },
      address: hasAddress
        ? {
            line1: form.addrLine1.trim(),
            line2: form.addrLine2.trim() || undefined,
            city: form.addrCity.trim(),
            state: form.addrState.trim(),
            zip: form.addrZip.trim(),
          }
        : null,
    };
  }

  async function handleEditSave() {
    if (!editId) return;
    if (!editForm.firstName.trim()) { toast('First name is required', 'danger'); return; }
    if (!editForm.lastName.trim()) { toast('Last name is required', 'danger'); return; }
    if (!editForm.payRate || Number(editForm.payRate) < 0) {
      toast('Pay rate must be 0 or more', 'danger'); return;
    }
    setEditSaving(true);
    try {
      await api.patch(`/api/employees/${editId}`, buildPatchBody(editForm));
      toast('Employee updated', 'success');
      setEditOpen(false);
      await fetchAll();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to update employee', 'danger');
    } finally {
      setEditSaving(false);
    }
  }

  async function setActive(emp: Employee, isActive: boolean) {
    const verb = isActive ? 'reactivate' : 'deactivate';
    try {
      await api.patch(`/api/employees/${emp.id}`, { isActive });
      toast(`Employee ${verb}d`, 'success');
      await fetchAll();
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : `Failed to ${verb} employee`, 'danger');
      return false;
    }
  }

  function handleToggleActive(emp: Employee) {
    if (emp.isActive) {
      setPendingDeactivate(emp);
    } else {
      void setActive(emp, true);
    }
  }

  async function handleConfirmDeactivate() {
    if (!pendingDeactivate) return;
    setDeactivating(true);
    const ok = await setActive(pendingDeactivate, false);
    setDeactivating(false);
    if (ok) setPendingDeactivate(null);
  }

  // ---------------------------------------------------------------------------
  // Portal password
  // ---------------------------------------------------------------------------

  function openPortalModal(emp: Employee) {
    setPortalPassword('');
    setPortalTarget(emp);
  }

  async function handleSetPortalPassword() {
    if (!portalTarget) return;
    if (portalPassword.length < 6) {
      toast('Password must be at least 6 characters', 'danger');
      return;
    }
    setPortalSaving(true);
    try {
      await api.post(`/api/employees/${portalTarget.id}/portal-password`, {
        password: portalPassword,
      });
      toast('Portal access enabled', 'success');
      setPortalTarget(null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to set password', 'danger');
    } finally {
      setPortalSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Run payroll
  // ---------------------------------------------------------------------------

  function defaultEarningsFor(emp: Employee | undefined): EarningRow[] {
    return [
      {
        kind: 'regular',
        hours: '',
        rate: emp?.payType === 'hourly' ? emp.payRate : '',
        amount: '',
      },
    ];
  }

  function openPayrollModal(empId?: string) {
    const activeEmployees = employees.filter((e) => e.isActive);
    const target =
      activeEmployees.find((e) => e.id === empId) ?? activeEmployees[0];
    setPayrollForm({
      ...EMPTY_PAYROLL_FORM,
      employeeId: target?.id ?? '',
      payDate: new Date().toISOString().slice(0, 10),
      earnings: defaultEarningsFor(target),
    });
    setPayrollOpen(true);
  }

  function updatePayrollField(
    field: keyof Omit<PayrollFormState, 'taxes' | 'deductions' | 'earnings'>,
    value: string,
  ) {
    setPayrollForm((prev) => {
      const next = { ...prev, [field]: value };
      if (field === 'employeeId') {
        const emp = employees.find((e) => e.id === value);
        next.earnings = defaultEarningsFor(emp);
      }
      return next;
    });
  }

  // ---- Earnings rows ----

  function updateEarningRow(idx: number, field: keyof EarningRow, value: string) {
    setPayrollForm((prev) => {
      const earnings = [...prev.earnings];
      const row = { ...earnings[idx], [field]: value };
      // Auto-calc amount = hours x rate when both present.
      if (field === 'hours' || field === 'rate') {
        const h = toDecimalSafe(row.hours);
        const r = toDecimalSafe(row.rate);
        if (row.hours && row.rate) row.amount = h.times(r).toFixed(2);
      }
      earnings[idx] = row;
      return { ...prev, earnings };
    });
  }

  function addEarningRow(kind: EarningKind = 'regular') {
    setPayrollForm((prev) => {
      const emp = employees.find((e) => e.id === prev.employeeId);
      let rate = '';
      if (emp?.payType === 'hourly') {
        rate =
          kind === 'overtime'
            ? toDecimalSafe(emp.payRate).times('1.5').toFixed(2)
            : emp.payRate;
      }
      return {
        ...prev,
        earnings: [...prev.earnings, { kind, hours: '', rate, amount: '' }],
      };
    });
  }

  function removeEarningRow(idx: number) {
    setPayrollForm((prev) => ({
      ...prev,
      earnings: prev.earnings.filter((_, i) => i !== idx),
    }));
  }

  // ---- Tax / deduction rows ----

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
    const earningRows = payrollForm.earnings.filter((e) => Number(e.amount) > 0);
    if (earningRows.length === 0) {
      toast('Add at least one earnings line with an amount', 'danger'); return;
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
        earnings: earningRows.map((e) => ({
          kind: e.kind,
          hours: e.hours || undefined,
          rate: e.rate || undefined,
          amount: e.amount,
        })),
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
  // Void paycheck
  // ---------------------------------------------------------------------------

  async function handleVoidPaycheck() {
    const pc = pendingVoid;
    if (!pc) return;
    setVoidingId(pc.id);
    try {
      await api.del(`/api/payroll/${pc.id}`);
      toast('Paycheck voided', 'success');
      setPendingVoid(null);
      await fetchAll();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to void paycheck', 'danger');
    } finally {
      setVoidingId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const grossPreview = computeGross(payrollForm.earnings).toFixed(2);
  const netPreview = computeNet(payrollForm);
  const netIsNegative = parseFloat(netPreview) < 0;

  const selectedEmployee = employees.find((e) => e.id === payrollForm.employeeId);

  const visibleEmployees = showInactive ? employees : employees.filter((e) => e.isActive);
  const inactiveCount = employees.filter((e) => !e.isActive).length;

  const paycheckWithName = paychecks.map((pc) => {
    const emp = employees.find((e) => e.id === pc.employeeId);
    return { ...pc, employeeName: emp ? employeeName(emp) : 'Unknown employee' };
  });

  const editingEmployee = employees.find((e) => e.id === editId);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Employees & Payroll"
        icon={UserSquare}
        action={
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => openPayrollModal()} disabled={employees.filter((e) => e.isActive).length === 0}>
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
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-navy/60 uppercase tracking-wide">Employees</h2>
          <label className="flex items-center gap-2 text-xs text-navy/60 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="accent-electric"
            />
            Show inactive{inactiveCount > 0 ? ` (${inactiveCount})` : ''}
          </label>
        </div>
        {loading ? (
          <div className="p-12 flex justify-center text-electric">
            <Spinner className="h-6 w-6" />
          </div>
        ) : visibleEmployees.length === 0 ? (
          <EmptyState
            icon={UserSquare}
            title={employees.length === 0 ? 'No employees yet' : 'No active employees'}
            message={
              employees.length === 0
                ? 'Add your first employee to start running payroll.'
                : 'Toggle "Show inactive" to see deactivated employees.'
            }
            action={
              employees.length === 0 ? (
                <Button onClick={openAddModal}>
                  <Plus className="h-4 w-4" /> Add Employee
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Pay Type</Th>
                <Th numeric>Pay Rate</Th>
                <Th>SSN</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.map((emp) => (
                <Tr key={emp.id}>
                  <Td className="font-semibold text-navy">{employeeName(emp)}</Td>
                  <Td className="text-navy/70">{emp.email ?? '-'}</Td>
                  <Td className="text-navy/70">{PAY_TYPE_LABELS[emp.payType] ?? emp.payType}</Td>
                  <Td numeric className="text-navy">
                    {formatCurrency(emp.payRate)}
                    {emp.payType === 'hourly' && <span className="text-navy/40 text-xs ml-1">/hr</span>}
                  </Td>
                  <Td className="font-mono text-navy/60 text-xs">
                    {emp.ssnLast4 ? `•••-••-${emp.ssnLast4}` : '—'}
                  </Td>
                  <Td>
                    {emp.isActive ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="neutral">Inactive</Badge>
                    )}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditModal(emp)}
                      title="Edit employee"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
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
                      onClick={() => openPortalModal(emp)}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Portal
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleActive(emp)}
                      title={emp.isActive ? 'Deactivate employee' : 'Reactivate employee'}
                    >
                      {emp.isActive ? (
                        <><Ban className="h-3.5 w-3.5" /> Deactivate</>
                      ) : (
                        <><RotateCcw className="h-3.5 w-3.5" /> Reactivate</>
                      )}
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
          <div className="p-8 flex justify-center text-electric">
            <Spinner className="h-6 w-6" />
          </div>
        ) : paycheckWithName.length === 0 ? (
          <div className="p-8 text-center text-navy/40 text-sm">No paychecks yet.</div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Pay Date</Th>
                <Th>Period</Th>
                <Th numeric>Gross</Th>
                <Th numeric>Taxes</Th>
                <Th numeric>Deductions</Th>
                <Th numeric>Net Pay</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {paycheckWithName.map((pc) => (
                <Tr key={pc.id} className={pc.isVoid ? 'opacity-60' : undefined}>
                  <Td className="font-semibold text-navy">{pc.employeeName}</Td>
                  <Td className="text-navy/70">{formatDate(pc.payDate)}</Td>
                  <Td className="text-navy/50 text-xs">
                    {pc.periodStart && pc.periodEnd
                      ? `${formatDate(pc.periodStart)} – ${formatDate(pc.periodEnd)}`
                      : '-'}
                  </Td>
                  <Td numeric className="text-navy">{formatCurrency(pc.grossPay)}</Td>
                  <Td numeric className="text-navy/70">{formatCurrency(pc.totalTaxes)}</Td>
                  <Td numeric className="text-navy/70">{formatCurrency(pc.totalDeductions)}</Td>
                  <Td numeric className="font-semibold text-navy">{formatCurrency(pc.netPay)}</Td>
                  <Td>
                    {pc.isVoid ? (
                      <Badge tone="void">Void</Badge>
                    ) : pc.postedEntryId ? (
                      <Badge tone="success">Posted</Badge>
                    ) : (
                      <Badge tone="neutral">Draft</Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    {!pc.isVoid && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingVoid(pc)}
                        disabled={voidingId === pc.id}
                        title="Void this paycheck (reverses the GL entry)"
                      >
                        <Ban className="h-3.5 w-3.5" />
                        Void
                      </Button>
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
            <Button onClick={handleAdd} loading={addSaving}>
              Create Employee
            </Button>
          </>
        }
      >
        <EmployeeForm form={addForm} onChange={updateAddForm} />
      </Modal>

      {/* ---- Edit Employee Modal ---- */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={editingEmployee ? `Edit ${employeeName(editingEmployee)}` : 'Edit Employee'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={editSaving}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} loading={editSaving}>
              Save Changes
            </Button>
          </>
        }
      >
        <EmployeeForm
          form={editForm}
          onChange={updateEditForm}
          ssnLast4={editingEmployee?.ssnLast4}
          showPayrollInfo
        />
      </Modal>

      {/* ---- Run Payroll Modal ---- */}
      <Modal
        open={payrollOpen}
        onClose={() => setPayrollOpen(false)}
        size="lg"
        title="Run Payroll"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPayrollOpen(false)} disabled={payrollSaving}>
              Cancel
            </Button>
            <Button onClick={handleRunPayroll} disabled={netIsNegative} loading={payrollSaving}>
              Post Paycheck
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
              autoFocus
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

          {/* Earnings rows */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Earnings *</Label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => addEarningRow('overtime')}
                  className="text-xs text-electric hover:underline"
                  title={selectedEmployee?.payType === 'hourly'
                    ? `Overtime at 1.5x rate (${formatCurrency(toDecimalSafe(selectedEmployee.payRate).times('1.5').toFixed(2))}/hr)`
                    : 'Add an overtime line'}
                >
                  + Overtime (1.5x)
                </button>
                <button
                  type="button"
                  onClick={() => addEarningRow('regular')}
                  className="text-xs text-electric hover:underline"
                >
                  + Add line
                </button>
              </div>
            </div>
            <div className="grid grid-cols-[1fr_5rem_6rem_7rem_1rem] gap-2 mb-1 text-[11px] text-navy/40 font-medium px-1">
              <span>Type</span>
              <span>Hours</span>
              <span>Rate</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
            {payrollForm.earnings.map((row, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_5rem_6rem_7rem_1rem] gap-2 mb-2 items-center">
                <Select
                  value={row.kind}
                  onChange={(e) => updateEarningRow(idx, 'kind', e.target.value)}
                >
                  {(Object.keys(EARNING_LABELS) as EarningKind[]).map((k) => (
                    <option key={k} value={k}>{EARNING_LABELS[k]}</option>
                  ))}
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.25"
                  placeholder="hrs"
                  value={row.hours}
                  onChange={(e) => updateEarningRow(idx, 'hours', e.target.value)}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="rate"
                  value={row.rate}
                  onChange={(e) => updateEarningRow(idx, 'rate', e.target.value)}
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={row.amount}
                  onChange={(e) => updateEarningRow(idx, 'amount', e.target.value)}
                  className="text-right"
                />
                <button
                  type="button"
                  onClick={() => removeEarningRow(idx)}
                  className="text-red-400 hover:text-red-600 transition-colors"
                  title="Remove line"
                >
                  <MinusCircle className="h-4 w-4" />
                </button>
              </div>
            ))}
            <p className="text-xs text-navy/50 text-right font-medium">
              Gross: <span className="font-mono">{formatCurrency(grossPreview)}</span>
            </p>
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
                GL: Dr 6500 Payroll Expense {formatCurrency(grossPreview)} |
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

      {/* ---- Portal Password Modal ---- */}
      <Modal
        open={!!portalTarget}
        onClose={() => setPortalTarget(null)}
        title={
          portalTarget
            ? `Portal Access — ${employeeName(portalTarget)}`
            : 'Portal Access'
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setPortalTarget(null)}
              disabled={portalSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSetPortalPassword}
              disabled={portalPassword.length < 6}
              loading={portalSaving}
            >
              Set Password
            </Button>
          </>
        }
      >
        <p className="text-sm text-navy/60 mb-4">
          Set a password for this employee&apos;s self-service portal. They sign in with their
          email to view pay stubs.
        </p>
        <div>
          <Label htmlFor="portalPassword">Portal Password</Label>
          <Input
            id="portalPassword"
            type="password"
            autoFocus
            minLength={6}
            placeholder="Minimum 6 characters"
            value={portalPassword}
            onChange={(e) => setPortalPassword(e.target.value)}
            autoComplete="new-password"
          />
          {portalPassword.length > 0 && portalPassword.length < 6 && (
            <p className="text-xs text-red-500 mt-1">Password must be at least 6 characters.</p>
          )}
        </div>
      </Modal>

      {/* ---- Deactivate confirmation ---- */}
      <ConfirmDialog
        open={!!pendingDeactivate}
        title="Deactivate employee?"
        message={
          pendingDeactivate
            ? `Deactivate ${employeeName(pendingDeactivate)}? Inactive employees cannot be paid.`
            : undefined
        }
        confirmLabel="Deactivate"
        tone="danger"
        loading={deactivating}
        onConfirm={handleConfirmDeactivate}
        onClose={() => setPendingDeactivate(null)}
      />

      {/* ---- Void paycheck confirmation ---- */}
      <ConfirmDialog
        open={!!pendingVoid}
        title="Void paycheck?"
        message={
          pendingVoid
            ? `Void the ${formatDate(pendingVoid.payDate)} paycheck for ${pendingVoid.employeeName} (net ${formatCurrency(pendingVoid.netPay)})? This reverses the GL posting.`
            : undefined
        }
        confirmLabel="Void"
        tone="danger"
        loading={voidingId !== null}
        onConfirm={handleVoidPaycheck}
        onClose={() => setPendingVoid(null)}
      />
    </main>
  );
}
