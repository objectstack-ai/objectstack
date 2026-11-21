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

import { useLocation, useParams, Link } from 'react-router-dom';
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  cn,
} from '@object-ui/components';
import {
  Search,
  Layers,
  Pencil,
  Eye,
  MoreHorizontal,
  ChevronLeft,
} from 'lucide-react';
import { usePhoneViewport } from '../hooks/usePhoneViewport.js';
import { isPhoneTabRoute } from './PhoneAppNavBar.js';
import { PhonePageBarEnd, PhonePageBarTitle, useHasPhonePageBar } from './PhonePageBar.js';

import { useState, useLayoutEffect, useRef, type RefObject } from 'react';
import { useOffline } from '@object-ui/react';
import { PresenceAvatars, useTenantPresence, type PresenceUser } from '@object-ui/collaboration';
import { WorkspaceSwitcher } from './WorkspaceSwitcher.js';
import { CurrentOrganizationIndicator } from './CurrentOrganizationIndicator.js';
import { ConnectionStatus } from './ConnectionStatus.js';
import type { ActivityItem } from './ActivityFeed.js';
import { InboxBell } from './InboxBell.js';
import { AccountMenu } from './AccountMenu.js';
import { AppSwitcher } from './AppSwitcher.js';
import type { ConnectionState } from '@object-ui/data-objectstack';
import { useObjectTranslation, useObjectLabel } from '@object-ui/i18n';
import { useServedAppLabel } from '../hooks/useServedAppLabel.js';
import type { BreadcrumbItem as BreadcrumbItemType } from '@object-ui/types';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useBundledReads } from '../providers/bundledReads.js';
import { readItemPreferLocal, useReadItemsByName } from '../hooks/useObjectPresence.js';
import { preferLocal, matchAppBySegment } from '../utils/index.js';
import { useNavigationContext } from '../context/NavigationContext.js';
import { useCommandPalette, useCommandPaletteProviderMounted } from '../context/CommandPaletteProvider.js';
import { metadataText, servedObjectPluralLabel } from '../hooks/useNavTargetLabel.js';
import { useAiSurfaceEnabled } from '../hooks/useAiSurface.js';
import { useHomePath } from '../hooks/useHomePath.js';
import { useServedViewItems } from '../hooks/useServedViewItems.js';
import { viewTabLabel } from '../views/viewTabLabel.js';
import { resolveViewId } from '../utils/resolveViewId.js';
import { getProductName, getLogoUrl } from '../runtime-config.js';
import { LocalizedSidebarTrigger } from './LocalizedSidebarTrigger.js';
import { PreviewBadge } from './PreviewBadge.js';
import { AssistantTopBarButton } from './AssistantTopBarButton.js';
import { HelpMenu } from './HelpMenu.js';
import { useAppStudioEntry } from './ShellPageActions.js';
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
 * (44 px below `md`, a phone's touch target) holding a 24 px tile on
 * `--primary` with the stack glyph, or the deployment's logo. Inside an app
 * the bar below `sm` has no room for it beside 44 px controls, so it is not
 * drawn there: the app switcher's 「Back to home」 and the drawer's 「All apps」
 * go home (objectstack#29075). Named 「PRODUCT home」; `title` keeps the product's name.
 *
 * `homePath`, not a literal `/home` (objectui#7256): on a deployment that
 * DECLARES a landing this is the declared one, so the mark and the post-login
 * landing name the same screen.
 */
function ProductHomeMark({ homePath, label, className }: { homePath: string; label: string; className?: string }) {
  const productName = getProductName();
  const logoUrl = getLogoUrl();
  return (
    <Link
      to={homePath}
      data-testid="app-bar-product-home"
      aria-label={label}
      title={productName}
      className={cn('flex size-8 max-md:size-11 shrink-0 items-center justify-center rounded-md hover:bg-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
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

// No fake fallback presence — render nothing when the API has no data so the
// header doesn't ship phantom collaborators in production.
const EMPTY_PRESENCE_USERS: PresenceUser[] = [];

/**
 * `docs` is the documentation portal's bar (`/docs/*`, objectstack#35424): the
 * home bar — the product mark and name, the search in the middle, the
 * utilities — with a 「/ Documentation」 crumb after the product name.
 */
export type AppHeaderVariant = 'app' | 'home' | 'orgs' | 'studio' | 'docs';

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
  // objectui#7256 — the brand logo's target follows the product's DECLARED
  // landing, so the chrome cannot offer a second, contradicting "home".
  const homePath = useHomePath();
  // objectstack#35881 — on a phone inside an app the menu is the app's home
  // page. On that page and the two inbox pages the bottom bar opens
  // (`isPhoneTabRoute`), the bar's left is the app pill with the app's name,
  // which switches apps, and the bottom bar carries the search and the inbox,
  // so the top bar does not repeat them. On every page below them the bar's
  // leftmost control is 「‹」 back to the app's home.
  const phone = usePhoneViewport();
  const phoneTab = isApp && phone && isPhoneTabRoute(location.pathname);
  // objectstack#35883 — a page with its own phone top row (the object list:
  // its icon and name, then its 「⋮ More」) takes the bar's middle and right:
  // no app pill, search, bell, assistant or avatar there.
  const hasPhonePageBar = useHasPhonePageBar();
  const phonePageBar = isApp && phone && !phoneTab && hasPhonePageBar;
  const phoneAppHome = `/apps/${params.appName ?? activeAppName ?? ''}`;
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
  // Runtime AI gating: hide the top-bar AI entry point when the server serves
  // no AI (Community Edition) so it can't dead-end on a chat with no agent.
  // Same signal as the FAB and the `/ai` route guard.
  const { enabled: aiEnabled } = useAiSurfaceEnabled();
  const { t, language } = useObjectTranslation();
  const { objectPluralLabel, dashboardLabel, pageLabel, reportLabel, viewLabel } = useObjectLabel();
  const { appLabel } = useServedAppLabel();
  // The dashboard, page and report lists are LAZY getters: reading one starts
  // its `/meta/:type` read. They are read below only on the route type that
  // names one (the phone bar's title), never destructured here, so a route of
  // another type starts none of them (objectui#12980).
  const metadata = useMetadata();
  const metadataApps = metadata.apps;
  // The views a server read served, already translated — `/meta/view`, and the
  // object document's own `listViews` (objectui#11295, objectui#11336). Read
  // only on an object's view route, the one title that labels a view
  // (objectstack#28645): any other route starts no view read for it.
  const servedViews = useServedViewItems(isApp && location.pathname.split('/').filter(Boolean)[3] === 'view');
  // objectstack#28645 — the dashboard or page the phone title names, read from
  // the app bundle first; the list below only for one the bundle does not hold.
  const bundledReads = useBundledReads();
  const readItemsByName = useReadItemsByName(metadata);
  const { currentAppName, recordTitle } = useNavigationContext();


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

  // Build path segments (only used in `app` variant)
  const pathParts = location.pathname.split('/').filter(Boolean);
  const appNameFromRoute = params.appName || pathParts[1];
  const routeType = pathParts[2];

  const safeObjects = objects ?? [];


  // The app the route is in.
  const appNameKey = activeAppName || currentAppName || appNameFromRoute;
  // ADR-0048 (A) — appNameKey may be a package id (route segment); match by it.
  const currentApp = matchAppBySegment(metadataApps || [], appNameKey);

  // The help menu's owner link for the app's docs (ADR-0048).
  const currentAppPackageId = (currentApp as any)?._packageId as string | undefined;

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
  //
  // #27356 row 12 — a read-only package's app is not left with no way in: the
  // same gate answers it with the `view` posture, and this bar and the app
  // switcher draw a browse entry (an eye, 「Open {app} in Studio」) where a
  // writable package's app gets the pencil. The posture is the gate's, read
  // once; the console's own apps and an unread list still draw neither.
  // The derivation is `useAppStudioEntry`'s, the one the page's button group
  // reads too (objectstack#36111), so the two open the same place.
  const studioEntry = useAppStudioEntry(isApp, activeAppName).entry;
  // ADR-0146 D5 — the read-only entry's words: 「Open {app} in Studio」, the
  // app switcher's row text, named for the app the bar is in.
  const viewInStudioText = t('topbar.openAppInStudio', {
    defaultValue: 'Open {{app}} in Studio',
    app: currentApp ? appLabel(currentApp) : (appName ?? ''),
  });

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
        const bundledDashboard = bundledReads?.item('dashboard', dashboardName, (currentApp as any)?._packageId);
        const dashboardDef =
          bundledDashboard?.state === 'hit'
            ? bundledDashboard.value
            : bundledDashboard?.state === 'pending'
              ? undefined
              : preferLocal(metadata.dashboards as any[], dashboardName, (currentApp as any)?._packageId);
        // A dashboard the `/meta` read served carries its label already
        // translated (a published edit kept over the packaged catalog), so it
        // is drawn as given — the page header draws it the same way. Only the
        // humanized slug, which no server translated, goes through the bundle
        // (objectui#11295). The label may be an inline locale map; drawn raw,
        // it blanked the route (objectui#13488).
        routeTitle = metadataText(dashboardDef?.label, language)
          ?? dashboardLabel({ name: dashboardName, label: humanizeSlug(dashboardName) });
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
        const bundledPage = bundledReads?.item('page', pageName, (currentApp as any)?._packageId);
        // objectstack#29416 — a page the bundle does not hold is read by name,
        // and from the `/meta/page` list only when that answer cannot be the
        // prefer-local pick (`readItemPreferLocal`).
        const pageDef =
          bundledPage?.state === 'hit'
            ? bundledPage.value
            : bundledPage?.state === 'pending'
              ? undefined
              : readItemPreferLocal(
                  readItemsByName,
                  'page',
                  pageName,
                  (currentApp as any)?._packageId,
                  () => metadata.pages,
                  metadata.getTypeStatus?.('page'),
                ).item;
        // A page the read served carries its label already translated, by
        // the server's order for an overridden item (objectstack#30244), so it
        // is drawn as given, as the dashboard's above is. Only the humanized
        // slug, which no server translated, goes through the bundle. The label
        // may be an inline locale map; drawn raw, the phone bar's title blanked
        // the page (objectui#13488).
        routeTitle = metadataText(pageDef?.label, language)
          ?? pageLabel({ name: pageName, label: humanizeSlug(pageName) });
      }
    } else if (routeType === 'report') {
      // No 「Reports」 type crumb either (objectui#12273), for the dashboard
      // branch's reason: the trail goes from the app straight to the report.
      if (pathParts[3]) {
        const reportName = pathParts[3];
        const reportDef = preferLocal(metadata.reports as any[], reportName, (currentApp as any)?._packageId);
        // A served report's label is already translated (objectstack#30244),
        // so it is drawn as given; only the humanized slug goes through the
        // bundle. The label may be an inline locale map; drawn raw, the crumb
        // blanked the report page (objectui#13470).
        extraSegments.push({
          label: metadataText(reportDef?.label, language)
            ?? reportLabel({ name: reportName, label: humanizeSlug(reportName) }),
        });
      }
    } else if (routeType === 'docs') {
      // objectstack#35424 — 「APP / Documentation」: the docs page names its
      // book and article itself, above the article.
      extraSegments.push({ label: t('help.documentation', { defaultValue: 'Documentation' }) });
    } else if (routeType === 'system') {
      extraSegments.push({ label: t('console.breadcrumb.system') });
      if (pathParts[3]) {
        extraSegments.push({ label: systemSegmentLabel(pathParts[3], t) ?? humanizeSlug(pathParts[3]) });
      }
    } else if (routeType) {
      const currentObject = safeObjects.find((o: any) => o.name === routeType);
      if (currentObject) {
        // A served object's label is already translated (objectstack#30311):
        // drawn as given, as the object page's own header draws it.
        const listTitle = servedObjectPluralLabel(currentObject, language, objectPluralLabel);
        routeTitle = listTitle;
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
            listTitle,
            language,
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
  // The docs portal's bar is the home bar with one crumb (objectstack#35424).
  const isHomeSearch = (resolvedVariant === 'home' || resolvedVariant === 'docs') && hasCommandPalette;
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
      <kbd className="pointer-events-none inline-flex h-5 items-center gap-0.5 rounded border bg-background px-1.5 text-xs font-medium text-muted-foreground">
        <span className="text-xs">⌘</span>K
      </kbd>
    </button>
  );

  return (
    <div className="flex items-center justify-between w-full h-full">
      {/* ── LEFT: Logo / App / Object path ── */}
      <div className="flex items-center min-w-0 flex-1">
        {/* The shell's one sidebar trigger (objectui#12429): the
            collapse/expand toggle for the sidebar and its icon rail from
            768 px up. It is the bar's leftmost control inside an app, so it
            never moves when the sidebar collapses; the sidebar itself carries
            no trigger. On a phone that slot goes back to the app's home, the
            app's menu (objectstack#35881), and on the app's home and the two
            inbox pages it is not drawn: the app pill comes first there. */}
        {isApp && phone ? (
          phoneTab ? null : (
          <Link
            to={phoneAppHome}
            data-testid="app-bar-phone-home"
            aria-label={t('layout.appSwitcher.backToAppHome', { defaultValue: 'Back to the app menu' })}
            title={t('layout.appSwitcher.backToAppHome', { defaultValue: 'Back to the app menu' })}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </Link>
          )
        ) : isApp && routeType !== 'docs' ? (
          <LocalizedSidebarTrigger className="shrink-0 mr-1 max-md:size-11 max-md:mr-0" aria-label={t('common.toggleSidebar', { defaultValue: 'Toggle sidebar' })} />
        ) : (
          // objectui#12605 — the product mark sits at the same x on every
          // surface. Off an app, and on an app's docs pages (objectstack#35424,
          // which draw no app menu), there is no sidebar to toggle, so the
          // trigger's slot (its 28 px box and its gap) is held empty: the
          // mark does not jump left when the viewer goes home. Below `sm` the
          // mark is not drawn inside an app, so there is nothing to hold.
          <span aria-hidden data-testid="app-bar-trigger-slot" className="h-7 w-7 shrink-0 mr-1 max-sm:hidden" />
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
          className={isApp ? 'max-sm:hidden' : undefined}
        />
        {isApp && (
          <span
            aria-hidden
            data-testid="app-bar-home-separator"
            className="mx-1.5 h-[18px] w-px shrink-0 rotate-[20deg] bg-border max-sm:hidden"
          />
        )}

        {(resolvedVariant === 'home' || resolvedVariant === 'docs') && (
          <span className="hidden sm:inline ml-2 text-sm font-medium tracking-tight">
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

        {/* Organization context, right after the brand. The web organization
            switcher lives in the avatar menu (objectstack-ai/objectstack#34591):
            the left of the bar is the product mark and the app switcher. What
            stays here: the mobile shell's own connection-switcher button
            (renders only inside a shell that announces it), and the read-only
            organization name on a walled deployment, at any membership count
            (objectui#5287). */}
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

        {resolvedVariant === 'docs' && (
          <>
            <PathSep />
            <Link
              to="/docs"
              data-testid="app-bar-docs-crumb"
              className="text-sm font-medium text-foreground/80 px-1.5 hover:text-foreground"
            >
              {t('help.documentation', { defaultValue: 'Documentation' })}
            </Link>
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

        {phonePageBar && <PhonePageBarTitle />}
        {isApp && !phonePageBar && (
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
                  designInStudioPath={studioEntry?.path ?? null}
                  studioPosture={studioEntry?.posture}
                  showNameOnPhone={phoneTab}
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

            {/* Mobile: the current page's label. A list's view switcher is
                the list's own title, drawn in its toolbar row on a phone
                (objectstack#27058), so the bar draws no view dropdown. No
                margin of its own: the pill's padding already parts the two,
                and the width goes to the label (objectstack#34596). */}
            {!phoneTab && (
              <span className="text-sm font-medium sm:hidden truncate min-w-0" data-testid="app-bar-phone-title">
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
          next to nothing. Below `sm` the groups draw no divider and no gap
          beyond the cluster's own: the phone bar's 44 px controls sit side by
          side and the room goes to the page title (objectstack#34596). */}
      <div
        className={cn(
          'flex items-center gap-0.5 sm:gap-1 shrink-0 sm:[&>*+*[data-topbar-group]]:ml-1 sm:[&>[data-topbar-group]+[data-topbar-group]]:border-l sm:[&>[data-topbar-group]+[data-topbar-group]]:border-border/60 sm:[&>[data-topbar-group]+[data-topbar-group]]:pl-2 sm:[&>[data-topbar-group]+[data-topbar-group]]:ml-2',
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
        {phonePageBar && <PhonePageBarEnd />}
        {hasCommandPalette && !phoneTab && !phonePageBar && (
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
              className="min-[960px]:hidden h-8 w-8 max-md:size-11 shrink-0"
              data-testid="action:command-palette:open-mobile"
              onClick={openCommandPalette}
              aria-label={searchLabel}
            >
              <Search className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Group 2: Edit app, Inbox (notifications + approvals + activity) & Help */}
        <div data-topbar-group className={cn('flex items-center gap-0.5 shrink-0', phonePageBar && 'hidden')}>
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
              「Edit app」 by its aria-label and its tooltip. Below `sm` the bar
              keeps its room for 44 px controls and draws neither Studio
              button; the app switcher's Studio row takes the same target
              (objectstack#29075). */}
          {studioEntry?.posture === 'edit' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 max-md:size-11 max-sm:hidden shrink-0"
              asChild
              data-testid="app-design-in-studio-button"
              aria-label={t('topbar.editApp', { defaultValue: 'Edit app' })}
              title={t('topbar.editApp', { defaultValue: 'Edit app' })}
            >
              <Link to={studioEntry.path}>
                <Pencil className="h-4 w-4" />
              </Link>
            </Button>
          )}
          {/* #27356 row 12 — a read-only package's app: the same slot, an eye
              that opens it in Studio's browse-only posture. ADR-0146 D5 — it
              draws WITH its text, 「Open {app} in Studio」, so a look is not
              mistaken for the pencil's edit. The name truncates inside a
              capped width, and below `sm` the button is not drawn at all
              (objectstack#29075: the app switcher's Studio row carries it). */}
          {studioEntry?.posture === 'view' && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 max-md:h-11 max-sm:hidden shrink-0 gap-1.5 px-2 max-w-[14rem]"
              asChild
              data-testid="app-view-in-studio-button"
              title={viewInStudioText}
            >
              <Link to={studioEntry.path}>
                <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span data-slot="view-in-studio-text" className="truncate text-xs font-medium">
                  {viewInStudioText}
                </span>
              </Link>
            </Button>
          )}

          {/*
           * UX P0-2: a single bell consolidates what used to be three
           * separate top-bar buttons (ActivityFeed, Approvals, Notifications).
           * Reduces visual noise and removes the duplicated "9+" badges.
           */}
          {!phoneTab && <InboxBell activities={activities} />}

          {/* AI Assistant — only when the runtime serves AI (hidden on
              Community Edition so it can't dead-end on an agent-less chat).
              objectstack#34608: it opens and closes the drawer in place. */}
          {aiEnabled && <AssistantTopBarButton />}

          {/* Help & Documentation — the shared 「?」 menu (objectstack#36111:
              the page's button group draws the same component). The
              left-sidebar already links the hub, so this entry point earns
              its place by being context-aware. */}
          <HelpMenu
            inApp={isApp}
            appPackageId={currentAppPackageId}
            triggerClassName="h-8 w-8 hidden md:flex shrink-0"
          />
        </div>

        {/* Group 3: Account (theme + lang moved into avatar dropdown) */}
        <div data-topbar-group className={cn('flex items-center gap-0.5 shrink-0', phonePageBar && 'hidden')}>
          <AccountMenu trigger="avatar" />
        </div>
      </div>
    </div>
  );
}
