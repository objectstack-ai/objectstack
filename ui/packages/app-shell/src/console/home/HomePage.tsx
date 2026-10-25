/**
 * HomePage
 *
 * Unified Home Dashboard (Workspace) that displays all available applications,
 * quick actions, recent items, and favorites. Inspired by Airtable/Notion home pages.
 *
 * Features:
 * - Display all active applications as cards
 * - Quick actions for creating apps, importing data, etc.
 * - Recent apps section (from useRecentItems)
 * - Starred/Favorite apps section (from useFavorites)
 * - Responsive grid layout
 * - i18n support
 *
 * @module
 */

import { useEffect, useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMetadata } from '../../providers/MetadataProvider.js';
import { useRecentItems, type RecentItem } from '../../hooks/useRecentItems.js';
import { useRecentItemLabel } from '../../hooks/useRecentItemLabel.js';
import { useNavTargetLabel } from '../../hooks/useNavTargetLabel.js';
import { useFavorites } from '../../hooks/useFavorites.js';
import { useObjectTranslation } from '@object-ui/i18n';
// Its own line: the line above is the pack-hook binding `perm-home-namespace-3546.test.tsx` reads.
import { useObjectLabel } from '@object-ui/i18n';
import { useAuth, useWorkspaceAdminStatus } from '@object-ui/auth';
import { useAgents, isAskAgent, agentHasCapability } from '@object-ui/plugin-chatbot/core';
// May this session author metadata? Shared with the chat surfaces since the
// maker convergence (cloud#1674) — the doctrine (objectstack#8270 posture,
// unknown→fail-open) lives with the hook.
import { useCanAuthorMetadata } from '../../hooks/useCanAuthorMetadata.js';
import { HomeAppsStrip } from './HomeAppsStrip.js';
import { appSegmentOf, lastOpenedByApp } from './appLastOpened.js';
import { recentItemObject, recentItemTypeLabel } from './recentItemTypeLabel.js';
import { RecoveryPasswordReminder } from './RecoveryPasswordReminder.js';
import { HomeActionCenter, HomeContinue, HomeActivity, HomePendingDraftsRow, type RecentItemContext } from './HomeRail.js';
import { resolveI18nLabel } from '@objectstack/spec/ui';
import { useHomeInbox } from '../../hooks/useHomeInbox.js';
import { useNavigationContext } from '../../context/NavigationContext.js';
import {
  appRouteSegment,
  filterActiveApps,
  matchAppBySegment,
  resolveHostAppSegment,
  resolveKeyedI18nLabel,
  resolveNotificationTarget,
} from '../../utils/index.js';
import { resolveSetupAppPath } from '../ConsoleShell.js';
import {
  Empty,
  EmptyTitle,
  EmptyDescription,
  Button,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@object-ui/components';
import { Sparkles, MessageSquareText, Hammer, LayoutGrid } from 'lucide-react';
import { usePendingDrafts } from '../../preview/usePendingDrafts.js';
import { usePublishAllDrafts } from '../../preview/usePublishAllDrafts.js';
import { fetchPackages } from '../../views/studio-design/packages-io.js';
import { resolveAiApiBase } from '../../hooks/useAiSurface.js';
import { isAiStudioEnabled, isMarketplaceEnabled } from '../../runtime-config.js';

/**
 * Which AI home CTAs to surface, driven by the live agent catalog (the single
 * source of truth) — gated PER agent, because the community edition can be in
 * any of three states:
 *  - `askAvailable` — a data/query agent (`ask`/`data_chat`) is deployed → "Ask AI".
 *  - `buildAvailable` — a build/authoring agent is deployed → "Build with AI".
 *    That's a cloud / AI-Studio feature, ABSENT on open-source builds.
 *  - `aiEnabled` — any agent at all (AI is on here in some form).
 * All false while the catalog loads or when AI isn't enabled, so nothing
 * flashes and no AI CTA appears where there's no agent to back it.
 */
function useHomeAiAvailability(): {
  aiEnabled: boolean;
  askAvailable: boolean;
  buildAvailable: boolean;
} {
  const apiBase = useMemo(() => resolveAiApiBase(), []);
  const { agents } = useAgents({ apiBase });
  return {
    aiEnabled: agents.length > 0,
    askAvailable: agents.some((a) => isAskAgent(a.name)),
    // cloud#816 — authoring availability by DECLARED capability (name-check fallback inside).
    buildAvailable: agents.some((a) => agentHasCapability(agents, a.name, 'authoring')),
  };
}

/**
 * One 32 px builder chip at the greeting's right (objectui#12601): "Start with
 * a template" outlined, "Build an app" on the soft primary tint with its icon in
 * the primary colour. Admins only — the caller decides that.
 *
 * Disabled (not hidden) when the session cannot use it: a vanished front door
 * reads as a broken page, while a dimmed one explains the deployment's
 * posture. The explanation rides the objectui#12303 pattern instead of a
 * `title` on the disabled button, which no hover, focus or assistive
 * technology reaches: a wrapping span is the tooltip trigger and a tab stop,
 * and the button and the span both point `aria-describedby` at a visually
 * hidden copy of the reason, `reasonId` — rendered once by the caller, since
 * both chips can share one reason.
 */
function BuilderChip({
  icon: Icon,
  label,
  onClick,
  tone,
  disabledReason,
  reasonId,
  testId,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  tone: 'outline' | 'soft';
  /** The reason the chip is withheld, or `undefined` when it is live. */
  disabledReason: string | undefined;
  /** The id of the visually hidden reason the chip is described by. */
  reasonId: string | undefined;
  testId: string;
}) {
  const disabled = disabledReason !== undefined;
  const button = (
    <button
      type="button"
      disabled={disabled}
      aria-describedby={disabled ? reasonId : undefined}
      onClick={disabled ? undefined : onClick}
      data-testid={testId}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-60',
        tone === 'outline'
          ? 'border bg-background text-foreground hover:bg-muted'
          : 'bg-primary/10 text-primary hover:bg-primary/15',
      )}
    >
      <Icon
        className={cn('h-3.5 w-3.5', tone === 'outline' ? 'text-muted-foreground' : 'text-primary')}
        aria-hidden
      />
      {label}
    </button>
  );
  if (!disabled) return button;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-describedby={reasonId}
            data-disabled-reason=""
            className="inline-flex cursor-not-allowed rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {button}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{disabledReason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Home AI call-to-action(s). "Build with AI" only when a build agent is
 * deployed AND the session may author metadata; "Ask AI" only when a
 * data/query agent is deployed. Renders nothing when neither exists (AI off, or
 * only custom agents — those are reachable via the assistant launcher / FAB).
 * `layout="stack"` is used by the empty-state; the hero uses the default inline
 * row. Availability is passed in so the host fetches the catalog once.
 *
 * "Build with AI" routes to the AI authoring studio, whose output is
 * draft metadata nobody without `manage_metadata` can publish — so it is one of
 * the "any other metadata-authoring CTA" the objectstack#8270 ruling covers.
 * It is HIDDEN rather than disabled: unlike the builder chips it is not the
 * page's structural front door, the chips beside it already carry the reason,
 * and a disabled hero button next to a live "Ask AI" would read as a transient
 * failure. "Ask AI" is read-only and never gated.
 */
