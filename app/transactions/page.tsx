import { TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { Badge, Button, Card, EmptyState, PageHeader, Table, Td, Th, Tr, type BadgeTone } from '@/components/ui';
import { getServerContext } from '@/lib/context';
import { listEntries } from '@/lib/services/journal';
import { formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, BadgeTone> = {
  posted: 'success',
  draft: 'warning',
  void: 'void',
};

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default async function TransactionsPage() {
  const ctx = await getServerContext();
  const entries = await listEntries(ctx, { limit: 200 });

  return (
    <main className="min-h-screen bg-gradient-to-br from-offwhite via-[#e8ecf3] to-slate-100 p-8 font-sans">
      <PageHeader
        title="Transactions"
        icon={TrendingUp}
        action={
          <Link href="/journal">
            <Button>New Journal Entry</Button>
          </Link>
        }
      />
      <Card className="p-6">
        {entries.length === 0 ? (
          <EmptyState
            icon={TrendingUp}
            title="No transactions yet"
            message="Create invoices, bills, payments, or journal entries to get started."
            action={
              <Link href="/journal">
                <Button>Add Journal Entry</Button>
              </Link>
            }
          />
        ) : (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Date</Th>
                  <Th>Description</Th>
                  <Th>Reference</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <Tr key={e.id}>
                    <Td className="text-navy/60 tabular-nums">{e.entryNumber}</Td>
                    <Td className="whitespace-nowrap">{formatDate(e.date)}</Td>
                    <Td>{e.description}</Td>
                    <Td className="text-navy/60">{e.reference ?? ''}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[e.status] ?? 'neutral'}>{statusLabel(e.status)}</Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <div className="mt-4 text-sm text-navy/40">
              Showing the {Math.min(entries.length, 200)} most recent entries.{' '}
              <Link href="/journal" className="text-electric hover:underline">
                Add a journal entry →
              </Link>
            </div>
          </>
        )}
      </Card>
    </main>
  );
}
