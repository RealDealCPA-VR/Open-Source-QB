'use client';
/**
 * Renderer-side bridge for the Electron shell. Mounted once in app/layout.tsx; renders nothing.
 *
 * Subscribes to the main-process IPC channels exposed by electron/preload.js
 * (window.bookkeeper.onMenu / onNavigate) so the native application menu actually works:
 *  - Reports submenu        -> client-side navigation to the report page
 *  - File > Import Bank File -> /banking (import flow lives there)
 *  - File > Backup Company   -> /backup
 *  - File > New/Open Company -> /companies (company management/switcher)
 *  - auto-updater 'update-ready' -> toast prompting a restart
 *
 * No-op in the browser (window.bookkeeper is absent outside Electron).
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui';

type Unsubscribe = (() => void) | void;
interface DesktopBridgeApi {
  isDesktop?: boolean;
  onMenu?: (cb: (action: string) => void) => Unsubscribe;
  onNavigate?: (cb: (route: string) => void) => Unsubscribe;
}

const MENU_ROUTES: Record<string, string> = {
  import: '/banking',
  backup: '/backup',
  'new-company': '/companies',
  'open-company': '/companies',
};

export default function DesktopBridge() {
  const router = useRouter();

  useEffect(() => {
    const bridge = (window as unknown as { bookkeeper?: DesktopBridgeApi }).bookkeeper;
    if (!bridge?.isDesktop) return;

    const offMenu = bridge.onMenu?.((action) => {
      if (action === 'update-ready') {
        toast('Update downloaded — restart BookKeeper AI to apply it.', 'info');
        return;
      }
      const route = MENU_ROUTES[action];
      if (route) router.push(route);
    });
    const offNavigate = bridge.onNavigate?.((route) => {
      if (route) router.push(route);
    });

    return () => {
      if (typeof offMenu === 'function') offMenu();
      if (typeof offNavigate === 'function') offNavigate();
    };
  }, [router]);

  return null;
}
