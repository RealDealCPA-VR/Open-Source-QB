'use client';

import { Clock } from 'lucide-react';
import AgingDetailReport from '../_components/AgingDetailReport';

export default function ArAgingDetailPage() {
  return (
    <AgingDetailReport
      title="A/R Aging Detail"
      endpoint="/api/reports/ar-aging-detail"
      entityLabel="Customer"
      csvName="ar-aging-detail.csv"
      icon={Clock}
    />
  );
}
