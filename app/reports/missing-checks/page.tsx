'use client';

import Link from 'next/link';
import { SearchX } from 'lucide-react';
import SimpleReport from '../_components/SimpleReport';

interface MissingCheckRange {
  from: number;
  to: number;
  count: number;
}

interface MissingChecksAccountRow {
  accountId: string;
  accountName: string;
  firstNumber: number;
  lastNumber: number;
  checkCount: number;
  missing: MissingCheckRange[];
  missingCount: number;
}

interface MissingChecksData {
  accounts: MissingChecksAccountRow[];
}

function rangesLabel(missing: MissingCheckRange[]): string {
  if (missing.length === 0) return 'None — sequence complete';
  return missing.map((m) => (m.from === m.to ? `${m.from}` : `${m.from}–${m.to}`)).join(', ');
}

export default function MissingChecksPage() {
  return (
    <SimpleReport<MissingChecksData, MissingChecksAccountRow>
      title="Missing Checks"
      icon={SearchX}
      csvName="missing-checks.csv"
      emptyText="No numbered checks found (write checks or pay bills by check first)."
      controls="none"
      buildUrl={() => '/api/reports/missing-checks'}
      getRows={(d) => d.accounts}
      columns={[
        {
          header: 'Bank Account',
          cell: (r) => (
            <Link href={`/registers/${r.accountId}`} className="font-medium text-electric hover:underline">
              {r.accountName}
            </Link>
          ),
          csv: (r) => r.accountName,
        },
        {
          header: 'First #',
          className: 'text-right tabular-nums',
          cell: (r) => r.firstNumber,
          csv: (r) => r.firstNumber,
        },
        {
          header: 'Last #',
          className: 'text-right tabular-nums',
          cell: (r) => r.lastNumber,
          csv: (r) => r.lastNumber,
        },
        {
          header: 'Checks Found',
          className: 'text-right tabular-nums',
          cell: (r) => r.checkCount,
          csv: (r) => r.checkCount,
        },
        {
          header: 'Missing Count',
          className: 'text-right tabular-nums',
          cell: (r) =>
            r.missingCount > 0 ? (
              <span className="text-red-600 font-semibold">{r.missingCount}</span>
            ) : (
              <span className="text-emerald">0</span>
            ),
          csv: (r) => r.missingCount,
        },
        {
          header: 'Missing Numbers',
          cell: (r) => rangesLabel(r.missing),
          csv: (r) => rangesLabel(r.missing),
        },
      ]}
    />
  );
}
