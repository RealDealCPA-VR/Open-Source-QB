'use client';

import { AlertCircle } from 'lucide-react';
import AgingDetailReport from '../_components/AgingDetailReport';

export default function ApAgingDetailPage() {
  return (
    <AgingDetailReport
      title="A/P Aging Detail"
      endpoint="/api/reports/ap-aging-detail"
      entityLabel="Vendor"
      csvName="ap-aging-detail.csv"
      icon={AlertCircle}
    />
  );
}
