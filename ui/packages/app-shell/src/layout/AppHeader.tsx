/**
 * AppHeader — unified top bar
 *
 * Supabase-style top bar used across the whole console:
 *   [Logo] [Product / Section]                            [actions] [user ▾]
 *   [App ▾] [Preview]          [Search ⌘K]                [actions] [user ▾]
 *                       (inside an app, from 960 px up: the search is centered)
 *
 * Variants:
 *   - `app`  (default when `appName` is present): sidebar trigger + the
 *              product mark + a `/` rule + AppSwitcher + the platform-stage
 *              chip. Used by `ConsoleLayout` inside `/apps/:appName/*`. The
 *              product mark stays in the bar as the way home, the same mark
 *              the home page draws, and `⌘⇧H` / `Ctrl+Shift+H` goes home too
 *              (objectui#12605, which reverses objectui#12201's "no platform
 *              mark inside an app"). An object route (its list, a view, a record)
 *              draws no crumb after the pill: the page header is the one place
 *              that page is named (objectui#12461). A dashboard or page route
 *              draws none either (objectui#12526). A report or `system/*`
 *              route still draws its crumb; where they do not fit, the crumbs fold
 *              into one `⋯` menu (objectui#12702). From 960 px up the
 *              bar is three zones, with the search trigger centered between
 *              the left group and the utility cluster, on every route inside
 *              the app, `system/*` included (objectui#12472).
 *   - `home` : no breadcrumb; displays the product wordmark (from
 *              `getProductName()`, default "ObjectOS") next to the brand
 *              logo. Used by `/home`, whose frame mounts a palette, so from
 *              960 px up its search field is the bar's middle zone, wider than
 *              an app's (objectui#12601).
 *   - `orgs` : no breadcrumb; logo + "Organizations" title. Used by the
 *              `/organizations` landing page.
 *   - `studio`: no breadcrumb; logo + a fixed "Studio" crumb, as `orgs` draws
 *              its own. Used by the `/studio` front door (objectui#11863).
 *
 * The user avatar dropdown includes the organization (workspace) switcher at
 * the top so the same chrome lets users change orgs from any page.
 * @module
 */

import { useLocation, useParams, Link, useNavigate } from 'react-router-dom';
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  Avatar,
  AvatarImage,
  AvatarFallback,
  cn,
} from '@object-ui/components';
import {
  Search,
  HelpCircle,
  ChevronDown,
  Check,
  Lock,
  LogOut,
  Plus,
  Layers,
  Bot,
  User,
  Building2,
  BookOpen,
  ExternalLink,
  Keyboard,
  Pencil,
  MoreHorizontal,
  Info,
} from 'lucide-react';

import { useState, useEffect, useLayoutEffect, useCallback, useRef, type RefObject } from 'react';
import { useOffline } from '@object-ui/react';
import { PresenceAvatars, useTenantPresence, type PresenceUser } from '@object-ui/collaboration';
import { ModeToggle } from './ModeToggle.js';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.js';
import { CurrentOrganizationIndicator } from './CurrentOrganizationIndicator.js';
import { LocaleSwitcher } from './LocaleSwitcher.js';
import { NotificationPreferencesMenu } from './NotificationPreferencesMenu.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import type { ActivityItem } from './ActivityFeed.js';
import { InboxPopover } from './InboxPopover.js';
import { AppSwitcher } from './AppSwitcher.js';
import type { ConnectionState } from '@object-ui/data-objectstack';
import { useAdapter } from '../providers/AdapterProvider.js';
import { useObjectTranslation, useObjectLabel } from '@object-ui/i18n';
import type { BreadcrumbItem as BreadcrumbItemType } from '@object-ui/types';
import { useAuth, getUserInitials } from '@object-ui/auth';
import { useMetadata } from '../providers/MetadataProvider.js';
import { resolveKeyedI18nLabel, preferLocal, matchAppBySegment, appRouteSegment, appStudioRoutePath } from '../utils/index.js';
import { getIcon } from '../utils/getIcon.js';
import { useMobileViewSwitcher } from './MobileViewSwitcherContext.js';
import { useNavigationContext } from '../context/NavigationContext.js';
import { useCommandPalette, useCommandPaletteProviderMounted } from '../context/CommandPaletteProvider.js';
import { useUrlOverlay } from '../hooks/useUrlOverlay.js';
import { metadataText } from '../hooks/useNavTargetLabel.js';
import { KEYBOARD_SHORTCUTS_PARAM } from '../urlParams.js';
import { useAiSurfaceEnabled } from '../hooks/useAiSurface.js';
import { useStudioDesignGate } from '../hooks/useStudioDesignGate.js';
import { useSharedActivityFeed, type ActivityFeedReading } from '../hooks/sharedUserFeeds.js';
import { useInboxBell } from '../hooks/useInboxBell.js';
import { useHomePath } from '../hooks/useHomePath.js';
import { useServedViewItems } from '../hooks/useServedViewItems.js';
import { viewTabLabel } from '../views/viewTabLabel.js';
import { resolveViewId } from '../utils/resolveViewId.js';
import { getProductName, getLogoUrl } from '../runtime-config.js';
import { LocalizedSidebarTrigger } from './LocalizedSidebarTrigger.js';
import { PreviewBadge } from './PreviewBadge.js';
import { AboutDialog } from './AboutDialog.js';
import { getConsoleBuild } from '../buildIdentity.js';
import { GO_HOME_SHORTCUT, useAdvertiseShortcut, type ShortcutChord } from '../chrome/advertisedShortcuts.js';
import { confirmUnsavedLeave } from '../chrome/unsavedEdits.js';

