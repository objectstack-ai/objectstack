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
 * 3. Object settings, for an `object` entry (objectstack#36487): it opens the
 *    object in Studio, where its fields are ({@link sidebarItemDesignPath}),
 *    the entry the list page's ⋮ leads with ({@link ObjectSettingsMenuItem}).
 *    Shown on the rule the app bar's Studio entry follows,
 *    `useStudioEntryGate` (objectui#12615, #27356 row 12): to a principal who
 *    may author metadata, for a package Studio lists, writable (built here) or
 *    read-only (installed). The console's own system apps get none. A
 *    dashboard, page or report entry gets no Studio entry here any more: each
 *    is edited on its own page. The server refuses a write either way; this
 *    is the presentational half.
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
import { ExternalLink, Link2, MoreHorizontal, Settings2, Star, StarOff } from 'lucide-react';
import { toast } from 'sonner';
import type { NavigationItem } from '@object-ui/types';
import { useObjectTranslation } from '@object-ui/i18n';
import { useStudioEntryGate } from '../hooks/useStudioDesignGate.js';
import { useFavorites } from '../hooks/useFavorites.js';
import { useNavPins } from '../hooks/useNavPins.js';
import { useNavMemberGates, navEntriesShownToMember } from '../hooks/useNavMemberGates.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { matchAppBySegment } from '../utils/index.js';
import { appStudioObjectPath } from '../utils/appRoute.js';
import { confirmUnsavedLeave } from '../chrome/unsavedEdits.js';

/**
 * Where Object settings takes an object of `app` (objectstack#36487): the
 * object in Studio's Data surface (`surface=object:NAME`), through the
 * derivation the app bar's Studio entry reads on the object's list,
 * `appStudioObjectPath` (objectui#12520). `null` when the app has no owning
 * package Studio can open, or names no object, so the entry hides as the app
 * bar's does; there is no other destination to fall back to.
 *
 * The gate is not read here: the menu that draws the entry reads it
 * ({@link useObjectSettingsGate}), so this answers for a principal and a
 * package that pass it.
 */
function objectSettingsPath(app: NavApp | null | undefined, objectName: string | undefined): string | null {
  return appStudioObjectPath(app, true, objectName);
}

/**
 * The Object settings path of a navigation entry, in the app whose navigation
 * draws it ({@link objectSettingsPath}), or `null`: only an `object` entry has
 * one (objectstack#36487). A `dashboard`, `page` or `report` entry has none —
 * each is edited on its own page — and neither has any other type (`url`,
 * `component`, `separator`, `group`, `action`).
 */
export function sidebarItemDesignPath(
  item: NavigationItem,
  app: NavApp | null | undefined,
): string | null {
  return item.type === 'object' ? objectSettingsPath(app, item.objectName) : null;
}

/**
 * The Object settings path of a favorite that is not a navigation entry, read
 * from its id (`object:NAME`), in the app the favorite opens: the one its
 * `href` names (`/apps/<app>/...`), which need not be the app the sidebar is
 * drawn in. Any other id (a record, a dashboard, a page, a report, an app) has
 * none (objectstack#36487). The id, not the stored `type`, decides: an app
 * favorite is stored with `type: 'object'` and an `app:` id, and has no object
 * to open. A favorite whose `href` names no app in `apps` has none either.
 */
export function favoriteDesignPath(
  favorite: { id: string; href: string },
  apps: readonly NavApp[] | null | undefined,
): string | null {
  const match = /^object:(.+)$/.exec(favorite.id);
  if (!match) return null;
  const segment = /^\/apps\/([^/?#]+)/.exec(favorite.href)?.[1];
  const app = matchAppBySegment(apps ?? [], segment);
  if (!app) return null;
  return objectSettingsPath(app, match[1]);
}

/**
 * objectstack#36487 — `path` when this principal may open the object it names
 * in Studio, else `null`: the app bar's own gate (`useStudioEntryGate`,
 * objectui#12615), in either posture. A workspace admin who may author
 * metadata gets it for a package Studio lists writable (an app built here)
 * and for one it lists read-only (an installed app), which Studio opens to
 * look at; a member, and the console's own system apps, get none.
 * ⛔ Never a second admin check: the gate is read here, once, for every menu
 * that draws the entry.
 */
export function useObjectSettingsGate(path: string | null | undefined): string | null {
  return useStudioEntryGate(path)?.path ?? null;
}

/**
 * The Object settings path of the list of `objectName` in the app the route
 * names (`appSegment`), before the gate ({@link useObjectSettingsGate}): the
 * path the list page's ⋮ leads with, the one the sidebar's object entry opens.
 */
export function useObjectSettingsPath({
  appSegment,
  objectName,
}: {
  appSegment: string | undefined;
  objectName: string | undefined;
}): string | null {
  const { apps } = useMetadata();
  if (!appSegment || !objectName) return null;
  const app = matchAppBySegment(
    ((apps ?? []) as NavApp[]).filter((a) => a.active !== false),
    appSegment,
  );
  return objectSettingsPath(app, objectName);
}

/**
 * Object settings (objectstack#36487): the entry that opens an object in
 * Studio, where its fields are. The list page's ⋮ leads with it and the
 * sidebar's object entry carries it, so the two places say the same thing in
 * the same words and open the same place. Hand it a path the gate passed
 * ({@link useObjectSettingsGate}). Leaving asks first when the page holds
 * unsaved edits (`confirmUnsavedLeave`, objectui#13231).
 */
export function ObjectSettingsMenuItem({ path, testId }: { path: string; testId?: string }) {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  return (
    <DropdownMenuItem data-testid={testId} onSelect={() => confirmUnsavedLeave(() => navigate(path))}>
      <Settings2 className="h-4 w-4" />
      <span>{t('console.nav.objectSettings', { defaultValue: 'Object settings' })}</span>
    </DropdownMenuItem>
  );
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
   * The router path the entry's Object settings opens
   * ({@link sidebarItemDesignPath}, {@link favoriteDesignPath}). The entry
   * shows only when this is set AND the app bar's gate passes it
   * ({@link useObjectSettingsGate}: the viewer may author metadata, and Studio
   * lists the package the path opens); the gate is read here, so no host can
   * forget it.
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
  // objectui#12615 — the app bar's own gate, on the package this path opens.
  const objectSettings = useObjectSettingsGate(designPath);
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
        {objectSettings && <ObjectSettingsMenuItem path={objectSettings} testId="sidebar-item-menu-object-settings" />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
