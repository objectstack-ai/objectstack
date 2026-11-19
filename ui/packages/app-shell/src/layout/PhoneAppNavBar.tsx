/**
 * PhoneAppNavBar
 *
 * The phone's bottom menu bar inside an app (objectstack#34594). Below 768 px
 * the app's menu lived only in the sidebar drawer, behind an unlabeled icon at
 * the top left, and many users never found it. The bar keeps the menu on
 * screen: up to four of the app's entries, then 「More」, which opens the full
 * menu (the drawer) where every entry carries a star.
 *
 * Which four: the entries the user pinned (the star, `useNavPins`, the same
 * per-user store the desktop sidebar's Favorites section reads), in the
 * user's pinned order, then the app's own entries in menu order to fill the
 * rest. Pins are stored by navigation id and are not scoped per app, so only
 * the pins this app's menu holds are read here. No metadata key is involved.
 *
 * What it draws is what the drawer draws: the tree it is handed is the
 * sidebar's own (already pruned of entries the member may not read), walked by
 * `drawnNavigationEntries`, the sidebar's guard statement and order rule.
 * A cell opens what its drawer row opens (`resolveHref`), and lights when
 * that row lights (`resolveActiveNavItem`). When the row that lights is drawn
 * in the full menu but holds no cell, 「More」 lights in its place
 * (objectstack#35020): one cell at most is lit, and it is the way back to the
 * page in view.
 *
 * The console layout decides where the bar is mounted: on a phone, inside an
 * app, never on a record page or a record form, whose bottom edge belongs to
 * the record's own action bar and submit buttons.
 *
 * @module
 */

import { Link, useLocation } from 'react-router-dom';
import { MoreHorizontal, Star } from 'lucide-react';
import { SidebarMenuAction, cn } from '@object-ui/components';
import {
  drawnNavigationEntries,
  resolveActiveNavItem,
  resolveHref,
  resolveIcon,
  resolveNavItemIcon,
  resolveNavItemLabel,
  type NavigationVisibilityOptions,
  type NavTargetIconResolver,
  type NavTargetLabelResolver,
  type NavTemplateContext,
} from '@object-ui/layout';
import type { NavigationItem } from '@object-ui/types';

/** How many of the app's entries the bar holds; 「More」 is the cell after them. */
export const PHONE_NAV_BAR_ENTRY_CELLS = 4;

/**
 * The bar's entries: the app's pinned entries in the user's pinned order,
 * then the app's drawn entries in menu order, to at most `cells` entries. A
 * pinned id this app's menu does not draw (another app's pin, or an entry the
 * member cannot see) takes no cell.
 */
export function phoneNavBarEntries(
  items: readonly NavigationItem[],
  pinnedIds: readonly string[],
  guards: NavigationVisibilityOptions,
  hasAddress: (item: NavigationItem) => boolean,
  cells: number = PHONE_NAV_BAR_ENTRY_CELLS,
): NavigationItem[] {
  // The drawer's rows in its reading order (the walk every tab bar shares),
  // less `action` entries (an action runs something; a cell opens a page) and
  // entries whose target resolves to no address.
  const entries: NavigationItem[] = drawnNavigationEntries(items, guards).filter(
    (entry) => entry.type !== 'action' && hasAddress(entry),
  );
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const chosen: NavigationItem[] = [];
  const taken = new Set<string>();
  for (const id of pinnedIds) {
    const entry = byId.get(id);
    if (!entry || taken.has(id)) continue;
    chosen.push(entry);
    taken.add(id);
    if (chosen.length === cells) return chosen;
  }
  for (const entry of entries) {
    if (taken.has(entry.id)) continue;
    chosen.push(entry);
    taken.add(entry.id);
    if (chosen.length === cells) break;
  }
  return chosen;
}

export interface PhoneAppNavBarProps {
  /** The app's navigation tree, as the sidebar holds it (pruned, every visible area). */
  items: NavigationItem[];
  /** The pinned navigation ids, in the user's order (`useNavPins().pinnedIds`). */
  pinnedIds: readonly string[];
  /** The app's address, `/apps/SEGMENT`. */
  basePath: string;
  /** The sidebar's guard inputs. */
  guards: NavigationVisibilityOptions;
  templateContext?: NavTemplateContext;
  resolveTargetLabel?: NavTargetLabelResolver;
  resolveTargetIcon?: NavTargetIconResolver;
  locale?: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  /** Whether the full menu is open, so 「More」 reads as the current cell. */
  menuOpen: boolean;
  /** Opens the full menu (the drawer). */
  onOpenMenu: () => void;
}

