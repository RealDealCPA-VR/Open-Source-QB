/**
 * Fiscal year-to-date window used by the dashboard KPI cards.
 *
 * `fiscalYearEnd` is the company's "MM-DD" setting (companies.settings.fiscalYearEnd).
 * The YTD window starts the day after the most recent fiscal year end strictly before
 * `now` (date-only), and runs through `now`. Falls back to Jan 1 of the current calendar
 * year when the setting is missing or malformed.
 */
export function ytdRange(fiscalYearEnd: string | undefined | null, now: Date = new Date()): { from: Date; to: Date } {
  let from = new Date(now.getFullYear(), 0, 1);
  const m = /^(\d{2})-(\d{2})$/.exec(fiscalYearEnd ?? '');
  if (m) {
    const month = Number(m[1]) - 1;
    const day = Number(m[2]);
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      // Most recent fiscal year end strictly before today (a year ending today is still open).
      let end = new Date(now.getFullYear(), month, day);
      if (end >= today) end = new Date(now.getFullYear() - 1, month, day);
      from = new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1);
    }
  }
  return { from, to: now };
}
