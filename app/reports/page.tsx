'use client';

import Link from 'next/link';
import {
  BarChart2,
  Scale,
  BookOpen,
  List,
  TrendingUp,
  Clock,
  AlertCircle,
  FileText,
  Receipt,
  Target,
} from 'lucide-react';
import { Card, PageHeader } from '@/components/ui';

// ---------------------------------------------------------------------------
// Report link card
// ---------------------------------------------------------------------------

interface ReportCardProps {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  name: string;
  description: string;
}

function ReportCard({ href, icon: Icon, name, description }: ReportCardProps) {
  return (
    <Link href={href} className="group focus:outline-none">
      <Card className="flex items-start gap-4 p-5 transition-all duration-150 hover:shadow-2xl hover:border-electric/40 group-focus:ring-2 group-focus:ring-electric/40 cursor-pointer h-full">
        <div className="flex-shrink-0 rounded-xl bg-electric/10 p-2.5 group-hover:bg-electric/20 transition-colors">
          <Icon className="h-5 w-5 text-electric" />
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-navy text-sm leading-snug mb-0.5 group-hover:text-electric transition-colors">
            {name}
          </p>
          <p className="text-xs text-navy/50 leading-snug">{description}</p>
        </div>
      </Card>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-bold uppercase tracking-widest text-navy/40 mb-3 mt-8 first:mt-0">
      {children}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// Report definitions
// ---------------------------------------------------------------------------

const FINANCIAL_REPORTS: ReportCardProps[] = [
  {
    href: '/reports/profit-loss',
    icon: BarChart2,
    name: 'Profit & Loss',
    description: 'Revenue, expenses, and net income over a date range.',
  },
  {
    href: '/reports/balance-sheet',
    icon: Scale,
    name: 'Balance Sheet',
    description: 'Assets, liabilities, and equity as of a point in time.',
  },
  {
    href: '/reports/trial-balance',
    icon: BookOpen,
    name: 'Trial Balance',
    description: 'All account debit and credit balances for a period.',
  },
  {
    href: '/reports/general-ledger',
    icon: List,
    name: 'General Ledger',
    description: 'Every posted transaction entry across all accounts.',
  },
  {
    href: '/reports/cash-flow',
    icon: TrendingUp,
    name: 'Cash Flow',
    description: 'Operating, investing, and financing cash movements.',
  },
];

const RECEIVABLES_PAYABLES_REPORTS: ReportCardProps[] = [
  {
    href: '/reports/ar-aging',
    icon: Clock,
    name: 'A/R Aging',
    description: 'Outstanding customer balances bucketed by days past due.',
  },
  {
    href: '/reports/ap-aging',
    icon: AlertCircle,
    name: 'A/P Aging',
    description: 'Vendor bills owed, bucketed by days past due.',
  },
  {
    href: '/reports/statements',
    icon: FileText,
    name: 'Customer Statements',
    description: 'Per-customer invoice and payment history statements.',
  },
  {
    href: '/reports/1099',
    icon: Receipt,
    name: '1099 Summary',
    description: 'Annual vendor payments for 1099-NEC / 1099-MISC filing.',
  },
];

const PLANNING_REPORTS: ReportCardProps[] = [
  {
    href: '/budgets',
    icon: Target,
    name: 'Budget vs Actual',
    description: 'Compare planned budgets against real income and expenses.',
  },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader title="Reports" icon={BarChart2} />

      <SectionHeading>Financial</SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {FINANCIAL_REPORTS.map((r) => (
          <ReportCard key={r.href} {...r} />
        ))}
      </div>

      <SectionHeading>Receivables / Payables</SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {RECEIVABLES_PAYABLES_REPORTS.map((r) => (
          <ReportCard key={r.href} {...r} />
        ))}
      </div>

      <SectionHeading>Planning</SectionHeading>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PLANNING_REPORTS.map((r) => (
          <ReportCard key={r.href} {...r} />
        ))}
      </div>
    </main>
  );
}
