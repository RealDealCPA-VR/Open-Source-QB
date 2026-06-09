/**
 * Reports section layout — exists solely to attach the print stylesheet to
 * every report page (window.print() support without touching globals.css).
 */
import './print.css';

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