function humanizeSlug(slug: string): string {
  return slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The breadcrumb segment after `System` for the `system/*` pages the console
 * knows by name, read from the packs. `marketplace` is the one this shell
 * mounts itself (`AppContent`'s `system/marketplace` routes, objectui#10900);
 * the other six are the console app's own `system/*` routes (its
 * `AppContent`'s `systemRoutes` fragment, objectui#10969). Any other segment
 * answers `undefined`, and the header shows its humanized slug.
 */
function systemSegmentLabel(segment: string, t: (key: string) => string): string | undefined {
  switch (segment) {
    case 'marketplace': return t('console.breadcrumb.marketplace');
    case 'settings': return t('console.breadcrumb.settings');
    case 'apps': return t('console.breadcrumb.apps');
    case 'profile': return t('console.breadcrumb.profile');
    case 'approvals': return t('console.breadcrumb.approvals');
    case 'ai-approvals': return t('console.breadcrumb.aiApprovals');
    case 'audit-log': return t('console.breadcrumb.auditLog');
    default: return undefined;
  }
}

/** Muted `/` separator between path segments */
function PathSep() {
  return (
    <span className="select-none text-muted-foreground/40 mx-1.5 text-base font-light" aria-hidden>
      /
    </span>
  );
}

/**
 * The width a left-group child would take at its natural size: its box and
 * margins, plus what any `truncate` descendant is currently hiding. The app
 * pill shrinks before the crumbs run out of room, so its rendered box alone
 * would count the room the crumbs took from it as the pill's own width.
 */
function naturalWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  let width = el.getBoundingClientRect().width + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
  for (const d of Array.from(el.querySelectorAll<HTMLElement>('*'))) {
    if (getComputedStyle(d).textOverflow === 'ellipsis') width += Math.max(0, d.scrollWidth - d.clientWidth);
  }
  return Math.ceil(width);
}

/** The trail's three layouts, widest first; see `useAppBarCrumbFold`. */
type CrumbFold = 'full' | 'folded' | 'folded-no-chip';

/** The platform-stage chip, as `PreviewBadge` marks it. */
const CHIP_SELECTOR = ':scope > [data-testid="platform-preview-badge"]';

/**
 * objectui#12702 — how the crumbs after the app pill are laid out. The answer
 * is measured from the left group's own width (a `ResizeObserver` on the
 * group and its children), not from the viewport, against the group's
 * children at their natural width:
 *   - `full`: every crumb drawn in full, the chip beside the pill, when that
 *     fits;
 *   - `folded`: every crumb but the last in one `⋯` menu and the chip after
 *     the last crumb, when that fits;
 *   - `folded-no-chip`: folded, and the chip, the trail's last element, not
 *     drawn, when the folded row with it still does not fit, so the pill and
 *     the last crumb keep their full text.
 * Each crumb's width is read while it is drawn and kept for the trail it
 * belongs to, and the `⋯` and the chip are kept the same way, so a folded
 * trail knows what unfolding would cost. Until every crumb has been measured
 * (the group not laid out yet, or the crumbs hidden below `sm`) the trail is
 * `full`. A trail of one crumb has no middle to fold.
 */
function useAppBarCrumbFold(anchorRef: RefObject<HTMLElement | null>, labels: readonly string[]): CrumbFold {
  const [fold, setFold] = useState<CrumbFold>('full');
  const key = JSON.stringify(labels);
  const count = labels.length;
  const cache = useRef<{ key: string; crumbs: number[]; fold: number; chip: number }>({ key: '', crumbs: [], fold: 0, chip: 0 });

  useLayoutEffect(() => {
    // The group is the crumbs' parent: the trail draws its crumbs straight
    // into it, and the last crumb is drawn in every layout.
    const group = anchorRef.current?.parentElement;
    if (!group || count < 2) {
      setFold('full');
      return;
    }
    const measure = () => {
      const c = cache.current;
      if (c.key !== key) {
        c.key = key;
        c.crumbs = [];
      }
      const chipEl = group.querySelector<HTMLElement>(CHIP_SELECTOR);
      let others = 0;
      for (const child of Array.from(group.children) as HTMLElement[]) {
        const width = naturalWidth(child);
        if (child.dataset.appBarCrumbFold !== undefined) {
          if (width > 0) c.fold = width;
        } else if (child.dataset.appBarCrumb !== undefined) {
          if (width > 0) c.crumbs[Number(child.dataset.appBarCrumb)] = width;
        } else if (child === chipEl) {
          if (width > 0) c.chip = width;
        } else {
          others += width;
        }
      }
      let trail = 0;
      for (let i = 0; i < count; i++) {
        if (!(c.crumbs[i] > 0)) {
          setFold('full');
          return;
        }
        trail += c.crumbs[i];
      }
      const available = group.clientWidth;
      if (available <= 0 || others + c.chip + trail <= available) setFold('full');
      // The `⋯` is measured once it is drawn: fold first, then judge the chip.
      else if (!(c.fold > 0) || others + c.fold + c.crumbs[count - 1] + c.chip <= available) setFold('folded');
      else setFold('folded-no-chip');
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(group);
    for (const child of Array.from(group.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [anchorRef, key, count, fold]);

  return count >= 2 ? fold : 'full';
}

/**
 * objectui#12702 — the crumbs after the app pill, and the platform-stage chip
 * that rides with them. Unfolded, the chip comes first, beside the pill
 * (objectui#12461), and every crumb is drawn in full. Folded, every crumb but
 * the last collapses into one `⋯` menu that lists them as plain text (the
 * crumbs link nowhere, and neither does the menu), the last crumb keeps its
 * full text, and the chip moves after it; where even that row does not fit,
 * the chip is not drawn. The trail draws from `sm` up; below it the phone bar
 * shows its compact title instead. The trail draws straight into the left
 * group, whose width the fold is measured from.
 *
 * @internal Module-level for `AppHeader.crumbFold-12702`; not on the package entry.
 */
export function AppBarCrumbTrail({
  segments,
  moreLabel,
}: {
  segments: readonly BreadcrumbItemType[];
  moreLabel: string;
}) {
  const lastRef = useRef<HTMLSpanElement>(null);
  const layout = useAppBarCrumbFold(lastRef, segments.map((seg) => String(seg.label)));
  const fold = layout !== 'full';
  const lastIndex = segments.length - 1;
  const chip = <PreviewBadge className="ml-2 hidden sm:inline-flex" />;
  const crumb = (seg: BreadcrumbItemType, i: number) => (
    <span key={i} ref={i === lastIndex ? lastRef : undefined} data-app-bar-crumb={i} className="hidden sm:flex items-center min-w-0">
      <PathSep />
      <span className={`px-1.5 py-1 text-sm font-medium truncate ${i === lastIndex ? 'text-foreground/80' : 'text-foreground/60'}`}>
        {seg.label}
      </span>
    </span>
  );
  return (
    <>
      {!fold && chip}
      {fold && (
        <span data-app-bar-crumb-fold className="hidden sm:flex items-center shrink-0">
          <PathSep />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-foreground/60"
                data-testid="app-bar-crumb-fold"
                aria-label={moreLabel}
                title={moreLabel}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[160px] max-w-[280px]">
              {segments.slice(0, lastIndex).map((seg, i) => (
                <DropdownMenuItem key={i} data-testid="app-bar-crumb-fold-item">
                  <span className="truncate">{seg.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      )}
      {fold ? crumb(segments[lastIndex], lastIndex) : segments.map(crumb)}
      {layout === 'folded' && chip}
    </>
  );
}

/**
 * The product mark — the way home (objectui#12605). One element for every
 * surface that draws it: the home page, the organizations and Studio front
 * doors, and inside every app after the sidebar trigger. A 32 px target
 * holding a 24 px tile on `--primary` with the stack glyph, or the
 * deployment's logo. Named 「PRODUCT home」; `title` keeps the product's name.
 *
 * `homePath`, not a literal `/home` (objectui#7256): on a deployment that
 * DECLARES a landing this is the declared one, so the mark and the post-login
 * landing name the same screen.
 */
function ProductHomeMark({ homePath, label }: { homePath: string; label: string }) {
  const productName = getProductName();
  const logoUrl = getLogoUrl();
  return (
    <Link
      to={homePath}
      data-testid="app-bar-product-home"
      aria-label={label}
      title={productName}
      className="flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex size-6 items-center justify-center overflow-hidden rounded-md bg-primary text-primary-foreground">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="h-full w-full object-contain" />
        ) : (
          <Layers className="size-3.5" aria-hidden />
        )}
      </span>
    </Link>
  );
}

/**
 * Whether a keydown is `chord`: ⌘ or Ctrl exactly when the chord has `mod`
 * (the advertised chords accept either), Shift exactly when it has `shift`,
 * never Alt, and the key compared case-blind (Shift makes it upper case).
 */
function matchesShortcutChord(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  chord: ShortcutChord,
): boolean {
  if (e.altKey) return false;
  if (Boolean(chord.mod) !== (e.metaKey || e.ctrlKey)) return false;
  if (Boolean(chord.shift) !== e.shiftKey) return false;
  return e.key.toLowerCase() === chord.key;
}

/**
 * A keydown aimed at something the user types into: a text field, a select,
 * a content-editable region (rich-text and code editors), or an ARIA textbox.
 * The home chord leaves those alone, so an editor that binds the same keys
 * keeps them (objectui#12605).
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') !== null;
}

/**
 * `⌘⇧H` / `Ctrl+Shift+H` goes home from any app page, as a PUSH so the
 * browser's Back returns to the page (objectui#12605). Advertised beside the
 * listener, under the same gate, so the keyboard-shortcuts dialog lists it
 * exactly where it fires (objectui#11674).
 */
function useGoHomeShortcut(enabled: boolean, homePath: string): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (!matchesShortcutChord(e, GO_HOME_SHORTCUT.chord)) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      // A page holding unsaved edits is asked first (objectui#13231).
      confirmUnsavedLeave(() => navigate(homePath));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, homePath, navigate]);
  useAdvertiseShortcut(GO_HOME_SHORTCUT, enabled);
}

// No fake fallback presence — render nothing when the API has no data so the
// header doesn't ship phantom collaborators in production.
const EMPTY_PRESENCE_USERS: PresenceUser[] = [];

export type AppHeaderVariant = 'app' | 'home' | 'orgs' | 'studio';

export interface AppHeaderProps {
  variant?: AppHeaderVariant;
  appName?: string;
  objects?: any[];
  connectionState?: ConnectionState;
  presenceUsers?: PresenceUser[];
  activities?: ActivityItem[];
  activeAppName?: string;
  onAppChange?: (name: string) => void;
}

export function AppHeader({
  variant,
  appName,
  objects,
  connectionState,
  presenceUsers,
  activities,
  activeAppName,
  onAppChange,
}: AppHeaderProps) {
  const resolvedVariant: AppHeaderVariant = variant ?? (appName ? 'app' : 'home');
  const isApp = resolvedVariant === 'app';

  const location = useLocation();
  const params = useParams();
  const navigate = useNavigate();
  // objectui#13231 — the menus below navigate from a button, which no page's
  // link guard sees, so each departure asks first while a page holds unsaved
  // edits (and goes at once otherwise).
  const leaveTo = (to: string) => confirmUnsavedLeave(() => navigate(to));
  // objectui#7256 — the brand logo's target follows the product's DECLARED
  // landing, so the chrome cannot offer a second, contradicting "home".
  const homePath = useHomePath();
  useGoHomeShortcut(isApp, homePath);
  const { isOnline } = useOffline();
  // Idempotent, direct open of the ⌘K command palette (ADR-0054 C1). Replaces a
  // synthetic `⌘K` KeyboardEvent re-dispatch that did nothing under automation.
  const { openCommandPalette } = useCommandPalette();
  // objectui#11912 — the search trigger is drawn only where a palette is
  // mounted. Outside a `CommandPaletteProvider` (the `home` / `orgs` frames:
  // `/home`, `/ai`, the organizations pages) `openCommandPalette` is the inert
  // fallback and no ⌘K handler is installed, so a "Search ⌘K" there opens
  // nothing. The `/studio` landing mounts one with the palette's `studio` scope
  // (objectui#11863), so its `studio` variant draws the trigger.
  const hasCommandPalette = useCommandPaletteProviderMounted();
  // Click-reachable entry for the keyboard-shortcuts dialog (was `?`-key only).
  // Shares the `?shortcuts=1` URL param with KeyboardShortcutsDialog (C2/C3).
  const { openOverlay: openShortcuts } = useUrlOverlay(KEYBOARD_SHORTCUTS_PARAM);
  // The help menu's About dialog (objectui#12970): ephemeral, so component
  // state, not a URL param — nobody shares a link to it.
  const [aboutOpen, setAboutOpen] = useState(false);
  const {
    user,
    signOut,
    isAuthEnabled,
    organizations,
    activeOrganization,
    isOrganizationsLoading,
    getAuthConfig,
  } = useAuth();
  const dataSource = useAdapter();
  // Runtime AI gating: hide the top-bar AI entry point when the server serves
  // no AI (Community Edition) so it can't dead-end on a chat with no agent.
  // Same signal as the FAB and the `/ai` route guard.
  const { enabled: aiEnabled } = useAiSurfaceEnabled();
  const { t, language } = useObjectTranslation();
  const { objectPluralLabel, dashboardLabel, pageLabel, reportLabel, viewLabel, appLabel } = useObjectLabel();
  // The dashboard, page and report lists are LAZY getters: reading one starts
  // its `/meta/:type` read. They are read below only on the route type that
  // names one (the phone bar's title), never destructured here, so a route of
  // another type starts none of them (objectui#12980).
  const metadata = useMetadata();
  const metadataApps = metadata.apps;
  // The views a server read served, already translated — `/meta/view`, and the
  // object document's own `listViews` (objectui#11295, objectui#11336).
  const servedViews = useServedViewItems();
  const { currentAppName, recordTitle } = useNavigationContext();
  const mobileSwitcher = useMobileViewSwitcher();

  /**
   * Help menu — lazily-loaded `doc` metadata (ADR-0046) so the "?" menu can
   * surface a contextual "This app's docs" entry. Fetched once on first menu
   * open (names/labels only — `content` is omitted from the list response);
   * `null` = not yet loaded, `[]` = loaded-but-empty.
   */
  const [helpDocs, setHelpDocs] = useState<Array<{ name: string; label?: string; _packageId?: string }> | null>(null);
  const loadHelpDocs = useCallback(async () => {
    if (helpDocs !== null) return; // fetch at most once per mount
    try {
      const client: any = dataSource?.getClient?.();
      if (!client?.meta?.getItems) {
        setHelpDocs([]);
        return;
      }
      const result: any = await client.meta.getItems('doc');
      // `meta.getItems` answers the `{ type, items: [...] }` envelope (or a
      // bare array from the ADR-0037 preview path) — the two shapes
      // `MetadataProvider`'s `extractItems` accepts. A `value` arm used to
      // trail them; measured zero producers emit `value` at THIS seam
      // (objectui#6917), so it is gone (AGENTS.md #0.1).
      const items: any[] = Array.isArray(result)
        ? result
        : Array.isArray(result?.items)
          ? result.items
          : [];
      setHelpDocs(
        items
          .map((it) => ({ name: it?.name, label: it?.label, _packageId: it?._packageId }))
          .filter((d) => d.name),
      );
    } catch {
      // Soft-degrade: docs are an optional feature — a failed fetch just
      // means the menu shows the static entries (All docs / Online docs).
      setHelpDocs([]);
    }
  }, [helpDocs, dataSource]);

  /**
   * Recent activity for the bell's Activity tab (#4197).
   *
   * Read from the shared user-scoped feed rather than a local effect: Home's
   * activity card reads the very same `sys_activity` rows, and on `/home` the
   * bell and the card mount in one tree — so an effect here would have made
   * that page issue the read twice. Also NOT gated on `isApp`: the feed is
   * tenant-scoped, not app-scoped, and gating it left this tab reading "No
   * recent activity" on Home / Organizations / the AI screen while the card
   * two hundred pixels below listed the rows.
   *
   * It carries its status and the caller's read grant (objectui#12081): a
   * caller who may not read `sys_activity` is offered no Activity tab and
   * issues no read, and a read that fails says so rather than reading empty.
   *
   * objectui#12980 — no badge reads it, so it is read when the bell is about to
   * open (a pointer over it, focus, a click), not on every console open.
   */
  const [activityWanted, setActivityWanted] = useState(false);
  const wantActivity = useCallback(() => setActivityWanted(true), []);
  const apiActivity = useSharedActivityFeed({ enabled: activityWanted && !activities });
  /**
   * The bell's inbox — rows, badge addends and the three mark-read paths — now
   * comes from `useInboxBell`, the ONE wiring of `sharedUserFeeds` onto an
   * `InboxPopover` (#4225 / #4316). The `global:notifications` page block
   * (`f99932a42`) mounts the SAME hook, so a bell in the header and a bell an
   * author declared on a page cannot disagree about a row's read-state: there
   * is no second read and no second optimistic overlay left to drift.
   *
   * The rows are `sys_inbox_message` (the L5 in-app materialization, `mine`
   * scope) joined with `sys_notification_receipt` for read-state (ADR-0030) —
   * the bell does not read the re-modeled `sys_notification` L2 event. Home's
   * action centre cuts from the same feed. `pendingApprovalsCount` is the
   * badge's second addend, shared with Home's To-do card (#4197).
   *
   * Deliberately NOT gated on `isApp` (#4110): the read is scoped to the USER,
   * not to the app in the URL — unlike the presence avatars and the connection
   * dot below, which are app-shell chrome and are the reason that flag exists.
   */
  const {
    notifications,
    unreadCount,
    pendingApprovalsCount,
    markAllRead,
    markRead: markNotificationRead,
    markManyRead,
  } = useInboxBell();

  /**
   * Presence is the OTHER half of what this component used to fetch here, and
   * it stays app-scoped (#4197). Tenant-wide presence ("who else is online?")
   * is never *read* — it is not a REST collection but a transport-level
   * subscription (`useTenantPresence`, <PresenceProvider>), and the avatars
   * plus the connection dot render only under `isApp` below, which is the
   * reason that flag exists. So un-gating the two user/tenant-scoped feeds
   * above does not drag app-shell chrome off-app with them: the boundary is
   * data scope, not surface.
   */

  const tenantPresence = useTenantPresence();
  const activeUsers = presenceUsers ?? (tenantPresence.length > 0 ? tenantPresence : EMPTY_PRESENCE_USERS);
  // The `activities` prop still wins where a host passes one — rows a host
  // hands over are its answer, so they arrive `ready`; otherwise the shared
  // feed, which says for itself whether its rows are one.
  const activeActivity: ActivityFeedReading = activities
    ? { value: activities, status: 'ready', readable: true }
    : apiActivity;
  const orgList = organizations ?? [];
  const hasOrgSection = isOrganizationsLoading || orgList.length > 0 || !!activeOrganization;
  // Mirror the server's `beforeCreateOrganization` gate so the "Create
  // workspace" entry only shows where multi-org self-service is enabled.
  // Default to allowed until the config resolves (avoids hiding it on slow
  // networks); the server still enforces.
  const [multiOrgDisabled, setMultiOrgDisabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getAuthConfig?.()
      .then((cfg) => {
        if (!cancelled) setMultiOrgDisabled(cfg?.features?.multiOrgEnabled === false);
      })
      .catch(() => {
        /* leave default — server still enforces */
      });
    return () => {
      cancelled = true;
    };
  }, [getAuthConfig]);

  // Build path segments (only used in `app` variant)
  const pathParts = location.pathname.split('/').filter(Boolean);
  const appNameFromRoute = params.appName || pathParts[1];
  const routeType = pathParts[2];

  const safeObjects = objects ?? [];

  // The app the route is in.
  const appNameKey = activeAppName || currentAppName || appNameFromRoute;
  // ADR-0048 (A) — appNameKey may be a package id (route segment); match by it.
  const currentApp = matchAppBySegment(metadataApps || [], appNameKey);

  // Help menu — docs owned by the current app (matched by package id, the
  // precise owner link; ADR-0048). Empty when not inside an app, the app
  // ships no docs, or the lazy fetch hasn't run yet.
  const currentAppPackageId = (currentApp as any)?._packageId as string | undefined;
  const currentAppDocs = currentAppPackageId
    ? (helpDocs ?? []).filter((d) => d._packageId === currentAppPackageId)
    : [];

  // App → Studio reverse bridge (ADR-0080): admins jump from the running app
  // to its owning package's design surface. Null when there is nothing to open
  // (no owning package, or a principal or package the gate below refuses).
  // When the current route names a specific
  // interface (a dashboard, page, or report), deep-link straight to THAT surface
  // in the Interfaces pillar instead of the package's generic Data tab — the
  // surface's design page replaces the retired in-page inline editor. The route
  // type doubles as the surface type and `pathParts[3]` is the surface name
  // (absent on the interface list routes, which fall back to the Data tab); the
  // mapping lives in `appStudioRoutePath`.
  //
  // Who may cross the bridge, and into which package, is the SERVER's answer:
  // a workspace admin holding `manage_metadata` (an organization owner is a
  // workspace admin, yet `organization_admin` deliberately withholds it,
  // ADR-0066, objectui#10899), into a package Studio lists as writable
  // (objectui#12615). A read-only package, and the console's own Setup, Studio
  // and Account apps, get no bridge: Studio would open them browse-only, with
  // nothing to edit. `useStudioDesignGate` holds both halves for this bar and
  // the sidebar's Design entry; the server still refuses the write either way.
  const studioDesignPath = useStudioDesignGate(
    isApp ? appStudioRoutePath(currentApp, true, { type: routeType, name: pathParts[3] }) : null,
  );

  // The crumbs drawn after the app pill from `sm` up: a report or `system/*`
  // route's.
  const extraSegments: BreadcrumbItemType[] = [];
  // An object route — the object's list, one of its views, one of its records
  // — draws NO crumb after the pill (objectui#12461): its page header names
  // the page, the sidebar's active entry names the object and the saved-view
  // strip names the view, so a crumb said the same name a third time. The
  // crumb's 「Switch Object」 menu went with it: the sidebar switches objects
  // and the view strip switches views. A dashboard route and a page route
  // draw none either (objectui#12526): the dashboard's page header and the
  // page's own heading name them. What is left on those routes is the page's
  // name for the phone bar's compact title below `sm`, unchanged: the
  // record, else the view, else the object's list, named by its plural as the
  // list page is titled (objectui#11696); the dashboard; the page.
  let routeTitle: string | undefined;

  if (isApp) {
    if (routeType === 'dashboard') {
      // No crumb at all since objectui#12526 (no 「Dashboards」 type crumb
      // since objectui#12273): `DashboardView`'s page header names the
      // dashboard. The label below names it in the phone bar only.
      if (pathParts[3]) {
        const dashboardName = pathParts[3];
        // ADR-0048 Phase 2 — prefer the current app's package (container-scoped).
        const dashboardDef = preferLocal(metadata.dashboards as any[], dashboardName, (currentApp as any)?._packageId);
        // A dashboard the `/meta` read served carries its label already
        // translated (a published edit kept over the packaged catalog), so it
        // is drawn as given — the page header draws it the same way. Only the
        // humanized slug, which no server translated, goes through the bundle
        // (objectui#11295).
        routeTitle = dashboardDef?.label || dashboardLabel({ name: dashboardName, label: humanizeSlug(dashboardName) });
      }
    } else if (routeType === 'page') {
      // No crumb at all since objectui#12526 (no 「Pages」 type crumb since
      // objectui#12198, the maintainer's ruling on
      // objectstack-ai/cloud#2768): the page names itself from `sm` up — a
      // page that is not a record page draws its label as its heading unless
      // its own `page:header` does, and an interface page draws its label
      // above its list. The label below names it in the phone bar only.
      if (pathParts[3]) {
        const pageName = pathParts[3];
        const pageDef = preferLocal(metadata.pages as any[], pageName, (currentApp as any)?._packageId);
        const fallback = pageDef?.label || humanizeSlug(pageName);
        routeTitle = pageLabel({ name: pageName, label: fallback });
      }
    } else if (routeType === 'report') {
      // No 「Reports」 type crumb either (objectui#12273), for the dashboard
      // branch's reason: the trail goes from the app straight to the report.
      if (pathParts[3]) {
        const reportName = pathParts[3];
        const reportDef = preferLocal(metadata.reports as any[], reportName, (currentApp as any)?._packageId);
        // A report's `label` may be an inline locale map; drawn raw, the crumb
        // blanked the report page (objectui#13470).
        const fallback = metadataText(reportDef?.label, language) ?? humanizeSlug(reportName);
        extraSegments.push({ label: reportLabel({ name: reportName, label: fallback }) });
      }
    } else if (routeType === 'system') {
      extraSegments.push({ label: t('console.breadcrumb.system') });
      if (pathParts[3]) {
        extraSegments.push({ label: systemSegmentLabel(pathParts[3], t) ?? humanizeSlug(pathParts[3]) });
      }
    } else if (routeType) {
      const currentObject = safeObjects.find((o: any) => o.name === routeType);
      if (currentObject) {
        routeTitle = objectPluralLabel(currentObject);
        if (pathParts[3] === 'record' && pathParts[4]) {
          const shortId = pathParts[4].length > 12 ? `${pathParts[4].slice(0, 8)}…` : pathParts[4];
          const trimmedTitle = recordTitle?.trim();
          const displayTitle = trimmedTitle && trimmedTitle.length > 48
            ? `${trimmedTitle.slice(0, 45)}…`
            : trimmedTitle;
          routeTitle = displayTitle || `#${shortId}`;
        } else if (pathParts[3] === 'view' && pathParts[4]) {
          // The view is named by the one function its tab is named by
          // (`viewTabLabel`), so the title matches the tab users clicked: its
          // label, else — the spec gives a view's `label` no default — the
          // object's plural label, never a string humanized from the view's
          // machine name (objectui#12805, the tab's rule from objectui#12774).
          const viewName = pathParts[4];
          // `listViews` is canonical (#5362; @objectstack/spec declares only camelCase). The
          // `list_views` leg is a compatibility READ for stored pre-settlement documents
          // (that stock has never been censused: objectstack#7917). Never WRITE the snake key.
          const definedViews = (currentObject as any).listViews || (currentObject as any).list_views || {};
          // The URL may name the view bare (`/view/in_progress`, as a nav entry
          // writes it) while its tab id is qualified (`<object>.in_progress`):
          // matched by `resolveViewId`, the one matcher the object page uses to
          // open it, so the title names the view the page shows (objectui#11295).
          const viewId = resolveViewId(viewName, Object.keys(definedViews), currentObject.name);
          const viewDef = viewId ? (definedViews as Record<string, any>)[viewId] : undefined;
          // A served view's label is already translated — drawn as given, as its
          // tab draws it; any other view's goes through the bundle under the
          // URL's view name (objectui#11295). A view stored with a `title` and
          // no `label` keeps its `title`, as the header drew it before.
          routeTitle = viewTabLabel(
            { id: viewDef ? viewId : undefined, name: viewName, label: viewDef?.label || viewDef?.title },
            currentObject.name,
            servedViews,
            viewLabel,
            objectPluralLabel(currentObject),
          );
        }
      }
    }
  }

  const lastSegmentLabel = routeTitle || extraSegments[extraSegments.length - 1]?.label || appName || '';


  // objectui#12472 — inside an app, from 960 px up, the bar is three zones: the
  // left group, the search trigger in the middle, and the utility cluster on
  // the right. The two side zones grow from the same zero basis (`flex-1`
  // here, `min-[960px]:flex-1` on the cluster), so the middle zone sits at the bar's
  // center whatever either side holds. The left zone keeps `min-w-0`, and the
  // app pill truncates inside it; the cluster never shrinks below its
  // content (`min-[960px]:min-w-max`), so when the utilities need more than half the
  // bar the search yields to the left instead of overlapping them. Inside an
  // app it is every route, `system/*` included; below 960 px the search is the
  // icon button in the cluster everywhere. The field and the icon switch at
  // that one breakpoint, `min-[960px]:`, so they never both show or both hide;
  // it was `lg` (1024 px) until objectui#12702 kept the field down to 960 px.
  //
  // objectui#12601 — the `home` variant centers it too, wherever a palette is
  // mounted (`HomeLayout` mounts one): Home's bar is the product mark, the
  // search field and the utilities, so the field is the bar's middle, wider
  // than inside an app and named for what the palette finds. The `orgs` and
  // `studio` variants keep the search at the cluster's left edge.
  const isHomeSearch = resolvedVariant === 'home' && hasCommandPalette;
  const centersSearch = (isApp && hasCommandPalette) || isHomeSearch;
  const searchLabel = isHomeSearch
    ? t('home.search', { defaultValue: 'Search apps, records, pages…' })
    : t('console.search', { defaultValue: 'Search…' });

  // Search — desktop. One element, drawn in the middle zone or in the
  // cluster's search group (see `centersSearch`).
  const desktopSearchTrigger = (
    <button
      type="button"
      data-testid="action:command-palette:open"
      aria-label={searchLabel}
      aria-keyshortcuts="Meta+K Control+K"
      onClick={openCommandPalette}
      className={cn(
        'hidden min-[960px]:flex relative items-center gap-2 h-8 px-3 text-sm rounded-md border bg-muted/50 text-muted-foreground hover:bg-muted transition-colors',
        isHomeSearch ? 'w-80 xl:w-[420px]' : 'w-48 xl:w-64',
      )}
    >
      <Search className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate text-left text-xs">
        {searchLabel}
      </span>
      <kbd className="pointer-events-none inline-flex h-5 items-center gap-0.5 rounded border bg-background px-1.5 text-[10px] font-medium text-muted-foreground">
        <span className="text-xs">⌘</span>K
      </kbd>
    </button>
  );

  return (
    <div className="flex items-center justify-between w-full h-full">
      {/* ── LEFT: Logo / App / Object path ── */}
      <div className="flex items-center min-w-0 flex-1">
        {/* The shell's one sidebar trigger, at every width (objectui#12429):
            the drawer button on a phone, the collapse/expand toggle for the
            sidebar and its icon rail above that. It is the bar's leftmost
            control inside an app, so it never moves when the sidebar
            collapses; the sidebar itself carries no trigger. */}
        {isApp ? (
          <LocalizedSidebarTrigger className="shrink-0 mr-1" aria-label={t('common.toggleSidebar', { defaultValue: 'Toggle sidebar' })} />
        ) : (
          // objectui#12605 — the product mark sits at the same x on every
          // surface. Off an app there is no sidebar to toggle, so the
          // trigger's slot (its 28 px box and its gap) is held empty: the
          // mark does not jump left when the viewer goes home.
          <span aria-hidden data-testid="app-bar-trigger-slot" className="h-7 w-7 shrink-0 mr-1" />
        )}

        {/* The product mark — links to home, on every surface: the home
            page, the organizations and Studio front doors, and inside every
            app, after the sidebar trigger (objectui#12605). Inside an app a
            `/` rule follows it, so the bar reads 「PRODUCT / APP」. The rule
            is drawn, not typed: it carries no text, and the `/` separators
            the crumbs after the pill use stay theirs alone. */}
        <ProductHomeMark
          homePath={homePath}
          label={t('layout.appSwitcher.productHome', {
            defaultValue: '{{product}} home',
            product: getProductName(),
          })}
        />
        {isApp && (
          <span
            aria-hidden
            data-testid="app-bar-home-separator"
            className="mx-1.5 h-[18px] w-px shrink-0 rotate-[20deg] bg-border"
          />
        )}

        {resolvedVariant === 'home' && (
          <span className="hidden sm:inline ml-2 text-sm font-semibold tracking-tight">
            {getProductName()}
          </span>
        )}

        {/* Platform-stage chip — rides along on every console surface while
            the whole platform is in preview. On platform surfaces it sits in
            the brand zone, beside the mark; inside an app it sits beside the
            app pill, below (objectui#12461). Desktop-only to spare the
            crowded mobile top bar; renders nothing once runtime-config
            reports GA. */}
        {!isApp && <PreviewBadge className="ml-2 hidden sm:inline-flex" />}

        {/* Organization context — "which org am I in", right after the brand and
            before the app/section breadcrumb. Two mutually exclusive renderers:
            the switcher for multi-membership users (name + switch dropdown),
            and the read-only indicator for the single-membership case the
            switcher declines to render, on walled deployments only
            (objectui#5287 — the switcher's own visibility rule is unchanged). */}
        <WorkspaceSwitcher />
        <CurrentOrganizationIndicator />

        {resolvedVariant === 'orgs' && (
          <>
            <PathSep />
            <span className="text-sm font-medium text-foreground/80 px-1.5">
              {t('organizations.title', { defaultValue: 'Organizations' })}
            </span>
          </>
        )}

        {resolvedVariant === 'studio' && (
          <>
            <PathSep />
            <span className="text-sm font-medium text-foreground/80 px-1.5">
              {t('console.studio.title')}
            </span>
          </>
        )}

        {isApp && (
          <>
            {/* App pill — the app's glyph and name, and its switcher, after
                the product mark's `/` rule. At every width: below `sm` it is
                the glyph alone, named in its tooltip (objectui#12605). The
                dropdown's Studio row takes the Studio button's own target, so
                the two cannot disagree (objectui#12201 item 6). `min-w-0` here
                and on the pill's button lets a long app name truncate in the
                pill rather than spill out of the left zone (objectui#12472).
                Where the host asks for no switcher and the viewer is served
                one app, `AppSwitcher` draws the app's glyph and name with no
                dropdown in the same slot, so the chip below still follows it
                (objectui#12913). */}
            {activeAppName && onAppChange ? (
              <div className="flex items-center min-w-0">
                <AppSwitcher
                  activeAppName={activeAppName}
                  onAppChange={(segment) => confirmUnsavedLeave(() => onAppChange(segment))}
                  designInStudioPath={studioDesignPath}
                />
              </div>
            ) : appName ? (
              <span className="hidden sm:inline text-sm font-medium text-foreground/80 px-1.5">{appName}</span>
            ) : null}

            {/* The crumbs after the pill — a report or `system/*` route's;
                an object, dashboard or page route draws none (see
                `routeTitle`). Plain text: none of them links. The
                platform-stage chip rides with them: beside the app's name, so
                the pill and its stage are the bar's left group
                (objectui#12461; objectui#12201 item 5 had put it beside the
                search box), and after the crumbs once the row is too narrow
                for them and they fold, or not at all where even the folded
                row has no room for it (objectui#12702). */}
            <AppBarCrumbTrail
              segments={extraSegments}
              moreLabel={t('common.more', { defaultValue: 'More' })}
            />

            {/* Mobile: current page label or view switcher */}
            {mobileSwitcher && mobileSwitcher.views.length > 0 ? (
              mobileSwitcher.views.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="sm:hidden flex items-center gap-0.5 min-w-0 ml-1 rounded-md px-1.5 py-1 text-sm font-medium hover:bg-accent active:bg-accent/80 transition-colors"
                      aria-label={t('topbar.switchView', { defaultValue: 'Switch view' })}
                    >
                      <span className="truncate max-w-[180px]">
                        {mobileSwitcher.triggerLabel ??
                          mobileSwitcher.views.find((v) => v.id === mobileSwitcher.activeViewId)?.label ??
                          lastSegmentLabel}
                      </span>
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[220px] max-w-[280px]">
                    {mobileSwitcher.views.map((v) => {
                      const isActive = v.id === mobileSwitcher.activeViewId;
                      return (
                        <DropdownMenuItem
                          key={v.id}
                          onSelect={() => {
                            if (!isActive) mobileSwitcher.onChange(v.id);
                          }}
                          className="gap-2"
                        >
                          {v.icon ? (
                            <span className="shrink-0 text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">{v.icon}</span>
                          ) : null}
                          <span className="flex-1 truncate">{v.label}</span>
                          {v.locked ? (
                            <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                          ) : null}
                          {isActive ? (
                            <Check className="h-4 w-4 shrink-0 text-foreground" aria-hidden />
                          ) : null}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="text-sm font-medium sm:hidden truncate min-w-0 ml-1">
                  {mobileSwitcher.triggerLabel ?? mobileSwitcher.views[0].label}
                </span>
              )
            ) : (
              <span className="text-sm font-medium sm:hidden truncate min-w-0 ml-1">
                {lastSegmentLabel}
              </span>
            )}
          </>
        )}
      </div>

      {/* ── MIDDLE: the search, inside an app from 960 px up (objectui#12472, objectui#12702) ── */}
      {centersSearch && (
        <div data-topbar-zone="search" className="hidden min-[960px]:flex shrink-0 items-center justify-center px-3">
          {desktopSearchTrigger}
        </div>
      )}

      {/* ── RIGHT: actions (grouped: search | notifications/help | preferences/account) ──
          With the search centered, the search group here holds only the icon
          button and leaves at 960 px; the three `min-[960px]:` rules keyed on
          `data-topbar-search` keep the group after it from drawing a divider
          next to nothing. */}
      <div
        className={cn(
          'flex items-center gap-0.5 sm:gap-1 shrink-0 [&>*+*[data-topbar-group]]:ml-1 [&>[data-topbar-group]+[data-topbar-group]]:border-l [&>[data-topbar-group]+[data-topbar-group]]:border-border/60 [&>[data-topbar-group]+[data-topbar-group]]:pl-1 sm:[&>[data-topbar-group]+[data-topbar-group]]:pl-2 sm:[&>[data-topbar-group]+[data-topbar-group]]:ml-2',
          centersSearch &&
            'min-[960px]:flex-1 min-[960px]:min-w-max min-[960px]:justify-end min-[960px]:[&>[data-topbar-search]+[data-topbar-group]]:ml-1 min-[960px]:[&>[data-topbar-search]+[data-topbar-group]]:border-l-0 min-[960px]:[&>[data-topbar-search]+[data-topbar-group]]:pl-0',
        )}
      >
        {/* Offline indicator */}
        {!isOnline && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200 text-xs font-medium">
            <span className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
            {t('topbar.offline', { defaultValue: 'Offline' })}
          </div>
        )}

        {/* Connection Status — app only */}
        {isApp && connectionState && <ConnectionStatus state={connectionState} />}

        {/* Presence Avatars — app only */}
        {isApp && activeUsers.length > 0 && (
          <div className="hidden md:flex items-center shrink-0" title={t('topbar.usersOnline', { defaultValue: 'Users currently online' })}>
            <PresenceAvatars users={activeUsers} size="sm" maxVisible={3} showStatus />
          </div>
        )}

        {/* Group 1: Search */}
        {/* Only where a palette is mounted (objectui#11912) — see `hasCommandPalette`. */}
        {hasCommandPalette && (
          <div
            data-topbar-group
            data-topbar-search
            className={cn('flex items-center gap-0.5 sm:gap-1 shrink-0', centersSearch && 'min-[960px]:hidden')}
          >
            {/* Search — desktop, unless the middle zone draws it */}
            {!centersSearch && desktopSearchTrigger}

            {/* Search — mobile/tablet */}
            <Button
              variant="ghost"
              size="icon"
              className="min-[960px]:hidden h-8 w-8 shrink-0"
              data-testid="action:command-palette:open-mobile"
              onClick={openCommandPalette}
              aria-label={searchLabel}
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Group 2: Edit app, Inbox (notifications + approvals + activity) & Help */}
        <div data-topbar-group className="flex items-center gap-0.5 shrink-0">
          {/* Edit app — the app → builder reverse bridge (ADR-0080), at the
              left edge of this utility cluster (objectui#12201 item 6).
              Admins jump from the running app to its owning package's design
              surface; on a dashboard route it deep-links to that dashboard's
              design page in the Interfaces pillar
              (/studio/:packageId/interfaces?surface=dashboard:NAME), otherwise
              the package's Data tab. Hidden for everyone else, for apps
              with no owning package and for a package that is not writable
              (objectui#12615): not rendered, never disabled. An icon button
              at every width, like the bell beside it (objectui#12461): the pencil alone, named
              「Edit app」 by its aria-label and its tooltip. */}
          {studioDesignPath && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              asChild
              data-testid="app-design-in-studio-button"
              aria-label={t('topbar.editApp', { defaultValue: 'Edit app' })}
              title={t('topbar.editApp', { defaultValue: 'Edit app' })}
            >
              <Link to={studioDesignPath}>
                <Pencil className="h-4 w-4" />
              </Link>
            </Button>
          )}

          {/*
           * UX P0-2: a single bell consolidates what used to be three
           * separate top-bar buttons (ActivityFeed, Approvals, Notifications).
           * Reduces visual noise and removes the duplicated "9+" badges.
           */}
          {/* objectui#12980 — the open intent that starts the Activity read.
              `contents` keeps the wrapper out of the bar's flex layout; the
              events still reach it from the bell inside. */}
          <span
            className="contents"
            data-testid="inbox-bell-intent"
            onPointerEnter={wantActivity}
            onFocus={wantActivity}
            onClickCapture={wantActivity}
          >
            <InboxPopover
              notifications={notifications}
              unreadCount={unreadCount}
              pendingApprovalsCount={pendingApprovalsCount}
              activity={activeActivity}
              onMarkAllRead={markAllRead}
              onMarkRead={markNotificationRead}
              onMarkManyRead={markManyRead}
            />
          </span>

          {/* AI Assistant — only when the runtime serves AI (hidden on
              Community Edition so it can't dead-end on an agent-less chat). */}
          {aiEnabled && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              asChild
              aria-label={t('topbar.aiAssistant', { defaultValue: 'AI Assistant' })}
            >
              <Link to="/ai">
                <Bot className="h-4 w-4" />
              </Link>
            </Button>
          )}

          {/* Help & Documentation — an aggregated menu rather than a bare
              external link: contextual "This app's docs" (only when the
              current app ships docs), the in-product docs hub, and the online
              docs. The left-sidebar already links the hub, so this entry point
              earns its place by being context-aware. */}
          <DropdownMenu onOpenChange={(open) => { if (open) void loadHelpDocs(); }}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hidden md:flex shrink-0"
                aria-label={t('sidebar.helpTooltip', { defaultValue: 'Help & Documentation' })}
              >
                <HelpCircle className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56 rounded-lg" sideOffset={4}>
              {currentAppDocs.length > 0 && currentAppPackageId ? (
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() =>
                    leaveTo(
                      currentAppDocs.length === 1
                        ? `/apps/${currentAppPackageId}/docs/${currentAppDocs[0].name}`
                        : `/apps/${currentAppPackageId}/docs`,
                    )
                  }
                >
                  <BookOpen className="mr-2 h-4 w-4" />
                  {t('help.appDocs', { defaultValue: "This app's docs" })}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem className="cursor-pointer" onClick={() => leaveTo('/docs')}>
                <Layers className="mr-2 h-4 w-4" />
                {t('help.allDocs', { defaultValue: 'All documentation' })}
              </DropdownMenuItem>
              {isApp ? (
                <DropdownMenuItem
                  className="cursor-pointer"
                  data-testid="action:keyboard-shortcuts:open"
                  onClick={openShortcuts}
                >
                  <Keyboard className="mr-2 h-4 w-4" />
                  {t('help.keyboardShortcuts', { defaultValue: 'Keyboard shortcuts' })}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="cursor-pointer">
                <a href="https://docs.objectstack.ai" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {t('help.onlineDocs', { defaultValue: 'Online documentation' })}
                </a>
              </DropdownMenuItem>
              {/* About — names the console's own build, on every variant
                  (objectui#12970). */}
              <DropdownMenuItem
                className="cursor-pointer"
                data-testid="action:about:open"
                onClick={() => setAboutOpen(true)}
              >
                <Info className="mr-2 h-4 w-4" />
                {t('help.about', { defaultValue: 'About' })}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} build={getConsoleBuild()} />
        </div>

        {/* Group 3: Account (theme + lang moved into avatar dropdown) */}
        <div data-topbar-group className="flex items-center gap-0.5 shrink-0">        {/* User Profile + Organization switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 rounded-full"
              aria-label={t('user.accountMenu', { defaultValue: 'Account menu' })}
            >
              <Avatar className="h-7 w-7 rounded-full">
                <AvatarImage src={user?.image} alt={user?.name ?? 'User'} />
                <AvatarFallback className="rounded-full bg-primary text-primary-foreground text-xs">
                  {getUserInitials(user)}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-64 rounded-lg" sideOffset={4}>
            {/* User identity */}
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-2 py-2">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={user?.image} alt={user?.name ?? 'User'} />
                  <AvatarFallback className="rounded-lg bg-primary text-primary-foreground">
                    {getUserInitials(user)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{user?.name ?? 'User'}</span>
                  <span className="truncate text-xs text-muted-foreground">{user?.email ?? ''}</span>
                </div>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {/*
               * Profile — land directly on the Account app's profile_card
               * component. We link to the explicit component route rather than
               * `/apps/account` because the bare app path does not reliably
               * resolve to the first (component-type) nav item, leaving the
               * avatar menu's account entry dead. Entering at the component
               * route still mounts the Account app shell (Inbox / Security /
               * Developer remain reachable from its sidebar).
               */}
              <DropdownMenuItem
                onClick={() => leaveTo('/apps/account/component/account/profile_card')}
                className="cursor-pointer"
              >
                <User className="mr-2 h-4 w-4" />
                {t('user.profile', { defaultValue: 'Profile' })}
              </DropdownMenuItem>
              {/*
               * Workspace entries. The header-left WorkspaceSwitcher carries
               * the same destinations, but it renders NOTHING below two orgs
               * (`orgList.length <= 1` → null) — so for the single-org majority
               * the avatar menu is the ONLY door to workspace management.
               * Leaving just the create shortcut here is what shut every path
               * to Members / Invitations / Organization settings for them
               * (objectstack#8096): the picker at `/organizations` auto-skips
               * with one org, and the switcher never appears.
               *
               * "My Organizations" → `?manage=1`, which OrganizationsPage reads as
               * "the user came here to MANAGE": multi-org users get the picker,
               * a single-org user is deep-linked straight to that org's members
               * page (there is no choice worth showing them). Deliberately NOT
               * gated on `multiOrgDisabled` — that flag governs CREATING orgs;
               * where self-service creation is off this entry is the only way
               * in, so gating it there would re-close the door.
               */}
              {hasOrgSection && (
                <DropdownMenuItem
                  onClick={() => leaveTo('/organizations?manage=1')}
                  className="cursor-pointer"
                  data-testid="header-my-organizations"
                >
                  <Building2 className="mr-2 h-4 w-4" />
                  {t('organizations.mine', { defaultValue: 'My Organizations' })}
                </DropdownMenuItem>
              )}
              {hasOrgSection && !multiOrgDisabled && (
                <DropdownMenuItem
                  onClick={() => leaveTo('/organizations?create=1')}
                  className="cursor-pointer"
                  data-testid="header-create-workspace"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('organizations.create', { defaultValue: 'Create organization' })}
                </DropdownMenuItem>
              )}
              {/*
               * Hidden apps (App.hidden === true) surface here instead
               * of in the App Switcher. This is the standard pattern for
               * personal-settings-style apps that would feel out of place
               * next to business apps — Personal Settings, etc. The `account`
               * app is represented by the explicit Profile link above, so it
               * is filtered out here to avoid a duplicate (dead) entry.
               */}
              {(metadataApps || [])
                .filter((a: any) => a.active !== false && a.hidden === true && a.name !== 'account')
                .map((app: any) => {
                  const AppIcon = getIcon(app.icon);
                  const label = appLabel({ name: app.name, label: resolveKeyedI18nLabel(app.label, t) });
                  return (
                    <DropdownMenuItem
                      key={`hidden_app_${app.name}`}
                      onClick={() => leaveTo(`/apps/${appRouteSegment(app) ?? app.name}`)}
                      className="cursor-pointer"
                    >
                      <AppIcon className="mr-2 h-4 w-4" />
                      {label}
                    </DropdownMenuItem>
                  );
                })}
            </DropdownMenuGroup>

            {/*
             * UX P0-2: theme + locale switchers used to be standalone
             * top-bar buttons. They're rarely-used preferences so they live
             * under the avatar dropdown now, freeing top-bar real estate.
             * Each is rendered as a non-interactive label + the existing
             * control so the dropdown handles outside-click / esc cleanly.
             */}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground uppercase tracking-wide px-2">
              {t('user.preferences', { defaultValue: 'Preferences' })}
            </DropdownMenuLabel>
            <div className="flex items-center justify-between px-2 py-1.5 text-sm">
              <span className="text-foreground/80">
                {t('user.theme', { defaultValue: 'Theme' })}
              </span>
              <ModeToggle />
            </div>
            <div className="flex items-center justify-between px-2 py-1.5 text-sm">
              <span className="text-foreground/80">
                {t('user.language', { defaultValue: 'Language' })}
              </span>
              <LocaleSwitcher />
            </div>
            {/*
             * objectui#7011 — the two inbox announcement switches. They belong
             * beside theme and language for the same reason those moved here:
             * browser-local preferences a user sets once. The desktop switch is
             * also the ONLY path to `Notification.requestPermission()` in this
             * console, and keeping it behind a deliberate gesture is what stops
             * a load-time prompt from spending that channel permanently.
             */}
            <NotificationPreferencesMenu />

            {isAuthEnabled && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => confirmUnsavedLeave(() => signOut())}>
                  <LogOut className="mr-2 h-4 w-4" />
                  {t('user.logout', { defaultValue: 'Log out' })}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