function HomeAiActions({
  askAvailable,
  buildAvailable,
  canAuthorMetadata,
  navigate,
  t,
  layout = 'row',
}: {
  askAvailable: boolean;
  buildAvailable: boolean;
  canAuthorMetadata: boolean;
  navigate: (to: string) => void;
  t: (key: string, opts?: any) => string;
  layout?: 'row' | 'stack';
}) {
  const showBuild = buildAvailable && canAuthorMetadata;
  if (!askAvailable && !showBuild) return null;
  const container =
    layout === 'stack'
      ? 'mt-6 flex flex-col sm:flex-row items-center gap-3'
      : 'flex shrink-0 items-center gap-2';
  // In the greeting row the buttons take the builder chips' 32 px height.
  const buttonClass = layout === 'stack' ? undefined : 'h-8 px-3 text-[13px]';
  return (
    <div className={container}>
      {showBuild && (
        <Button onClick={() => navigate('/ai/build')} className={buttonClass} data-testid="home-build-with-ai">
          <Sparkles className="mr-2 h-4 w-4" />
          {t('home.buildWithAI', { defaultValue: 'Build with AI' })}
        </Button>
      )}
      {/* cloud#1674 maker convergence: with the build CTA shown, "Ask AI" is
          not a second door — the build composer answers data questions too
          (data superset since cloud#1673), and `/ai/ask` would bounce a maker
          straight back to `/ai/build`. Non-authoring sessions keep it. */}
      {askAvailable && !showBuild && (
        <Button
          onClick={() => navigate('/ai/ask')}
          className={buttonClass}
          data-testid="home-ask-ai"
        >
          <MessageSquareText className="mr-2 h-4 w-4" />
          {t('home.askAI', { defaultValue: 'Ask AI' })}
        </Button>
      )}
    </div>
  );
}

