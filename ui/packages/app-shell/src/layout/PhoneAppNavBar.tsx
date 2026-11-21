/**
 * PhoneAppNavBar
 *
 * The phone's bottom bar inside an app (objectstack#35882). Three fixed cells,
 * Home, Notifications and Approvals, and a round search button beside them.
 * They do not change with the app and the user does not configure them: the
 * app's menu is the app's home page (objectstack#35881), so the bar no longer
 * holds menu entries, a 「More」 cell or the stars that pinned entries to it
 * (objectstack#34594, superseded; pins already stored are simply not read).
 *
 * - Home opens the current app's home, its whole menu (`/apps/SEGMENT`).
 * - Notifications opens the full-page inbox the bell's 「View all」 opens
 *   (`sys_inbox_message?view=mine`), and Approvals the approvals inbox
 *   (`system/approvals`), both hosted under the app the bell hosts them under
 *   (`resolveHostAppSegment`), so the two doors cannot lead to two pages.
 * - Search opens the console's command palette, as the top bar's search does.
 *
 * The badges are the bell's two addends (`useInboxBell`, the one wiring of the
 * shared feeds): unread notification topics on Notifications, pending
 * approvals on Approvals. Each sits inside its cell, on the glyph's corner, so
 * the bar's edge cannot cut it (objectstack#34596).
 *
 * The console layout mounts the bar on the three pages it opens and nowhere
 * else (`isPhoneTabRoute`): a list, a record, a form or any other page one
 * level down has the page to itself, and 「‹」 at the top left goes back.
 *
 * @module
 */

import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, CheckSquare, Home, Search } from 'lucide-react';
import { cn } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useInboxBell } from '../hooks/useInboxBell.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useCommandPalette } from '../context/CommandPaletteProvider.js';
import { groupNotifications } from './inboxGrouping.js';
import { resolveHostAppSegment } from '../utils/appRoute.js';

/** Which of the three cells a path opens, or `null` for any other page. */
export type PhoneTab = 'home' | 'notifications' | 'approvals';

/**
 * The cell `pathname` is the page of: the app's root (its home), the inbox
 * list, or the approvals inbox. `null` for every other route, where the bar is
 * not drawn.
 */
export function phoneTabOf(pathname: string): PhoneTab | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'apps' || !parts[1]) return null;
  if (parts.length === 2) return 'home';
  if (parts.length === 3 && parts[2] === 'sys_inbox_message') return 'notifications';
  if (parts.length === 4 && parts[2] === 'system' && parts[3] === 'approvals') return 'approvals';
  return null;
}

/** Is `pathname` one of the three pages the phone's bottom bar opens? */
export function isPhoneTabRoute(pathname: string): boolean {
  return phoneTabOf(pathname) !== null;
}

export interface PhoneAppNavBarProps {
  /** The app's address, `/apps/SEGMENT`: where Home goes. */
  basePath: string;
  /** The app's `name` (what `ConsoleLayout` publishes), for the inboxes' host. */
  activeAppName: string;
}

/** One cell's box: a 44 px-tall target, icon over label. */
const CELL_CLASS =
  'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] leading-tight transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

const BADGE_CLASS =
  'absolute top-0.5 left-1/2 ml-1.5 h-4 min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[10px] leading-4 text-white';

export function PhoneAppNavBar({ basePath, activeAppName }: PhoneAppNavBarProps) {
  const location = useLocation();
  const { t } = useObjectTranslation();
  const { apps } = useMetadata();
  const { openCommandPalette } = useCommandPalette();
  const { notifications, pendingApprovalsCount } = useInboxBell();
  // The bell's own count: unread TOPICS, not raw rows (#2765).
  const unreadTopics = useMemo(
    () => groupNotifications(notifications).reduce((sum, g) => sum + (g.unreadCount > 0 ? 1 : 0), 0),
    [notifications],
  );
  const host = resolveHostAppSegment(apps, activeAppName);
  const current = phoneTabOf(location.pathname);

  const cells: Array<{ tab: PhoneTab; to: string; label: string; Icon: typeof Home; badge: number }> = [
    { tab: 'home', to: basePath, label: t('console.nav.phoneHome', { defaultValue: 'Home' }), Icon: Home, badge: 0 },
    {
      tab: 'notifications',
      // `?view=mine`: the user-scoped view, the bell's 「View all」 target.
      to: `/apps/${host}/sys_inbox_message?view=mine`,
      label: t('console.nav.phoneNotifications', { defaultValue: 'Notifications' }),
      Icon: Bell,
      badge: unreadTopics,
    },
    {
      tab: 'approvals',
      to: `/apps/${host}/system/approvals`,
      label: t('console.nav.phoneApprovals', { defaultValue: 'Approvals' }),
      Icon: CheckSquare,
      badge: pendingApprovalsCount,
    },
  ];
  const searchLabel = t('console.nav.phoneSearch', { defaultValue: 'Search' });

  return (
    <nav
      data-testid="phone-app-nav-bar"
      aria-label={t('console.nav.phoneBarLabel', { defaultValue: 'App menu bar' })}
      className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t bg-background/95 px-2 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] backdrop-blur-sm"
    >
      <ul className="flex h-12 min-w-0 flex-1 items-stretch">
        {cells.map(({ tab, to, label, Icon, badge }) => {
          const active = current === tab;
          return (
            <li key={tab} className="flex min-w-0 flex-1">
              <Link
                to={to}
                aria-current={active ? 'page' : undefined}
                data-testid="phone-app-nav-cell"
                data-tab={tab}
                className={cn(CELL_CLASS, active ? 'text-primary' : 'text-muted-foreground')}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden />
                <span className="max-w-full truncate">{label}</span>
                {badge > 0 && (
                  <span data-testid="phone-app-nav-badge" className={BADGE_CLASS}>
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={openCommandPalette}
        aria-label={searchLabel}
        title={searchLabel}
        data-testid="phone-app-nav-search"
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border bg-muted/60 text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="h-5 w-5" aria-hidden />
      </button>
    </nav>
  );
}
