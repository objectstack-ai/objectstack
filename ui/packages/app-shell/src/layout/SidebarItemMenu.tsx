// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SidebarItemMenu: the one ⋯ menu a sidebar entry shows on hover (objectui#12427).
 *
 * It takes the place of the per-entry hover pin icon. Its entries derive from
 * what the entry IS, its type and its target, never from a product (ADR-0060):
 *
 * 1. Add to favorites / Remove from favorites, always, first.
 * 2. Open in new tab and Copy link, for an entry that goes somewhere (an
 *    `action` entry runs something and has no address to open or copy).
 * 3. Design, for an entry whose target has a designer: it opens what the app
 *    bar's Edit app opens for that item, the item's Studio surface
 *    ({@link sidebarItemDesignPath}, objectui#12520). Shown on the rule the app
 *    bar's Edit app follows, `useStudioDesignGate` (objectui#12615): to a
 *    principal who may author metadata, for a package Studio lists as
 *    writable. A read-only package and the console's own system apps get no
 *    Design entry. The server refuses the write either way; this is the
 *    presentational half.
 *
 * The trigger is hover-revealed, as the pin icon it replaces was
 * (objectui#1055): nothing is permanently visible. A right-click anywhere on the
 * entry's row opens the same menu.
 *
 * One component for every entry type: the host hands it the entry's label,
 * address and favorite state, so a navigation entry and a favorite that has no
 * navigation entry (a record, say) show the same menu.
 *
 * @module
 */

import * as React from 'react';
import { useHref, useNavigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  SidebarMenuAction,
} from '@object-ui/components';
import { ExternalLink, Link2, MoreHorizontal, PencilRuler, Star, StarOff } from 'lucide-react';
import { toast } from 'sonner';
import type { NavigationItem } from '@object-ui/types';
import { useObjectTranslation } from '@object-ui/i18n';
import { useStudioDesignGate } from '../hooks/useStudioDesignGate.js';
import { useFavorites } from '../hooks/useFavorites.js';
import { useNavPins } from '../hooks/useNavPins.js';
import { useNavMemberGates, navEntriesShownToMember } from '../hooks/useNavMemberGates.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { matchAppBySegment } from '../utils/index.js';
import { appStudioRoutePath } from '../utils/appRoute.js';
import { confirmUnsavedLeave } from '../chrome/unsavedEdits.js';

/**
 * The route an entry of a designable type opens, in the shape the app bar reads
 * a route in: `type` is the first segment after `/apps/<app>/`, `name` the
 * second. An object's list is `/apps/<app>/<object>`, so its first segment IS
 * the object's name; a dashboard is `/apps/<app>/dashboard/<name>` and a page
 * `/apps/<app>/page/<name>`. Any other type, and an entry naming no target, has
 * no designer here: `null`.
 */
function designableRoute(
  type: string,
  name: string | undefined,
): { type: string; name?: string } | null {
  if (!name) return null;
  if (type === 'object') return { type: name };
  if (type === 'dashboard' || type === 'page') return { type, name };
  return null;
}

/**
 * Where Design takes an item of `app`: the path the app bar's Edit app opens on
 * the item's own route, through the one derivation both controls share,
 * `appStudioRoutePath` (objectui#12520). An `object` opens Studio's Data
 * surface (`surface=object:NAME`), a `dashboard` or a `page` its Interfaces
 * surface (`surface=dashboard:NAME`, `surface=page:NAME`). `null` when the app
 * has no owning package Studio can open, so the entry hides as the app bar's
 * pencil does; there is no other destination to fall back to.
 *
 * The gate is not read here: `SidebarItemMenu` reads it where the entry is
 * drawn (`useStudioDesignGate`, the app bar's), so this answers for a principal
 * and a package that pass it.
 */
function studioDesignPath(
  app: NavApp | null | undefined,
  type: string,
  name: string | undefined,
): string | null {
  const route = designableRoute(type, name);
  if (!route) return null;
  return appStudioRoutePath(app, true, route);
}

/**
 * The designer of what a navigation entry opens, in the app whose navigation
 * draws it ({@link studioDesignPath}), or `null` when the entry's type has no
 * designer: only `object`, `dashboard` and `page` entries have one. Every other
 * type (`url`, `component`, `separator`, `group`, `action`, and the types
 * objectui#12427 left undecided) has none.
 */
export function sidebarItemDesignPath(
  item: NavigationItem,
  app: NavApp | null | undefined,
): string | null {
  const name =
    item.type === 'object'
      ? item.objectName
      : item.type === 'dashboard'
        ? item.dashboardName
        : item.type === 'page'
          ? item.pageName
          : undefined;
  return studioDesignPath(app, item.type, name);
}

/**
 * The designer of a favorite that is not a navigation entry, read from its id
 * (`object:NAME`, `dashboard:NAME`, `page:NAME`), in the app the favorite opens:
 * the one its `href` names (`/apps/<app>/...`), which need not be the app the
 * sidebar is drawn in. Any other id (a record, a report, an app) has none. The
 * id, not the stored `type`, decides: an app favorite is stored with
 * `type: 'object'` and an `app:` id, and has no object to design. A favorite
 * whose `href` names no app in `apps` has none either.
 */
export function favoriteDesignPath(
  favorite: { id: string; href: string },
  apps: readonly NavApp[] | null | undefined,
): string | null {
  const match = /^(object|dashboard|page):(.+)$/.exec(favorite.id);
  if (!match) return null;
  const segment = /^\/apps\/([^/?#]+)/.exec(favorite.href)?.[1];
  const app = matchAppBySegment(apps ?? [], segment);
  if (!app) return null;
  return studioDesignPath(app, match[1], match[2]);
}

/**
 * The favorites entry every ⋯ menu leads with (objectui#12427): Add to
 * favorites, or Remove from favorites once the target is one. The sidebar's
 * entry menu and the list page's overflow menu draw this one item, so the two
 * places say the same thing in the same words.
 */
export function FavoriteMenuItem({
  isFavorite,
  onToggle,
  testId,
}: {
  isFavorite: boolean;
  onToggle: () => void;
  testId?: string;
}) {
  const { t } = useObjectTranslation();
  return (
    <DropdownMenuItem data-testid={testId} onSelect={onToggle}>
      {isFavorite ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />}
      <span>
        {isFavorite
          ? t('common.removeFromFavorites', { defaultValue: 'Remove from favorites' })
          : t('common.addToFavorites', { defaultValue: 'Add to favorites' })}
      </span>
    </DropdownMenuItem>
  );
}

/**
 * The first entry of the app's navigation, as the member is shown it, that opens
 * the list of `objectName`: an `object` entry naming it and no single record
 * (an entry with `recordId` opens one record, not the list). The areas are
 * searched in order, then the app's own navigation. A member who cannot see an
 * entry gets none, since a pin on it would draw nowhere.
 */
/** The parts of an app this file reads: its route identity, state and navigation. */
type NavApp = {
  name?: unknown;
  _packageId?: unknown;
  active?: unknown;
  navigation?: NavigationItem[];
  areas?: Array<{ navigation?: NavigationItem[] }>;
} & Record<string, unknown>;

function objectListNavEntry(
  app: NavApp | undefined,
  objectName: string,
  gates: ReturnType<typeof useNavMemberGates>,
): NavigationItem | null {
  if (!app) return null;
  const trees = [...(app.areas ?? []).map((area) => area.navigation ?? []), app.navigation ?? []];
  const find = (items: NavigationItem[]): NavigationItem | null => {
    for (const item of items) {
      if (item.type === 'object' && item.objectName === objectName && !item.recordId) return item;
      if (item.type === 'group' && item.children?.length) {
        const found = find(item.children);
        if (found) return found;
      }
    }
    return null;
  };
  for (const tree of trees) {
    const found = find(navEntriesShownToMember(tree, gates));
    if (found) return found;
  }
  return null;
}

/**
 * The favorites toggle of an object's list page (objectui#12427), which the
 * page header's overflow menu offers.
 *
 * When the current app's navigation has an entry that opens this list, the
 * toggle pins or unpins THAT entry through `useNavPins().togglePin`, exactly
 * as the entry's own ⋯ menu in the sidebar does, so the result is the entry
 * in the sidebar's Favorites section and one `nav:ID` favorite, never a
 * second `object:` favorite for the same wish. Otherwise (an object the app
 * does not list) it toggles the object favorite, `object:NAME`, which the same
 * section draws as a row of its own.
 */
export function useObjectListFavorite({
  appSegment,
  objectName,
  label,
}: {
  appSegment: string | undefined;
  objectName: string | undefined;
  label: string;
}): { isFavorite: boolean; toggle: () => void } | null {
  const { apps } = useMetadata();
  const gates = useNavMemberGates();
  const { isFavorite, toggleFavorite } = useFavorites();
  const { isPinned, togglePin } = useNavPins();
  if (!appSegment || !objectName) return null;
  const basePath = `/apps/${appSegment}`;
  const app = matchAppBySegment(
    ((apps ?? []) as NavApp[]).filter((a) => a.active !== false),
    appSegment,
  );
  const entry = objectListNavEntry(app, objectName, gates);
  if (entry) {
    const pinned = isPinned(entry.id);
    return { isFavorite: pinned, toggle: () => togglePin(entry.id, !pinned, entry, basePath) };
  }
  const id = `object:${objectName}`;
  return {
    isFavorite: isFavorite(id),
    toggle: () => toggleFavorite({ id, label, href: `${basePath}/${objectName}`, type: 'object' }),
  };
}

export interface SidebarItemMenuProps {
  /** The entry's own label, as its row shows it. Names the trigger. */
  label: string;
  /**
   * Where the entry goes: a router path, or, with `external`, a URL off the
   * console. Absent for an entry that navigates nowhere (an `action` entry), in
   * which case the menu offers neither Open in new tab nor Copy link.
   */
  href?: string;
  /** `href` is a URL off the console, opened and copied verbatim. */
  external?: boolean;
  /** Whether the entry is in the sidebar's Favorites section. */
  isFavorite: boolean;
  /** Adds the entry to the Favorites section, or removes it. */
  onToggleFavorite: () => void;
  /**
   * The router path of the entry's designer ({@link sidebarItemDesignPath}).
   * The Design entry shows only when this is set AND the app bar's gate passes
   * it (`useStudioDesignGate`: the viewer may author metadata, and the package
   * the path opens is writable); the gate is read here, so no host can forget
   * it.
   */
  designPath?: string | null;
}

/** The selector of the row a trigger sits in: `SidebarMenuItem`'s `<li>`. */
const ROW_SELECTOR = '[data-sidebar="menu-item"]';

/**
 * An address with a scheme (`https:`, `mailto:`) or a protocol-relative one
 * (`//host/path`): a URL off the console whatever the entry's `target` says. A
 * `url` entry without `target: '_blank'` resolves to such an href with
 * `external: false`, and the row's `Link` still treats it as off-site.
 */
const ABSOLUTE_URL = /^(?:[a-z][a-z\d+\-.]*:|\/\/)/i;

export function SidebarItemMenu({
  label,
  href,
  external = false,
  isFavorite,
  onToggleFavorite,
  designPath,
}: SidebarItemMenuProps) {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  // objectui#12615 — the app bar's own gate, on the package this path opens.
  const gatedDesignPath = useStudioDesignGate(designPath);
  // A router path is opened and copied as the href the row's own `Link`
  // renders for it, which carries the basename the host mounted the console
  // under (`/_console`): a new tab and a copied link resolve against the
  // origin, where a bare router path lands outside the console (objectui#12233).
  const offConsole = !!href && (external || ABSOLUTE_URL.test(href));
  const routerHref = useHref(href && !offConsole ? href : '/');
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  // A right-click on the row opens this menu. The listener sits on the row the
  // trigger is drawn in, and answers only for a click whose own row is that
  // row, so a nested entry never opens an ancestor's menu.
  React.useEffect(() => {
    const row = triggerRef.current?.closest(ROW_SELECTOR);
    if (!row) return undefined;
    const onContextMenu = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(ROW_SELECTOR) !== row) return;
      event.preventDefault();
      setOpen(true);
    };
    row.addEventListener('contextmenu', onContextMenu);
    return () => row.removeEventListener('contextmenu', onContextMenu);
  }, []);

  const documentAddress = !href ? null : offConsole ? href : routerHref;

  const copyLink = async () => {
    if (!documentAddress) return;
    try {
      await navigator.clipboard.writeText(new URL(documentAddress, window.location.href).href);
      toast.success(t('console.nav.linkCopied', { defaultValue: 'Link copied to clipboard' }));
    } catch {
      toast.error(t('console.nav.linkCopyFailed', { defaultValue: 'Failed to copy link' }));
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <SidebarMenuAction
          ref={triggerRef}
          showOnHover
          data-testid="sidebar-item-menu-trigger"
          aria-label={t('console.nav.itemMenu', { defaultValue: 'More actions for {{name}}', name: label })}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </SidebarMenuAction>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="min-w-44">
        <FavoriteMenuItem isFavorite={isFavorite} onToggle={onToggleFavorite} testId="sidebar-item-menu-favorite" />
        {documentAddress && (
          <DropdownMenuItem
            data-testid="sidebar-item-menu-open-new-tab"
            onSelect={() => window.open(documentAddress, '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink className="h-4 w-4" />
            <span>{t('console.nav.openInNewTab', { defaultValue: 'Open in new tab' })}</span>
          </DropdownMenuItem>
        )}
        {documentAddress && (
          <DropdownMenuItem data-testid="sidebar-item-menu-copy-link" onSelect={() => { void copyLink(); }}>
            <Link2 className="h-4 w-4" />
            <span>{t('console.nav.copyLink', { defaultValue: 'Copy link' })}</span>
          </DropdownMenuItem>
        )}
        {gatedDesignPath && (
          <DropdownMenuItem
            data-testid="sidebar-item-menu-design"
            onSelect={() => confirmUnsavedLeave(() => navigate(gatedDesignPath))}
          >
            <PencilRuler className="h-4 w-4" />
            <span>{t('console.nav.design', { defaultValue: 'Design' })}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