function pickGreetingKey(hour: number): string {
  if (hour < 5) return 'home.greetingNight';
  if (hour < 12) return 'home.greetingMorning';
  if (hour < 18) return 'home.greetingAfternoon';
  if (hour < 23) return 'home.greetingEvening';
  return 'home.greetingNight';
}

/** Draft names the drafts row lists before the rest go uncounted by name. */
const DRAFT_NAMES_SHOWN = 3;

/**
 * The name Studio shows for the package `packageId` (objectui#13136): its
 * row's `name` in `fetchPackages()`, the package list the Studio top bar and
 * landing read. `_drafts` serves a draft's `packageId` and no package name
 * (`ListDraftsResponseSchema`), so without this read the drafts row named the
 * package by its reverse-domain id where Studio names it.
 *
 * The id stands in exactly where Studio's top bar shows it too: a package
 * whose producer declared no name (`parsePackages` hands the id back as its
 * `name`), a package the list does not carry, and a read that failed.
 *
 * `undefined` until the list has answered for THIS id, so the row names no
 * package rather than flash the id before the name lands. Read once per id,
 * keyed on the id string (AGENTS.md #10), and only while the drafts share one
 * package: `null` sends no request.
 */
function usePackageName(packageId: string | null): string | undefined {
  const [answer, setAnswer] = useState<{ packageId: string; name: string } | null>(null);
  useEffect(() => {
    if (packageId === null) return undefined;
    let cancelled = false;
    const settle = (name: string) => {
      if (!cancelled) setAnswer({ packageId, name });
    };
    fetchPackages().then(
      (packages) => settle(packages.find((p) => p.id === packageId)?.name ?? packageId),
      () => settle(packageId),
    );
    return () => {
      cancelled = true;
    };
  }, [packageId]);
  return packageId !== null && answer?.packageId === packageId ? answer.name : undefined;
}

/**
 * The pending drafts, read for Home's drafts row (objectui#12602) — the read
 * and the publish the retired banner above the greeting ran, unchanged. After
 * the metadata assistant drafts objects, views or apps (ADR-0033 draft-gated
 * authoring), nothing is live until a person publishes; the row surfaces them
 * with a one-click publish and disappears once they are live (`_drafts` → 0).
 *
 * `usePendingDrafts({})` is the env-wide scope (objectui#5801): its bus
 * subscription keeps the count current after later edits and after a
 * publish. `usePublishAllDrafts` is the shared one-click publish, also run by
 * the ADR-0037 draft-preview bar. Returns the row, or `null` with nothing to
 * publish.
 */
