'use client';
import { usePathname } from 'next/navigation';
import CommandPalette from './CommandPalette';
import {
  Briefcase, PieChart, CreditCard, BookOpen, FileText, BarChart2,
  Users, Settings, Truck, Package, Receipt, Banknote, AlertTriangle, NotebookPen,
  Building2, LogOut, FileCheck, ClipboardList, RotateCcw, HandCoins, ArrowLeftRight,
  Printer, UserSquare, Tag, Repeat, Coins, Rss, Wrench, Calculator,
  ShoppingCart, PiggyBank, FileSpreadsheet, CalendarClock, Briefcase as BriefcaseIcon,
  Layers, ShieldCheck, Network, Landmark, FileClock, Paperclip, BadgeCheck,
  ListChecks, GitMerge, FileX, Clock, Timer, Boxes, Wallet, Percent, Combine,
  GitCompareArrows, CalendarRange, PackageSearch, Scale, BadgePercent, Car,
} from 'lucide-react';

const navGroups: { heading: string; links: { icon: any; label: string; path: string }[] }[] = [
  {
    heading: '',
    links: [{ icon: PieChart, label: 'Dashboard', path: '/dashboard' }],
  },
  {
    heading: 'Sales',
    links: [
      { icon: FileText, label: 'Invoices', path: '/invoices' },
      { icon: ClipboardList, label: 'Estimates', path: '/estimates' },
      { icon: FileCheck, label: 'Sales Orders', path: '/sales-orders' },
      { icon: HandCoins, label: 'Receive Payments', path: '/payments' },
      { icon: RotateCcw, label: 'Credit Memos', path: '/credit-memos' },
      { icon: Users, label: 'Customers', path: '/customers' },
      { icon: Package, label: 'Items', path: '/items' },
      { icon: BadgePercent, label: 'Sales Reps', path: '/sales-reps' },
    ],
  },
  {
    heading: 'Purchases',
    links: [
      { icon: ShoppingCart, label: 'Purchase Orders', path: '/purchase-orders' },
      { icon: Receipt, label: 'Bills', path: '/bills' },
      { icon: RotateCcw, label: 'Vendor Credits', path: '/vendor-credits' },
      { icon: Printer, label: 'Print Checks', path: '/print-checks' },
      { icon: Truck, label: 'Vendors', path: '/vendors' },
    ],
  },
  {
    heading: 'Banking',
    links: [
      { icon: CreditCard, label: 'Banking', path: '/banking' },
      { icon: Rss, label: 'Bank Feeds', path: '/bank-feeds' },
      { icon: ListChecks, label: 'Bank Review', path: '/bank-review' },
      { icon: PiggyBank, label: 'Deposits', path: '/deposits' },
      { icon: Banknote, label: 'Reconcile', path: '/reconcile' },
      { icon: ArrowLeftRight, label: 'Transfers', path: '/transfers' },
    ],
  },
  {
    heading: 'Accounting',
    links: [
      { icon: NotebookPen, label: 'Journal', path: '/journal' },
      { icon: BookOpen, label: 'Chart of Accounts', path: '/accounts' },
      { icon: Landmark, label: 'Pay Liabilities', path: '/pay-liabilities' },
      { icon: UserSquare, label: 'Payroll', path: '/employees' },
      { icon: FileSpreadsheet, label: 'Pay Stubs', path: '/pay-stubs' },
      { icon: ClipboardList, label: 'Payroll Forms', path: '/payroll-forms' },
      { icon: Calculator, label: 'Payroll Tax', path: '/payroll-tax' },
      { icon: Tag, label: 'Tracking', path: '/tracking' },
      { icon: Percent, label: 'Tax Components', path: '/sales-tax-components' },
      { icon: Repeat, label: 'Recurring', path: '/recurring' },
      { icon: Coins, label: 'Currencies', path: '/currencies' },
      { icon: CalendarClock, label: 'Year-End Close', path: '/year-end' },
    ],
  },
  {
    heading: 'Insights',
    links: [
      { icon: BarChart2, label: 'Reports', path: '/reports' },
      { icon: Wrench, label: 'Report Builder', path: '/reports/builder' },
      { icon: Wallet, label: 'P&L (Cash Basis)', path: '/reports/profit-loss-cash' },
      { icon: GitCompareArrows, label: 'P&L Comparative', path: '/reports/pl-comparative' },
      { icon: CalendarRange, label: 'P&L by Month', path: '/reports/pl-monthly' },
      { icon: Scale, label: 'Balance Sheet (Cash)', path: '/reports/balance-sheet-cash' },
      { icon: Tag, label: 'P&L by Class', path: '/reports/pl-by-class' },
      { icon: Network, label: 'Consolidated', path: '/reports/consolidated' },
      { icon: AlertTriangle, label: 'AI Review', path: '/errors' },
    ],
  },
  {
    heading: 'Admin',
    links: [
      { icon: FileClock, label: 'Audit Trail', path: '/audit-trail' },
      { icon: Paperclip, label: 'Attachments', path: '/attachments' },
      { icon: BadgeCheck, label: 'Data Integrity', path: '/integrity' },
      { icon: GitMerge, label: 'Merge Records', path: '/merge' },
      { icon: FileX, label: '1099 E-File', path: '/reports/1099-efile' },
      { icon: Clock, label: 'Estimate Follow-up', path: '/estimates-followup' },
    ],
  },
  {
    heading: 'Operations',
    links: [
      { icon: BriefcaseIcon, label: 'Jobs', path: '/jobs' },
      { icon: Timer, label: 'Time Tracking', path: '/time-tracking' },
      { icon: Car, label: 'Mileage', path: '/mileage' },
      { icon: Boxes, label: 'Fixed Assets', path: '/fixed-assets' },
      { icon: Combine, label: 'Assemblies', path: '/assemblies' },
      { icon: PackageSearch, label: 'Inventory Ops', path: '/inventory-ops' },
      { icon: Layers, label: 'FIFO Inventory', path: '/fifo' },
      { icon: HandCoins, label: 'Customer Pricing', path: '/customer-pricing' },
      { icon: FileSpreadsheet, label: 'Expense Reports', path: '/expense-reports' },
    ],
  },
  {
    heading: 'Setup',
    links: [
      { icon: Building2, label: 'Companies', path: '/companies' },
      { icon: ShieldCheck, label: 'Security (2FA)', path: '/security' },
      { icon: Settings, label: 'Settings', path: '/settings' },
    ],
  },
];

