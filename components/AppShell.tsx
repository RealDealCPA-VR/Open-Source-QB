'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import CommandPalette from './CommandPalette';
import { navGroups } from '@/lib/nav';
import { Briefcase, LogOut } from 'lucide-react';

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
      <aside className="w-20 lg:w-60 sticky top-0 h-screen bg-white shadow-xl z-10 flex flex-col py-6 px-2 lg:px-3 border-r border-slate-100">
        <div className="flex flex-col items-center gap-3 mb-8 shrink-0">
          <div className="rounded-xl bg-navy h-12 w-12 flex items-center justify-center shadow-md">
            <Briefcase className="text-gold h-6 w-6" />
          </div>
          <h1 className="text-navy font-extrabold text-2xl tracking-tight leading-tight hidden lg:block">
            BookKeeper AI
          </h1>
        </div>
        <nav className="flex flex-col gap-0.5 w-full flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 -mr-1">
          {navGroups.map((group) => (
            <div key={group.heading || 'home'} className="mb-2">
              {group.heading && (
                <>
                  <div className="hidden lg:block px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-navy/30">
                    {group.heading}
                  </div>
                  {/* Collapsed mode: divider stands in for the group heading. */}
                  <div className="lg:hidden mx-2 my-2 border-t border-slate-100" aria-hidden="true" />
                </>
              )}
              {group.links.map((nav) => {
                const Icon = nav.icon;
                const active = pathname === nav.path || pathname.startsWith(nav.path + '/');
                return (
                  <Link
                    key={nav.label}
                    href={nav.path}
                    prefetch={false}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center justify-center lg:justify-start gap-3 px-2 lg:px-3 py-2 rounded-lg transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-electric/50 ${
                      active
                        ? 'bg-electric/10 text-electric font-semibold shadow-[inset_3px_0_0_0_theme(colors.electric)]'
                        : 'text-navy/80 font-medium hover:text-electric hover:bg-electric/5'
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span className="hidden lg:inline-block text-sm">{nav.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="shrink-0 pt-3 mt-1 border-t border-slate-100">
          <button
            onClick={logout}
            className="flex items-center justify-center lg:justify-start gap-3 text-navy/60 hover:text-red-500 hover:bg-red-50 font-medium px-2 lg:px-3 py-2 rounded-lg w-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-electric/50"
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" />
            <span className="hidden lg:inline-block text-sm">Sign out</span>
          </button>
          <div className="hidden lg:block px-3 pt-2 text-[10px] text-navy/30">
            BookKeeper AI v1.0.0
          </div>
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-w-0">{children}</main>
      <CommandPalette />
    </div>
  );
}