/** One cell's box: a 44 px-tall target, icon over label. */
const CELL_CLASS =
  'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] leading-tight transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

export function PhoneAppNavBar({
  items,
  pinnedIds,
  basePath,
  guards,
  templateContext,
  resolveTargetLabel,
  resolveTargetIcon,
  locale,
  t,
  menuOpen,
  onOpenMenu,
}: PhoneAppNavBarProps) {
  const location = useLocation();
  const hasAddress = (item: NavigationItem) => {
    const { href } = resolveHref(item, basePath, templateContext);
    return !!href && href !== '#';
  };
  const entries = phoneNavBarEntries(items, pinnedIds, guards, hasAddress);
  // The row the drawer lights, elected over the whole tree as the drawer
  // elects it, so at most one cell lights and it is that row.
  const currentId =
    resolveActiveNavItem(items, location.pathname, location.search, basePath, templateContext)?.id ?? null;
  const activeId = menuOpen ? null : currentId;
  // A row the full menu draws but no cell holds lights 「More」, the cell that
  // opens it. A page no drawn row addresses lights nothing: 「More」 lit says
  // the menu behind it has the page's row selected. While the menu is open,
  // 「More」 is lit for the open menu and the bar marks no page.
  const currentBehindMore =
    currentId !== null &&
    !entries.some((entry) => entry.id === currentId) &&
    drawnNavigationEntries(items, guards).some((entry) => entry.id === currentId);
  const moreMarksPage = !menuOpen && currentBehindMore;
  const moreLabel = t('common.more', { defaultValue: 'More' });

  return (
    <nav
      data-testid="phone-app-nav-bar"
      aria-label={t('console.nav.phoneBarLabel', { defaultValue: 'App menu bar' })}
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
    >
      <ul className="flex h-12 items-stretch">
        {entries.map((item) => {
          const { href, external } = resolveHref(item, basePath, templateContext);
          const label = resolveNavItemLabel(item, t, resolveTargetLabel, locale);
          const Icon = resolveIcon(resolveNavItemIcon(item, resolveTargetIcon));
          const active = item.id === activeId;
          const className = cn(CELL_CLASS, active ? 'text-primary' : 'text-muted-foreground');
          const content = (
            <>
              <Icon className="h-5 w-5 shrink-0" aria-hidden />
              <span className="max-w-full truncate">{label}</span>
            </>
          );
          return (
            <li key={item.id} className="flex min-w-0 flex-1">
              {external ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className={className} data-testid="phone-app-nav-cell">
                  {content}
                </a>
              ) : (
                <Link
                  to={href}
                  className={className}
                  aria-current={active ? 'page' : undefined}
                  data-testid="phone-app-nav-cell"
                  data-nav-id={item.id}
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
        <li className="flex min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpenMenu}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            // `true`, not `page`: the button is where the page in view lives,
            // not a link to it.
            aria-current={moreMarksPage ? 'true' : undefined}
            data-testid="phone-app-nav-more"
            className={cn(CELL_CLASS, menuOpen || moreMarksPage ? 'text-primary' : 'text-muted-foreground')}
          >
            <MoreHorizontal className="h-5 w-5 shrink-0" aria-hidden />
            <span className="max-w-full truncate">{moreLabel}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

export interface PhoneMenuStarProps {
  /** The text the row shows. */
  label: string;
  /** The entry is pinned (it is offered to the bottom bar). */
  pinned: boolean;
  onToggle: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

/**
 * The star a full-menu row carries on a phone (objectstack#34594): one tap
 * pins the entry, through the same pin store the desktop sidebar's ⋯ menu
 * writes, so it joins the bottom bar; another tap unpins it. Drawn at rest,
 * not on hover (a phone has none), centred on the 44 px row.
 */
export function PhoneMenuStar({ label, pinned, onToggle, t }: PhoneMenuStarProps) {
  const name = pinned
    ? t('console.nav.unpinItem', { defaultValue: 'Unpin {{name}}', name: label })
    : t('console.nav.pinItem', { defaultValue: 'Pin {{name}}', name: label });
  return (
    <SidebarMenuAction
      onClick={onToggle}
      aria-pressed={pinned}
      aria-label={name}
      title={name}
      data-testid="phone-menu-star"
      data-pinned={pinned ? 'true' : 'false'}
      className="right-1 top-1/2 size-8 -translate-y-1/2 peer-data-[size=default]/menu-button:top-1/2 [&>svg]:size-5"
    >
      <Star className={pinned ? 'fill-primary text-primary' : 'text-muted-foreground'} aria-hidden />
    </SidebarMenuAction>
  );
}