// Routes that render without the app chrome (full-screen).
const BARE = ['/login', '/signup', '/onboarding', '/reset-password', '/portal'];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const bare = BARE.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (bare) return <>{children}</>;

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  }

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100">
      <aside className="w-20 lg:w-60 bg-white shadow-xl z-10 flex flex-col items-center py-8 px-2 lg:px-0 border-r-[1.5px] border-slate-100">
        <div className="flex flex-col items-center gap-3 mb-10">
          <div className="rounded-xl bg-navy h-12 w-12 flex items-center justify-center shadow-md">
            <Briefcase className="text-gold h-6 w-6" />
          </div>
          <h1 className="text-navy font-extrabold text-2xl tracking-tight leading-tight hidden lg:block">
            BookKeeper AI
          </h1>
        </div>
        <nav className="flex flex-col gap-0.5 w-full flex-1 overflow-y-auto pr-1">
          {navGroups.map((group) => (
            <div key={group.heading || 'home'} className="mb-1">
              {group.heading && (
                <div className="hidden lg:block px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-navy/30">
                  {group.heading}
                </div>
              )}
              {group.links.map((nav) => {
                const Icon = nav.icon;
                const active = pathname === nav.path || pathname.startsWith(nav.path + '/');
                return (
                  <a
                    key={nav.label}
                    href={nav.path}
                    className={`flex items-center gap-3 font-medium px-3 py-2 rounded-lg transition-all cursor-pointer outline-none focus:ring-2 focus:ring-electric ${
                      active ? 'bg-electric/10 text-electric' : 'text-navy/80 hover:text-electric hover:bg-electric/5'
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="hidden lg:inline-block text-sm">{nav.label}</span>
                  </a>
                );
              })}
            </div>
          ))}
        </nav>
        <button
          onClick={logout}
          className="mt-4 flex items-center gap-4 text-navy/60 hover:text-red-500 font-medium px-3 py-2.5 rounded-lg w-full transition-colors"
        >
          <LogOut className="h-5 w-5 shrink-0" />
          <span className="hidden lg:inline-block text-sm">Sign out</span>
        </button>
      </aside>
      <main className="flex-1 flex flex-col">{children}</main>
      <CommandPalette />
    </div>
  );
}