function usePendingDraftsRow(t: (key: string, opts?: any) => string, language: string): React.ReactNode {
  const { publishAll, publishing } = usePublishAllDrafts(t);
  const { count, entries } = usePendingDrafts({});
  const drafted = (count ?? 0) > 0;
  // Named only when every draft is in one package: a row naming one package
  // for drafts spread over several would misplace the rest. Named by the name
  // Studio shows for it, not by its id (objectui#13136).
  const packages = new Set(drafted ? entries.map((e) => e.packageId) : []);
  const [onlyPackage] = packages;
  const packageName = usePackageName(packages.size === 1 && onlyPackage ? onlyPackage : null);
  if (!drafted) return null;
  // The draft's own label in the console language (objectui#11862), its
  // name only where `_drafts` served none.
  const names = entries
    .slice(0, DRAFT_NAMES_SHOWN)
    .map((e) => resolveI18nLabel(e.label, language)?.trim() || e.name);
  return (
    <HomePendingDraftsRow
      count={count ?? 0}
      names={names}
      packageName={packageName}
      publishing={publishing}
      onPublish={() => void publishAll()}
      t={t}
    />
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const { t, language } = useObjectTranslation();
  const { apps, objects, loading } = useMetadata();
  const { recentItems } = useRecentItems();
  // A recent entry stores identity; the rail labels it with this, on the
  // render, in the current language (objectui#11678).
  const recentLabel = useRecentItemLabel();
  // A record row's trail names its object as the sidebar names an unlabelled
  // navigation entry for it, and the app as its launcher tile does
  // (objectui#12604).
  const targetLabel = useNavTargetLabel();
  const { appLabel } = useObjectLabel();
  const { favorites } = useFavorites();
  const { user } = useAuth();
  const { isAdmin, isResolved: isAdminResolved } = useWorkspaceAdminStatus();
  const {
    pendingApprovalsCount,
    pendingApprovals,
    pendingApprovalsReadable,
    pendingApprovalsStatus,
    notifications,
    unreadTopicCount,
    notificationsStatus,
    notificationsReadable,
    activity,
  } = useHomeInbox();
  // The drafts row of the My-work section — `null` with nothing to publish.
  const draftsRow = usePendingDraftsRow(t, language);
  // Home renders OUTSIDE the `/apps/:appName/*` router, so there is no
  // `params.appName` to read — `currentAppName` (published by ConsoleLayout on
  // every app mount) is the only "which app is the user in" signal available
  // here, and it is undefined on a cold landing straight at `/home`.
  const { currentAppName } = useNavigationContext();
  // AI CTA gating, per agent: "Build with AI" only when a build agent is
  // deployed (cloud / AI Studio); "Ask AI" only when a data agent is; neither
  // when AI isn't enabled. Community builds typically land in the ask-only state.
  const { askAvailable, buildAvailable } = useHomeAiAvailability();
  // objectstack#8270 — the authoring CTAs below are gated on the SERVER's
  // capability answer, not on the admin ROLE: on the EE multi-tenant deploy an
  // `org_owner` is an admin (`isAdmin === true`) yet deliberately holds no
  // `manage_metadata`, so role alone offered a front door the backend refuses.
  const canAuthorMetadata = useCanAuthorMetadata();
  // objectui#5504 — a runtime deployed with `OS_CLOUD_URL=off` (the EE
  // deploy template's shipped default) mounts no marketplace at all. Home
  // used to recommend it first and error afterwards; that ORDERING was the
  // injury, so the recommendation goes when the capability does.
  const marketplaceEnabled = isMarketplaceEnabled();
  // objectui#5521 — the DEPLOYMENT's own answer to "is metadata authoring
  // offered here at all", distinct from the per-principal `canAuthorMetadata`
  // above. `features.aiStudio` is derived server-side from the same resolution
  // that decides whether the authoring agent is mounted, so on the composed
  // hosted-SaaS shape it arrives `false` while the ToolRegistry holds zero
  // authoring handlers and `/api/v1/meta/*` answers 403.
  //
  // objectui#5577 — read through the accessor, not inline. `features?.` and
  // `!== false` are both load-bearing, and the reasoning for each now lives in
  // exactly one place (`isAiStudioEnabled()`'s docblock) instead of being
  // retyped per call site: that is what the accessor buys. `ChatDock`'s read
  // was the same doctrine spelled a second, un-chained way.
  const aiStudioEnabled = isAiStudioEnabled();
  // Shown wherever an authoring entry point is withheld, so the posture is
  // explained instead of surfacing as a refusal after a filled-in dialog — on
  // a withheld builder chip through its tooltip wrapper (objectui#12303), in
  // the zero-app empty state as its description. Localized in all ten packs.
  const authoringGateReason = t('home.build.noCapability', {
    defaultValue:
      "Building apps isn't available in this system — it requires the “Manage Metadata” permission, which your account doesn't have.",
  });
  const marketplaceGateReason = t('home.template.marketplaceDisabled', {
    defaultValue: 'This runtime has no app marketplace configured, so there are no templates to install here.',
  });

  const activeApps = filterActiveApps(apps);

  /**
   * Which app hosts the app-independent pages this page links into — the
   * Approvals Inbox (objectstack#7231), the full inbox and the activity list
   * (objectui#4074). The resolution and the reasoning live in
   * `utils/appRoute.ts` so Home and the top-bar bell (`InboxPopover`) cannot
   * drift into two different answers for the same question.
   *
   * `currentAppName` is the only "which app is the user in" signal available
   * here — Home renders OUTSIDE the `/apps/:appName/*` router, so there is no
   * `params.appName` to read, and the remembered name is stale by construction
   * (undefined on a cold landing at `/home`, and it outlives the app it names).
   * That is exactly why the resolution re-checks it against the live list.
   *
   * The helper's `setup` last resort is NOT the zero-app case here:
   * `activeApps.length === 0` returns the welcome empty state below, which
   * renders no action center, so these producers never run there.
   */
  const hostAppSegment = resolveHostAppSegment(activeApps, currentAppName);

  /**
   * Setup leaves the tile row (objectui#12601): it administers the workspace
   * rather than running a business process, so it is the muted "System
   * Settings" link beside the apps heading instead of a tile counted among
   * them. Which app is Setup, and its route, are `resolveSetupAppPath`'s answer
   * — the `/setup` alias's own — so the link and the alias cannot name two
   * different apps. The link is drawn only when Setup is among the apps this
   * user can open, exactly where its tile used to be drawn.
   */
  const setupPath = resolveSetupAppPath(activeApps);
  const setupApp = activeApps.find((app) => `/apps/${appRouteSegment(app)}` === setupPath);
  const launcherApps = setupApp ? activeApps.filter((app) => app !== setupApp) : activeApps;
  // When each tile's app was last open — the recent-items store's newest entry
  // inside it (objectui#12601; the reading is `lastOpenedByApp`'s).
  const lastOpened = lastOpenedByApp(launcherApps, recentItems);

  // The visually hidden reasons the withheld builder chips are described by
  // (objectui#12303). Rendered once each: both chips can share the first.
  const authoringReasonId = useId();
  const marketplaceReasonId = useId();

  const recentApps = recentItems
    .filter(item =>
      item.type === 'object' ||
      item.type === 'view' ||
      item.type === 'dashboard' ||
      item.type === 'page' ||
      item.type === 'record')
    .slice(0, 6);

  /**
   * What a "Recently accessed" row prints beside its title (objectui#12604):
   * "Account · HotCRM · 10 minutes ago". The context is a record's object
   * label, else the entry's kind; the app is the one the entry was opened in —
   * its address's app segment, resolved as the router resolves it — labelled
   * as its tile is; a record's icon tile draws its object's icon.
   */
  const describeRecent = (item: RecentItem): RecentItemContext => {
    const objectName = recentItemObject(item);
    const segment = appSegmentOf(item.href);
    const app = segment ? matchAppBySegment(activeApps, segment) : undefined;
    const objectIcon =
      item.type === 'record' && objectName
        ? (objects ?? []).find((o: { name?: unknown }) => o?.name === objectName)?.icon
        : undefined;
    return {
      context:
        item.type === 'record' && objectName
          ? targetLabel({ kind: 'object', objectName }) ?? objectName
          : recentItemTypeLabel(t, item.type),
      app: app ? appLabel({ name: app.name, label: resolveKeyedI18nLabel(app.label, t) }) : undefined,
      icon: typeof objectIcon === 'string' && objectIcon !== '' ? objectIcon : undefined,
    };
  };

  const greeting = useMemo(() => t(pickGreetingKey(new Date().getHours()), { defaultValue: 'Welcome' }), [t]);
  const displayName = (user?.name?.trim() || user?.email?.split('@')[0] || '').trim();

  /**
   * The greeting's one-line summary of what is waiting (objectui#12601). Its
   * number is the pending-approvals count, the one the bell badges and the
   * action center shows, read from the same shared feed. The artboard's second
   * number — what is assigned to the user — has no source to read today: an
   * inbox row carries a free-text `topic` and no declared kind that marks it an
   * assignment, so the line names approvals only instead of guessing a
   * classification (the fork objectui#12602's "assigned to me" column names
   * too). At zero it says nothing is waiting.
   *
   * Only when the count is an ANSWER — the feed's `ready`. While the read is in
   * flight, after it fails, or before anything was asked, the line makes no
   * claim at all: "Nothing is waiting" on a failed read is a denial arriving
   * dressed as good news (the #4235 class), and a count kept from an earlier
   * read is no longer vouched for. The line keeps its height and stays empty,
   * so the row does not jump when the answer lands, and an empty paragraph
   * says nothing to a screen reader either.
   */
  const workSummary =
    pendingApprovalsStatus !== 'ready'
      ? undefined
      : pendingApprovalsCount > 0
        ? t('home.summary.approvals', {
            count: pendingApprovalsCount,
            defaultValue: 'You have {{count}} approval(s) waiting today',
          })
        : t('home.summary.none', { defaultValue: 'Nothing is waiting for you today' });

  // objectui#5619 — `isAdminResolved` joins the metadata wait for the same
  // reason it joins `AppContent`'s: Home is the OTHER route that renders admin-
  // gated affordances, and it is outside `AppContent`'s gate. Landing here with
  // the verdict still in flight drops the admin entries and adds them back a
  // moment later. `isResolved` is true the instant `isAdmin` is, so an admin the
  // session already identifies waits nothing; this only holds the frame that
  // would otherwise be built on a guess.
  if (loading || !isAdminResolved) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <div className="text-muted-foreground">{t('home.loading', { defaultValue: 'Loading…' })}</div>
      </div>
    );
  }

  if (activeApps.length === 0) {
    return (
      <div className="flex flex-col flex-1">
        {/* With no app yet, the drafts row is the whole of "My work": the
            moment the assistant has drafted a first app and nothing is live. */}
        {draftsRow && (
          <div className="px-4 sm:px-6 lg:px-8 pt-4">
            <div className="mx-auto max-w-[1120px]">{draftsRow}</div>
          </div>
        )}
        <RecoveryPasswordReminder t={t} />
        <div className="flex flex-1 items-center justify-center p-6">
        {/*
          Role-aware empty state. ADMINS get the AI-first magic moment as the
          single primary CTA — "describe your business" → generated backend.
          System administration is one click away in the left "Administration"
          nav (UnifiedSidebar), so we no longer crowd the center with a System
          Settings button, and manual "Create App" is deprecated entirely.
          NON-ADMINS can't author the workspace, so they get a quiet "no apps
          yet — ask your admin" state instead of build CTAs they can't use.
          An admin WITHOUT `manage_metadata` (objectstack#8270 — the EE hosted
          posture) is a third case: telling them to "set up your first
          application from the Administration menu" is the same dead end as the
          builder CTAs, so they get the reason instead of the instruction. AI
          "Ask" stays offered — it reads data and needs no authoring capability.
        */}
        {isAdmin && !canAuthorMetadata ? (
          <Empty>
            <EmptyTitle>{t('home.noAppsTitle', { defaultValue: 'No applications yet' })}</EmptyTitle>
            <EmptyDescription data-testid="home-authoring-gate-reason-empty">
              {authoringGateReason}
            </EmptyDescription>
            <HomeAiActions
              askAvailable={askAvailable}
              buildAvailable={buildAvailable}
              canAuthorMetadata={canAuthorMetadata}
              navigate={navigate}
              t={t}
              layout="stack"
            />
          </Empty>
        ) : isAdmin ? (
          <Empty>
            {/*
              No `product` argument: `home.welcome` reads `Build your business
              system with AI` in en, with no `{{product}}` hole, so i18next
              dropped the branded name in silence (objectui#3845). The argument
              is a leftover from an earlier `Welcome to {{product}}` value; if
              white-label deployments should see their own name in the hero, that
              is a copy change to the ten packs, not an argument at this call site.
            */}
            <EmptyTitle>{t('home.welcome', { defaultValue: 'Build your business system with AI' })}</EmptyTitle>
            <EmptyDescription>
              {buildAvailable
                ? t('home.welcomeAdminDescription', {
                    defaultValue:
                      'Describe your business in one sentence — AI generates the objects, screens, APIs and agent tools. Or set things up yourself from the menu on the left.',
                  })
                : askAvailable
                  ? t('home.welcomeAdminDescriptionNoBuild', {
                      defaultValue:
                        'Set up your first application from the Administration menu on the left. Once you have data, the AI assistant can help you explore it.',
                    })
                  : t('home.welcomeAdminDescriptionNoAi', {
                      defaultValue:
                        'Set up your first application from the Administration menu on the left.',
                    })}
            </EmptyDescription>
            <HomeAiActions
              askAvailable={askAvailable}
              buildAvailable={buildAvailable}
              canAuthorMetadata={canAuthorMetadata}
              navigate={navigate}
              t={t}
              layout="stack"
            />
          </Empty>
        ) : (
          <Empty>
            <EmptyTitle>{t('home.noAppsTitle', { defaultValue: 'No applications yet' })}</EmptyTitle>
            <EmptyDescription>
              {t('home.noAppsDescription', {
                defaultValue:
                  'The system is being set up — apps your admin shares with you will show up here.',
              })}
            </EmptyDescription>
          </Empty>
        )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-full bg-background">
      <RecoveryPasswordReminder t={t} />

      {/* The content column (objectui#12601): 1120 px, centred, 28 px above the
          first section and 28 px between sections. No bordered card around the
          greeting or the apps — they sit on the page itself. */}
      <div className="px-4 sm:px-6 lg:px-8 pt-7 pb-16">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-7">
          {/* Greeting, the work summary, and the admin's builder chips */}
          <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              {/* The joiners are the locale's punctuation (objectui#11689):
                  zh-CN and ja write the full-width comma and full stop, ar its
                  own comma. Two keys rather than one interpolated sentence so
                  the name keeps its own coloured span. */}
              <h1 className="text-2xl font-semibold tracking-tight text-pretty">
                <span className="text-foreground">
                  {greeting}
                  {displayName ? t('home.greetingSeparator', { defaultValue: ', ' }) : ''}
                </span>
                {displayName && <span className="text-primary">{displayName}</span>}
                <span className="text-foreground/40">{t('home.greetingEnd', { defaultValue: '.' })}</span>
              </h1>
              <p className="mt-1 min-h-5 text-[13px] text-muted-foreground" data-testid="home-work-summary">
                {workSummary}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <HomeAiActions
                askAvailable={askAvailable}
                buildAvailable={buildAvailable}
                canAuthorMetadata={canAuthorMetadata}
                navigate={navigate}
                t={t}
              />
              {/* The application builder's front door lives HERE, not in a
                * separate builder app: build from scratch → /studio (pick or
                * create a writable package), or start from a template via the
                * marketplace. Two 32 px chips for builders/admins only — end
                * users get none, and see their apps below (objectui#12601). */}
              {isAdmin && (
                <>
                  <BuilderChip
                    icon={LayoutGrid}
                    label={t('home.template.title', { defaultValue: 'Start with a template' })}
                    tone="outline"
                    onClick={() => navigate('/apps/setup/system/marketplace')}
                    disabledReason={
                      !canAuthorMetadata
                        ? authoringGateReason
                        : !marketplaceEnabled
                          ? marketplaceGateReason
                          : undefined
                    }
                    reasonId={!canAuthorMetadata ? authoringReasonId : marketplaceReasonId}
                    testId="home-start-template"
                  />
                  {/* objectui#5521 — HIDDEN, not dimmed, when the runtime reports
                    * `features.aiStudio: false`. The distinction is the flag's own
                    * declared meaning, not a presentation preference: `RuntimeFeatures`
                    * documents it as "when false, the SPA HIDES the AI authoring
                    * affordances", and the serving plugin as "set false to force-hide
                    * the authoring UI". Honouring a producer's declared semantics is
                    * the whole point of reading its flag.
                    *
                    * It is also the honest answer here. `!canAuthorMetadata` is a fact
                    * about THIS PRINCIPAL — a dimmed chip plus its reason tells an
                    * admin something actionable about their own account, which is why
                    * that case stays disabled-with-reason. `aiStudio: false` is a fact
                    * about the DEPLOYMENT: authoring exists for nobody here, there is no
                    * permission to acquire and no admin to ask, so a permanently greyed
                    * front door would advertise a room that was never built. That is the
                    * misdirection class objectui#5557 names — reporting the wrong KIND
                    * of answer — applied to a chip instead of a page.
                    *
                    * Deliberately NOT extended to "Start with a template": installing a
                    * marketplace package is not AI metadata authoring, it has its own
                    * flags (`features.marketplace` / `installLocal`), and objectui#5504
                    * already ruled disable-and-explain for it. Its flag means
                    * reachability; this one means force-hide. */}
                  {aiStudioEnabled && (
                    <BuilderChip
                      icon={Hammer}
                      label={t('home.build.title', { defaultValue: 'Build an app' })}
                      tone="soft"
                      onClick={() => navigate('/studio')}
                      disabledReason={!canAuthorMetadata ? authoringGateReason : undefined}
                      reasonId={authoringReasonId}
                      testId="home-build-app"
                    />
                  )}
                  {/* The reasons the withheld chips are described by — visually
                      hidden, in the user's language, each rendered once. The
                      authoring reason covers every chip it withholds; the
                      marketplace one only when authoring is NOT the reason, so a
                      deployment missing both never states two causes for one
                      dimmed chip. */}
                  {!canAuthorMetadata && (
                    <span
                      id={authoringReasonId}
                      className="sr-only"
                      data-testid="home-authoring-gate-reason"
                    >
                      {authoringGateReason}
                    </span>
                  )}
                  {canAuthorMetadata && !marketplaceEnabled && (
                    <span
                      id={marketplaceReasonId}
                      className="sr-only"
                      data-testid="home-marketplace-disabled-reason"
                    >
                      {marketplaceGateReason}
                    </span>
                  )}
                </>
              )}
            </div>
          </section>

          {/* Your apps — compact, scalable launcher (favorites first); Setup is
              the heading's "System Settings" link rather than a tile */}
          <HomeAppsStrip
            apps={launcherApps}
            favorites={favorites}
            settingsHref={setupApp ? setupPath : undefined}
            lastOpened={lastOpened}
            /* Deliberately NOT resolved through `hostAppSegment` (objectui#4074
               scope guard): the marketplace is an admin-only surface that lives
               in the setup app, so `setup` here is the target, not an oversight
               — unlike the app-independent `sys_*` pages below. */
            onBrowseMarketplace={() => navigate('/apps/setup/system/marketplace')}
            isAdmin={isAdmin}
            /* objectstack#8270 — the strip's marketplace shortcut and its "Add
               app" tile target the SAME marketplace route as the gated "Start
               with a template" chip above, so leaving them live would make that
               gate cosmetic: the withheld dead end would still be one click
               away. Gated together, hidden there (secondary entries, with the
               chip's reason already reachable). */
            canAuthorMetadata={canAuthorMetadata}
            /* objectui#5504 — same reason as the gate above: these entries
               target the very route that 404s on a marketplace-less runtime,
               so they go with the capability rather than leading into the
               error card. */
            marketplaceEnabled={marketplaceEnabled}
          />

          {/* My work (objectui#12602) — approvals, then unread notifications,
              with the pending-drafts row under its heading. */}
          <HomeActionCenter
            pendingApprovals={pendingApprovals}
            pendingApprovalsCount={pendingApprovalsCount}
            pendingApprovalsStatus={pendingApprovalsStatus}
            pendingApprovalsReadable={pendingApprovalsReadable}
            notifications={notifications}
            /* The pill's total — every unread topic, not the capped list
               (#4329); the same number the bell above shows. */
            unreadTopicCount={unreadTopicCount}
            notificationsStatus={notificationsStatus}
            notificationsReadable={notificationsReadable}
            draftsRow={draftsRow}
            onOpenApprovals={() => navigate(`/apps/${hostAppSegment}/system/approvals`)}
            /* The Approvals inbox opens a request's drawer from `?request=`
               (#2678), the link its notifications already carry. */
            onOpenApproval={(r) =>
              navigate(`/apps/${hostAppSegment}/system/approvals?request=${encodeURIComponent(r.id)}`)
            }
            /* The bell's own "view all" target (`InboxPopover`): `?view=mine`
               selects the user-scoped view, so the full page matches what the
               column showed (objectui#4074). */
            onOpenInbox={() => navigate(`/apps/${hostAppSegment}/sys_inbox_message?view=mine`)}
            /* `action_url` is APP-RELATIVE (`/{object}/{id}`, ADR-0030 L5),
               so it has to be hosted under an app before it is a route —
               navigating it verbatim is objectui#5179, where the console
               catch-all forwarded the unmatched path to `/` and the landing
               resolver dropped the user on the default app's home with the
               notification already marked read. `resolveNotificationTarget`
               is shared with the top-bar bell so the two cannot answer this
               differently. The fallback arm runs whenever a notification
               carries no link at all, and opens the inbox. */
            onOpenNotification={(n) => {
              const target = resolveNotificationTarget(n.actionUrl, hostAppSegment);
              if (!target) {
                navigate(`/apps/${hostAppSegment}/sys_inbox_message?view=mine`);
                return;
              }
              if (target.kind === 'external') {
                window.open(target.url, '_blank', 'noopener,noreferrer');
                return;
              }
              navigate(target.path);
            }}
            t={t}
          />

          {/* Continue where you left off + ambient activity. The activity column
              exists only for a caller who may read `sys_activity`
              (objectui#12081) — `HomeActivity` renders nothing otherwise, and an
              empty 360px column would be a hole where the card was. */}
          <div
            className={cn(
              'grid grid-cols-1 items-start gap-6',
              activity.readable && 'lg:grid-cols-[minmax(0,1fr)_360px]',
            )}
          >
            <HomeContinue
              items={recentApps}
              onOpen={(href) => navigate(href)}
              t={t}
              labelOf={recentLabel}
              describe={describeRecent}
            />
            <HomeActivity activity={activity} onViewAll={() => navigate(`/apps/${hostAppSegment}/sys_activity`)} t={t} />
          </div>
        </div>
      </div>
    </div>
  );
}
