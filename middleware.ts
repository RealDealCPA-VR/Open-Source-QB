import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Route protection. Edge-safe: only checks for the presence of the session cookie (signature is
 * verified in the Node runtime by lib/auth). Unauthenticated page requests are redirected to /login.
 * API routes are not gated here (the UI always carries the cookie; full checks live server-side).
 */
const PUBLIC_PREFIXES = ['/login', '/signup', '/onboarding', '/reset-password'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Employee self-service portal has its own session (bka_portal).
  if (pathname === '/portal/login') return NextResponse.next();
  if (pathname === '/portal' || pathname.startsWith('/portal/')) {
    if (!req.cookies.get('bka_portal')) {
      const url = req.nextUrl.clone();
      url.pathname = '/portal/login';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (
    pathname === '/' ||
    PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
  ) {
    return NextResponse.next();
  }

  if (!req.cookies.get('bka_session')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Run on page routes only — exclude API, Next internals, and static assets.
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
