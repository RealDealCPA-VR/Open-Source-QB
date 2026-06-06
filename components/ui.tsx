'use client';
/**
 * Shared UI kit for BookKeeper AI. Lightweight Tailwind primitives matching the brand palette
 * (navy / electric / emerald / gold / offwhite). Import from '@/components/ui'.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

// ---- Button ----
type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};
export function Button({ className, variant = 'primary', size = 'md', ...props }: ButtonProps) {
  const variants = {
    primary: 'bg-electric text-white hover:bg-electric/90 shadow-sm',
    secondary: 'bg-white text-navy border border-slate-200 hover:bg-slate-50',
    ghost: 'text-navy hover:bg-navy/5',
    danger: 'bg-red-500 text-white hover:bg-red-600',
  };
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' };
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none outline-none focus:ring-2 focus:ring-electric/40',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

// ---- Card ----
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-2xl bg-white shadow-xl border border-slate-100', className)}
      {...props}
    />
  );
}

// ---- Inputs ----
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy outline-none focus:border-electric focus:ring-2 focus:ring-electric/30 placeholder:text-navy/30',
          className,
        )}
        {...props}
      />
    );
  },
);

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-navy bg-white outline-none focus:border-electric focus:ring-2 focus:ring-electric/30',
        className,
      )}
      {...props}
    />
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('block text-sm font-medium text-navy/70 mb-1', className)} {...props} />;
}

// ---- Badge ----
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-600',
    success: 'bg-emerald/15 text-emerald',
    warning: 'bg-gold/20 text-gold',
    danger: 'bg-red-100 text-red-600',
    info: 'bg-electric/10 text-electric',
  };
  return (
    <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-semibold', tones[tone])}>
      {children}
    </span>
  );
}

// ---- Table primitives ----
export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">{children}</table>
    </div>
  );
}
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn('py-2.5 px-4 text-left font-semibold text-navy/70 text-sm border-b-2 border-navy/10', className)}
      {...props}
    />
  );
}
export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('py-2.5 px-4 text-navy border-b border-slate-100', className)} {...props} />;
}
export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('hover:bg-electric/5', className)} {...props} />;
}

// ---- Modal ----
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy/40 backdrop-blur-sm" onClick={onClose} />
      <Card className="relative z-10 w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-navy">{title}</h2>
          <button onClick={onClose} className="text-navy/40 hover:text-navy text-2xl leading-none">
            &times;
          </button>
        </div>
        {children}
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </Card>
    </div>
  );
}

// ---- Page header ----
export function PageHeader({
  title,
  icon: Icon,
  action,
}: {
  title: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-6">
      <h1 className="text-3xl font-extrabold text-navy flex items-center gap-3">
        {Icon && <Icon className="text-electric h-8 w-8" />}
        {title}
      </h1>
      {action}
    </div>
  );
}

// ---- Toast (minimal, event-based) ----
type Toast = { id: number; message: string; tone: 'success' | 'danger' | 'info' };
let pushToastFn: ((t: Omit<Toast, 'id'>) => void) | null = null;
export function toast(message: string, tone: Toast['tone'] = 'info') {
  pushToastFn?.({ message, tone });
}
export function Toaster() {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  React.useEffect(() => {
    let n = 0;
    pushToastFn = (t) => {
      const id = ++n;
      setToasts((prev) => [...prev, { ...t, id }]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4000);
    };
    return () => {
      pushToastFn = null;
    };
  }, []);
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'rounded-lg px-4 py-3 text-sm font-medium shadow-lg text-white',
            t.tone === 'success' ? 'bg-emerald' : t.tone === 'danger' ? 'bg-red-500' : 'bg-navy',
          )}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
