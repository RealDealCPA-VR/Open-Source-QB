/**
 * Root route. The Electron shell loads the bare server URL, so '/' must route users to the
 * real app: /dashboard when a session cookie is present, /login otherwise. (The cookie's
 * signature is verified server-side as usual — this only picks the landing page.)
 */
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const store = await cookies();
  redirect(store.get('bka_session') ? '/dashboard' : '/login');
}
