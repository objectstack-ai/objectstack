/**
 * InboxPopover
 *
 * UX P0-2: a single "inbox" surface that bundles the three things that
 * used to occupy separate top-bar buttons:
 *   - Notifications (mentions, assignments, system alerts)
 *   - Approvals (pending approval requests for the user)
 *   - Activity (the recent activity the caller may read; no tab at all for a
 *     caller without read on `sys_activity`, objectui#12081)
 *
 * Rendered as a single bell button + a full-height panel on the right with a
 * tabbed body (objectstack#34589): the page beside it stays visible and usable,
 * so opening a notification lands its record in the page while the panel
 * stays open on the next one. Pending approvals are pinned on top of the
 * Notifications tab under "Needs your action", each decidable in place
 * through the request's own declared actions. The panel yields when the record
 * drawer opens (the two never stack on the right), and fills a phone. The
 * badge
 * shows the combined unread pressure — distinct unread *topics* + pending
 * approvals — so a recurring notification (e.g. a scheduled digest that fires
 * once a minute) can't inflate the badge to "9+" on its own (#2765).
 *
 * Notifications are grouped/coalesced by `(topic, title)`: repeats collapse
 * into a single expandable row (`Scheduled project digest ×10`) with a
 * per-group "mark all read", instead of one row each drowning the actionable
 * items (assignments, @mentions, approvals).
 *
 * @module
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  useIsMobile,
} from '@object-ui/components';
import { Bell, Check, CheckSquare, Activity as ActivityIcon, ChevronRight, CircleAlert, Lock } from 'lucide-react';
import { useObjectTranslation, useDisplayLocale } from '@object-ui/i18n';
import type { ActivityFeedReading, PendingApprovalRequest } from '../hooks/sharedUserFeeds.js';
import { useNavigationContext } from '../context/NavigationContext.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { resolveHostAppSegment } from '../utils/appRoute.js';
import { timeAgo } from '../utils/relativeTime.js';
import { groupNotifications } from './inboxGrouping.js';
import type { InboxNotification, NotificationGroup } from './inboxGrouping.js';
import { openInboxNotification } from './openInboxNotification.js';
import { ActivityObjectLabel } from './ActivityObjectLabel.js';
import { confirmUnsavedLeave } from '../chrome/unsavedEdits.js';
import { RECORD_DRAWER_PARAM } from '../urlParams.js';
import { InboxApprovalItem } from './InboxApprovalItem.js';

// Re-exported so importers of the notification/group shapes keep resolving
// through this module (the pure logic itself lives in inboxGrouping.ts).
export type { InboxNotification, NotificationGroup } from './inboxGrouping.js';

type InboxTab = 'notifications' | 'approvals' | 'activity';

/** Tab order, which is also the order the opening pick walks. */
const INBOX_TABS: readonly InboxTab[] = ['notifications', 'approvals', 'activity'];

const isInboxTab = (value: unknown): value is InboxTab =>
  typeof value === 'string' && (INBOX_TABS as readonly string[]).includes(value);

/**
 * sessionStorage key holding the tab the user last PICKED (objectui#11698).
 *
 * sessionStorage, not component state: the header bell is a different
 * instance on Home, Organizations, the AI page and inside an app (each layout
 * mounts its own `AppHeader`), so component state would forget the pick at the
 * first move between them. Not localStorage either: a fresh browser tab starts
 * from the opening pick again — the same per-tab scope the ChatDock's expanded
 * flag uses (`chatDockState.ts`). Every touch is guarded so private mode and a
 * DOM-less runner degrade to "nothing picked".
 */
const INBOX_TAB_STORAGE_KEY = 'inbox-popover-tab';

function recallPickedTab(): InboxTab | null {
  try {
    const raw = window.sessionStorage.getItem(INBOX_TAB_STORAGE_KEY);
    return isInboxTab(raw) ? raw : null;
  } catch {
    return null;
  }
}

function rememberPickedTab(tab: InboxTab): void {
  try {
    window.sessionStorage.setItem(INBOX_TAB_STORAGE_KEY, tab);
  } catch {
    /* storage unavailable: the pick lasts until the popover closes */
  }
}

/**
 * The tab the popover opens on (objectui#11698). It was a fixed
 * `'notifications'`, so a bell reading "3" for three pending approvals opened
 * on "You're all caught up" with the three items one tab to the right.
 *
 * In order: the user's last pick if that tab has something in it; else the
 * first tab that does (Notifications, Approvals, Activity); else the user's
 * last pick; else Notifications. "Has something in it" is what each tab shows
 * by default — an unread topic (the Unread filter is the default, and it is the
 * badge's first addend), a pending approval (the second addend), an activity
 * row — so a non-zero badge never opens on an empty tab, a pick included.
 */
function openingTab(hasItems: Record<InboxTab, boolean>, picked: InboxTab | null): InboxTab {
  if (picked && hasItems[picked]) return picked;
  return INBOX_TABS.find((t) => hasItems[t]) ?? picked ?? 'notifications';
}

/**
 * The phone floor for a tap target: 44 px tall below `md`, the width at which
 * the Console is the phone app's UI. Desktop sizes are untouched.
 */
const PHONE_TAP = 'max-md:min-h-11';

/**
 * Below `md` the three tabs share the strip by content width with their icons
 * dropped, so the third tab is never pushed off a phone's width.
 */
const TAB_TRIGGER_CLASS = `text-xs gap-1.5 data-[state=active]:bg-transparent ${PHONE_TAP} max-md:flex-auto max-md:px-1.5`;

/**
 * The panel (objectstack#34589): the full height of the viewport on the right,
 * 440 px wide from `md` up and the whole screen below it, a flex column whose
 * open tab takes the height the header and tab strip leave.
 */
const PANEL_CLASS = 'flex w-full max-w-none flex-col gap-0 p-0 sm:max-w-none md:w-[440px]';

/** An open tab: fills the panel's remaining height, the rows scroll inside it. */
const TAB_PANEL_CLASS = 'm-0 flex min-h-0 flex-1 flex-col';

/**
 * The per-row "mark read" lever: an icon that shows on hover or keyboard focus
 * instead of a column every row pays for; a phone has no hover, so it stays
 * shown below `md`.
 */
const MARK_READ_ICON_CLASS =
  'shrink-0 self-center mr-2 inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground hover:text-foreground hover:bg-accent transition-opacity opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100 max-md:h-11 max-md:w-11';

export interface InboxPopoverProps {
  notifications: InboxNotification[];
  unreadCount: number;
  pendingApprovalsCount: number;
  /**
   * The Activity tab's rows, whether they are an answer, and whether the
   * caller may read the feed at all (objectui#12081).
   *
   * Required, and one value rather than rows plus optional flags, for the
   * reason `HomeActionCenter` takes `notificationsStatus` as required: the
   * tab used to take the rows alone, so a refused `sys_activity` read arrived
   * as `[]` and the tab said "No recent activity" to every non-admin. A call
   * site that cannot say whether its rows are an answer must not be able to
   * reach the empty copy by saying nothing.
   *
   *  - `readable: false` — no Activity tab at all: no trigger, no empty state,
   *    no drill into a list page that answers this caller `403`;
   *  - `status: 'ready'` — the rows ARE the answer; only here does an empty
   *    list say "No recent activity";
   *  - `status: 'error'` — the read failed: the tab says so, beside whatever
   *    rows it last had; a refusal (`refused`) with the permission sentence
   *    Home shows, any other failure with the generic one (objectui#12859);
   *  - `idle` / `loading` — not asked yet, or in flight.
   */
  activity: ActivityFeedReading;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  /**
   * Mark several notifications read in one shot (per-group "mark all of this
   * type read"). Optional: when absent we fall back to N `onMarkRead` calls, so
   * the component still works for callers that only wire the single-mark path.
   */
  onMarkManyRead?: (ids: string[]) => void;
  /**
   * The first page of the requests `pendingApprovalsCount` counts, from the
   * same read (objectstack#34589), pinned on top of the Notifications tab and
   * listed in the Approvals tab. Absent ⇒ the panel lists none and keeps the
   * count and the drill into the Approvals inbox.
   */
  pendingApprovals?: PendingApprovalRequest[];
  /** A declared decision on one of them succeeded: re-read the approvals. */
  onApprovalDecided?: () => void;
}

export function InboxPopover({
  notifications,
  unreadCount,
  pendingApprovalsCount: servedApprovalsCount,
  activity,
  onMarkAllRead,
  onMarkRead,
  onMarkManyRead,
  pendingApprovals,
  onApprovalDecided,
}: InboxPopoverProps) {
  const { t } = useObjectTranslation();
  // Every relative time below reads the DISPLAY locale, never the UI language
  // (objectui#10668), as the Marketplace's and Studio home's already do.
  const displayLocale = useDisplayLocale();
  const navigate = useNavigate();
  const params = useParams();
  const { currentAppName } = useNavigationContext();
  const { apps } = useMetadata();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  // Requests decided from this panel, hidden until the feed's re-read drops
  // them, so a decided row leaves at once (objectstack#34589).
  const [decidedIds, setDecidedIds] = useState<ReadonlySet<string>>(() => new Set());
  const shownApprovals = useMemo(
    () => (pendingApprovals ?? []).filter((r) => !decidedIds.has(r.id)),
    [pendingApprovals, decidedIds],
  );
  // The count the panel shows, less the decided requests the feed still lists:
  // the same optimistic overlay, so the badge drops with the row.
  const pendingApprovalsCount = Math.max(
    0,
    servedApprovalsCount - ((pendingApprovals?.length ?? 0) - shownApprovals.length),
  );
  // Chosen on every open by `handleOpenChange` below, never while open, so a
  // count that changes under an open popover does not move the tab.
  const [tab, setTab] = useState<InboxTab>('notifications');
  // A caller who may not read `sys_activity` is offered no Activity tab
  // (objectui#12081), so neither a remembered pick nor the current tab may
  // land on it: the tab strip would show no selection over an empty body.
  const showActivity = activity.readable;
  const shownTab: InboxTab = tab === 'activity' && !showActivity ? 'notifications' : tab;
  // Sub-filter inside Notifications: default to Unread so users see what
  // actually needs their attention first. The popover caps at 20 rows from
  // the server (`?view=mine` already scopes to current user), so we filter
  // client-side — switching tabs never re-fetches.
  const [notifFilter, setNotifFilter] = useState<'unread' | 'all'>('unread');
  // Which coalesced groups the user has expanded (keyed by group.key). Empty by
  // default — the whole point is to keep repeats collapsed until asked for.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());

  // Badge/count semantics (#2765): count distinct unread *topics*, not raw
  // rows. Grouping the full list (not just the visible filter) keeps the badge
  // stable when the user toggles Unread/All. 10 identical digests + 2 mentions
  // read as "3", not "9+".
  const allGroups = useMemo(() => groupNotifications(notifications), [notifications]);
  const unreadTopics = allGroups.reduce((sum, g) => sum + (g.unreadCount > 0 ? 1 : 0), 0);

  const totalBadge = unreadTopics + pendingApprovalsCount;

  // The record drawer opens on the right too: the panel yields to it rather
  // than stacking beside it (objectstack#34589).
  const drawerRecordId = new URLSearchParams(location.search).get(RECORD_DRAWER_PARAM);
  useEffect(() => {
    if (drawerRecordId) setOpen(false);
  }, [drawerRecordId]);
  // The bell's accessible name carries what its badge says: the badge is
  // content inside a named button, so a screen reader never reads it. Each
  // non-zero addend is spelled out with the plural forms the popover's own
  // breakdown uses, so the name explains the sum rather than restating it.
  const ariaLabel = [
    t('sidebar.notifications', { defaultValue: 'Notifications' }) as string,
    ...(unreadTopics > 0
      ? [t('notifications.badgeNotifications', { defaultValue: '{{count}} unread topics', count: unreadTopics }) as string]
      : []),
    ...(pendingApprovalsCount > 0
      ? [t('notifications.badgeApprovals', { defaultValue: '{{count}} pending approvals', count: pendingApprovalsCount }) as string]
      : []),
  ].join(', ');

  // Pulse the bell once whenever the unread/approval pressure increases.
  // We track the previous total in a ref so the very first render (when
  // the counts arrive from the server) doesn't trigger a spurious pulse.
  const prevTotalRef = useRef<number | null>(null);
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    const prev = prevTotalRef.current;
    if (prev !== null && totalBadge > prev) {
      setPulse(true);
      const timeout = window.setTimeout(() => setPulse(false), 1200);
      return () => window.clearTimeout(timeout);
    }
    prevTotalRef.current = totalBadge;
    return undefined;
  }, [totalBadge]);
  // Keep prev in sync after the pulse window so a subsequent increase
  // (e.g. 3 → 5 right after 5 settled) re-triggers the animation.
  useEffect(() => {
    if (!pulse) prevTotalRef.current = totalBadge;
  }, [pulse, totalBadge]);

  // The counts are props the shared feeds already polled for the badge (the
  // popover fetches nothing on open), so the pick reads the same numbers the
  // bell showed when it was clicked.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      const picked = recallPickedTab();
      setTab(
        openingTab(
          {
            notifications: unreadTopics > 0,
            approvals: pendingApprovalsCount > 0,
            activity: showActivity && activity.value.length > 0,
          },
          picked === 'activity' && !showActivity ? null : picked,
        ),
      );
    }
    setOpen(next);
  };

  // Only a tab the user selects is remembered; the opening pick is not.
  const handleTabChange = (value: string) => {
    if (!isInboxTab(value)) return;
    setTab(value);
    rememberPickedTab(value);
  };

  /**
   * Which app hosts the three full-page drills below (objectui#4074,
   * objectui#11818).
   *
   * `system/approvals` is mounted for every app, `sys_inbox_message` is the
   * canonical full-page inbox (ADR-0030 L5) and `sys_activity` the full
   * activity stream; the two objects are framework-owned. All three are
   * app-INDEPENDENT — which is precisely why they render under whatever app the
   * user can open. The two objects used to hardcode `/apps/setup/...`, and
   * being app-independent argued for neither half of that: it sent every
   * business user without setup access to a page they cannot read, and
   * switched everyone else out of the app they were in without saying so.
   *
   * The resolver returns the app's ROUTE SEGMENT (ADR-0048 option A: its
   * package id), never the raw hint. `currentAppName` is the app's `name` —
   * what `ConsoleLayout` publishes — so splicing it in directly addressed the
   * same app by a second URL: the approvals link built that way took a user on
   * `/apps/com.example.showcase/…` to `/apps/showcase_app/system/approvals`
   * (objectui#11818).
   */
  const hostAppSegment = resolveHostAppSegment(apps, currentAppName ?? params.appName);

  // Every drill below leaves the page from a popover button, which no page's
  // link guard sees, so it asks first while the page holds unsaved edits
  // (objectui#13253). The popover closes either way; Cancel keeps the page.
  const leaveTo = (to: string) => confirmUnsavedLeave(() => navigate(to));

  const goToApprovals = () => {
    setOpen(false);
    leaveTo(`/apps/${hostAppSegment}/system/approvals`);
  };

  // One request in the Approvals inbox — the target Home's "My work" approvals
  // row opens. The panel stays open beside the page, as for a notification.
  const openApproval = (r: PendingApprovalRequest) => {
    if (isMobile) setOpen(false);
    leaveTo(`/apps/${hostAppSegment}/system/approvals?request=${encodeURIComponent(r.id)}`);
  };

  const handleApprovalDecided = (r: PendingApprovalRequest) => {
    setDecidedIds((prev) => new Set(prev).add(r.id));
    onApprovalDecided?.();
  };

  const goToAllNotifications = () => {
    setOpen(false);
    // `?view=mine` selects the user-scoped "Notifications" view, matching the
    // popover's own scope.
    leaveTo(`/apps/${hostAppSegment}/sys_inbox_message?view=mine`);
  };

  const goToAllActivity = () => {
    setOpen(false);
    // Mirror of goToAllNotifications: drill from the popover Activity tab
    // (capped at 20 rows) into the full sys_activity list page. Org-wide
    // scope — no `?view=` qualifier — to match what the popover already shows.
    leaveTo(`/apps/${hostAppSegment}/sys_activity`);
  };

  // Opening a row is `openInboxNotification`, the ONE open action — Home's
  // "My work → Notifications" row is the other door onto it, so the two
  // cannot disagree about what opening a notification does: mark it read
  // first, then follow its link.
  //
  // The link is the materialization's action_url (ADR-0030). The messaging
  // pipeline synthesizes an app-relative `/{object}/{id}` link from the
  // event's source when a producer didn't set an explicit url — so it names
  // a RECORD, and `hostAppSegment` (already resolved above for the two "see
  // all" drills) is what turns it into a route.
  //
  // This used to host it under a raw `currentAppName ?? params.appName` and
  // navigate BARE when neither named an app — which is the state on every
  // surface outside `/apps/:appName/*` that mounts this bell (`/home`,
  // `/organizations`, the full-page AI screen). The bare path matched no
  // route, the console catch-all forwarded it to `/`, and the landing
  // resolver dropped the user on the default app's home: objectui#5179.
  // Reusing the drills' own resolver also stops an unchecked remembered app
  // from addressing a link into an app that has since been deactivated.
  //
  // No link at all is a real state, not a defect: the producer leaves
  // `action_url` undefined when an emit carries neither a `payload.url` nor a
  // `source`. The row is already spent by then, and stopping there left the
  // popover sitting open on it, having navigated nowhere (objectui#5190).
  // Home's action centre answers this by opening the full inbox
  // (objectui#4074), and that is the ruled behaviour — so the bell reuses the
  // drill it already has one screen up rather than writing a second answer to
  // the same question. `goToAllNotifications` closes the popover and lands on
  // the same `?view=mine` page the row came from, which is where a linkless
  // notification can still be read in full.
  //
  // A followed link leaves the panel OPEN (objectstack#34589): the record
  // lands in the page beside it and the next notification is one click away.
  // On a phone the panel covers the page, so it closes there.
  const handleNotificationClick = (n: InboxNotification) =>
    openInboxNotification({ id: n.id, actionUrl: n.action_url }, hostAppSegment, {
      markRead: onMarkRead,
      goTo: leaveTo,
      openInbox: goToAllNotifications,
      beforeFollow: () => {
        if (isMobile) setOpen(false);
      },
    });

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const markGroupRead = (group: NotificationGroup) => {
    const ids = group.items.filter((n) => !n.is_read).map((n) => n.id);
    if (ids.length === 0) return;
    if (onMarkManyRead) onMarkManyRead(ids);
    else ids.forEach(onMarkRead);
  };

  // A single notification line — shared by standalone rows and the members of
  // an expanded group (which indent). Kept a render helper (not a nested
  // component) so it closes over `displayLocale`/`handleNotificationClick` without
  // remounting the subtree on every parent render.
  const renderRow = (n: InboxNotification, nested: boolean) => (
    <div className={`group flex items-stretch ${n.is_read ? '' : 'bg-accent/40'}`}>
    <button
      type="button"
      onClick={() => handleNotificationClick(n)}
      className={`min-w-0 flex-1 text-left ${nested ? 'pl-9 pr-3 py-2' : 'px-3 py-2.5'} hover:bg-accent transition-colors duration-150`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary transition-opacity duration-200 ${n.is_read ? 'opacity-0' : 'opacity-100'}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium leading-tight truncate">{n.title}</div>
          {n.body && (
            <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{n.body}</div>
          )}
          <div className="text-xs text-muted-foreground mt-1">
            {timeAgo(n.created_at, displayLocale)}
          </div>
        </div>
      </div>
    </button>
    {!n.is_read && (
      <button
        type="button"
        onClick={() => onMarkRead(n.id)}
        className={MARK_READ_ICON_CLASS}
        aria-label={t('notifications.groupMarkRead', { defaultValue: 'Mark read' }) as string}
        title={t('notifications.groupMarkRead', { defaultValue: 'Mark read' }) as string}
      >
        <Check className="h-3.5 w-3.5" aria-hidden />
      </button>
    )}
    </div>
  );

  // "Needs your action" (objectstack#34589): the pending requests, each
  // decidable in place. Rendered inside one open tab at a time, so each
  // request mounts one set of declared levers.
  const renderApprovals = () => (
    <ul className="divide-y" data-testid="inbox-approvals-list">
      {shownApprovals.map((r) => (
        <li key={r.id}>
          <InboxApprovalItem request={r} onOpen={openApproval} onDecided={handleApprovalDecided} />
        </li>
      ))}
    </ul>
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange} modal={false}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-8 w-8 max-md:size-11 relative shrink-0 ${pulse ? 'motion-safe:animate-bounce' : ''}`}
          aria-label={ariaLabel}
          title={t('sidebar.inbox', { defaultValue: 'Inbox' }) as string}
        >
          <Bell className="h-4 w-4" />
          {totalBadge > 0 && (
            <span
              key={totalBadge}
              data-testid="inbox-bell-badge"
              // Below `md` the trigger is a 44 px target that fills the 48 px
              // bar, so the badge sits inside it, on the glyph's corner, where
              // the bar's edge cannot cut it (objectstack#34596).
              className="absolute -top-0.5 -right-0.5 max-md:top-1 max-md:right-1 h-4 min-w-[16px] rounded-full bg-red-500 text-xs leading-4 text-white text-center px-1 motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:fade-in-0 motion-safe:duration-200"
            >
              {totalBadge > 9 ? '9+' : totalBadge}
            </span>
          )}
        </Button>
      </SheetTrigger>
      {/* Non-modal, no overlay, and a click in the page does not close it: the
          page beside the panel stays usable (objectstack#34589). It closes on
          its own close button, Escape, the bell, or when the record drawer
          opens. */}
      <SheetContent
        side="right"
        hideOverlay
        aria-describedby={undefined}
        onInteractOutside={(e) => e.preventDefault()}
        data-testid="inbox-panel"
        className={PANEL_CLASS}
      >
        {/* pr-12 keeps "Mark all read" clear of the panel's close button. */}
        <div className="flex items-center justify-between gap-2 pl-3 pr-12 pt-3 pb-1 max-sm:pr-14">
          <SheetTitle className="text-sm font-medium">
            {t('sidebar.inbox', { defaultValue: 'Inbox' })}
          </SheetTitle>
          {tab === 'notifications' && unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllRead}
              className={`text-xs text-muted-foreground hover:text-foreground ${PHONE_TAP} max-md:px-2`}
            >
              {t('notifications.markAllRead', { defaultValue: 'Mark all read' })}
            </button>
          )}
        </div>
        {/* Badge breakdown (objectstack-ai/objectstack#7233). The bell badge is `unreadTopics +
            pendingApprovalsCount` and clamps at "9+", so the number on its own
            is unexplainable — and the two tab pills clamp at "9+" too, which
            means a loaded inbox can show three "9+"s that reconcile to nothing.
            Spell the addends out here, unclamped, so a user seeing "9+" can
            read exactly which N notifications and which M pending approvals it
            is made of (the M is the same count Home's approvals card and the
            Approvals Inbox tab show — one source, `pendingApprovalsCount`).
            The first addend names its unit — unread *topics* (objectstack#27704):
            one coalesced row reading "×3 · 3 unread" is one topic, so the line
            and the row tell one story instead of "1 notification" against "3". */}
        {totalBadge > 0 && (
          <div
            data-testid="inbox-badge-breakdown"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-2 text-xs text-muted-foreground"
          >
            <span data-testid="inbox-badge-breakdown-total" className="font-medium text-foreground">
              {t('notifications.badgeTotal', {
                defaultValue: '{{total}} total',
                total: totalBadge,
              })}
            </span>
            <span aria-hidden>·</span>
            <span data-testid="inbox-badge-breakdown-notifications">
              {t('notifications.badgeNotifications', {
                defaultValue: '{{count}} unread topics',
                count: unreadTopics,
              })}
            </span>
            <span aria-hidden>+</span>
            <span data-testid="inbox-badge-breakdown-approvals">
              {t('notifications.badgeApprovals', {
                defaultValue: '{{count}} pending approvals',
                count: pendingApprovalsCount,
              })}
            </span>
          </div>
        )}
        <Tabs value={shownTab} onValueChange={handleTabChange} className="flex min-h-0 w-full flex-1 flex-col">
          <TabsList className="w-full shrink-0 justify-start rounded-none border-b bg-transparent px-1 h-9 max-md:h-auto">
            <TabsTrigger value="notifications" className={TAB_TRIGGER_CLASS}>
              <Bell className="h-3.5 w-3.5 max-md:hidden" aria-hidden />
              {t('sidebar.notifications', { defaultValue: 'Notifications' })}
              {unreadTopics > 0 && (
                <span
                  key={`notif-${unreadTopics}`}
                  className="ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-xs text-white motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-200"
                >
                  {unreadTopics > 9 ? '9+' : unreadTopics}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="approvals" className={TAB_TRIGGER_CLASS}>
              <CheckSquare className="h-3.5 w-3.5 max-md:hidden" aria-hidden />
              {t('sidebar.approvals', { defaultValue: 'Approvals' })}
              {pendingApprovalsCount > 0 && (
                <span
                  key={`appr-${pendingApprovalsCount}`}
                  className="ml-0.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-xs text-white motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-200"
                >
                  {pendingApprovalsCount > 9 ? '9+' : pendingApprovalsCount}
                </span>
              )}
            </TabsTrigger>
            {showActivity && (
              <TabsTrigger value="activity" className={TAB_TRIGGER_CLASS}>
                <ActivityIcon className="h-3.5 w-3.5 max-md:hidden" aria-hidden />
                {t('sidebar.activityFeed', { defaultValue: 'Activity feed' })}
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="notifications" className={TAB_PANEL_CLASS}>
            {/* Unread/All sub-filter. Keeps the surface compact (matches the
                Linear / GitHub inbox pattern) without bloating the primary
                Tabs strip. */}
            <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
              <button
                type="button"
                onClick={() => setNotifFilter('unread')}
                className={`text-xs px-2 py-1 rounded-md transition-colors ${PHONE_TAP} max-md:min-w-11 max-md:px-3 ${
                  notifFilter === 'unread'
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('notifications.filterUnread', { defaultValue: 'Unread' })}
                {unreadTopics > 0 && (
                  <span className="ml-1 text-xs opacity-70">{unreadTopics}</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setNotifFilter('all')}
                className={`text-xs px-2 py-1 rounded-md transition-colors ${PHONE_TAP} max-md:min-w-11 max-md:px-3 ${
                  notifFilter === 'all'
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('notifications.filterAll', { defaultValue: 'All' })}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto" data-testid="inbox-notifications-scroll">
            {shownApprovals.length > 0 && (
              <section aria-labelledby="inbox-needs-you" data-testid="inbox-needs-you" className="border-b">
                <h3 id="inbox-needs-you" className="px-3 pt-2.5 text-xs font-medium text-muted-foreground">
                  {t('notifications.needsYou', { defaultValue: 'Needs your action' })}
                </h3>
                {renderApprovals()}
              </section>
            )}
            {(() => {
              const visible =
                notifFilter === 'unread'
                  ? notifications.filter((n) => !n.is_read)
                  : notifications;
              if (visible.length === 0) {
                return (
                  <div className="px-3 py-8 text-sm text-muted-foreground text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
                    {notifFilter === 'unread'
                      ? t('notifications.emptyUnread', { defaultValue: "You're all caught up" })
                      : t('notifications.empty', { defaultValue: 'No notifications' })}
                  </div>
                );
              }
              const groups = groupNotifications(visible);
              return (
                <ul className="divide-y">
                  {groups.map((group, idx) => {
                    const animation = {
                      className:
                        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200',
                      style: { animationDelay: `${Math.min(idx, 6) * 20}ms` },
                    };
                    // A group of one is just a row — no count pill, no chevron.
                    if (group.items.length === 1) {
                      return (
                        <li key={group.key} {...animation}>
                          {renderRow(group.items[0], false)}
                        </li>
                      );
                    }
                    const isExpanded = expandedGroups.has(group.key);
                    return (
                      <li key={group.key} {...animation}>
                        <div className={`group flex items-stretch ${group.unreadCount > 0 ? 'bg-accent/40' : ''}`}>
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.key)}
                            aria-expanded={isExpanded}
                            className="flex-1 min-w-0 text-left px-3 py-2.5 hover:bg-accent transition-colors duration-150"
                          >
                            <div className="flex items-start gap-2">
                              <span
                                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary transition-opacity duration-200 ${group.unreadCount > 0 ? 'opacity-100' : 'opacity-0'}`}
                                aria-hidden
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-sm font-medium leading-tight truncate">
                                    {group.title}
                                  </span>
                                  <span
                                    className="shrink-0 rounded-full bg-muted px-1.5 text-xs font-medium leading-4 text-muted-foreground"
                                    aria-label={
                                      t('notifications.groupCount', {
                                        defaultValue: '{{count}} notifications',
                                        count: group.items.length,
                                      }) as string
                                    }
                                  >
                                    ×{group.items.length}
                                  </span>
                                </div>
                                {group.items[0].body && (
                                  <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                                    {group.items[0].body}
                                  </div>
                                )}
                                <div className="text-xs text-muted-foreground mt-1">
                                  {timeAgo(group.latestCreatedAt, displayLocale)}
                                  {group.unreadCount > 0 && (
                                    <span className="ml-1">
                                      ·{' '}
                                      {t('notifications.groupUnread', {
                                        defaultValue: '{{count}} unread',
                                        count: group.unreadCount,
                                      })}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <ChevronRight
                                className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                                aria-hidden
                              />
                            </div>
                          </button>
                          {group.unreadCount > 0 && (
                            <button
                              type="button"
                              onClick={() => markGroupRead(group)}
                              className={MARK_READ_ICON_CLASS}
                              aria-label={
                                t('notifications.groupMarkReadTitle', {
                                  defaultValue: 'Mark all of this type read',
                                }) as string
                              }
                              title={
                                t('notifications.groupMarkReadTitle', {
                                  defaultValue: 'Mark all of this type read',
                                }) as string
                              }
                            >
                              <Check className="h-3.5 w-3.5" aria-hidden />
                            </button>
                          )}
                        </div>
                        {isExpanded && (
                          <ul className="divide-y border-t bg-muted/20">
                            {group.items.map((n) => (
                              <li key={n.id}>{renderRow(n, true)}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              );
            })()}
            </div>
            {/* Footer link to the dedicated /sys_inbox_message list, pinned
                under the scrolling rows. The panel only shows the 20
                most-recent rows; users need a path to the full inbox for bulk
                operations and older history. */}
            <div className="shrink-0 border-t px-3 py-2 text-center">
              <button
                type="button"
                onClick={goToAllNotifications}
                className={`text-xs text-primary hover:underline ${PHONE_TAP} max-md:w-full`}
              >
                {t('notifications.viewAll', { defaultValue: 'View all notifications' })}
              </button>
            </div>
          </TabsContent>

          <TabsContent value="approvals" className={`${TAB_PANEL_CLASS} overflow-auto`}>
            {shownApprovals.length > 0 && renderApprovals()}
            <div className="px-3 py-6 text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
              {pendingApprovalsCount > 0 ? (
                <>
                  <CheckSquare className="mx-auto h-6 w-6 text-amber-500 motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-300" />
                  <div className="mt-2 text-sm font-medium">
                    {t('notifications.approvalsPending', {
                      defaultValue: '{{count}} pending approvals',
                      count: pendingApprovalsCount,
                    })}
                  </div>
                  <Button size="sm" className={`mt-3 ${PHONE_TAP}`} onClick={goToApprovals}>
                    {t('notifications.viewApprovals', { defaultValue: 'View approvals' })}
                  </Button>
                </>
              ) : (
                <>
                  <div className="text-sm text-muted-foreground">
                    {t('notifications.noPendingApprovals', {
                      defaultValue: 'No pending approvals',
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={goToApprovals}
                    className={`mt-2 text-xs text-primary hover:underline ${PHONE_TAP} max-md:px-3`}
                  >
                    {t('notifications.openApprovalsInbox', { defaultValue: 'Open Approvals Inbox' })}
                  </button>
                </>
              )}
            </div>
          </TabsContent>

          {showActivity && (
            <TabsContent value="activity" className={TAB_PANEL_CLASS}>
              {/*
                "No recent activity" is an ASSERTION about the feed, so it is made
                only once the feed has answered (objectui#12081, the #4235 rule).
                An unanswered read says so instead — and beside the list, not
                only in place of it, so stale rows never pass for a fresh answer.
              */}
              {activity.status !== 'ready' && (
                <div
                  className="flex items-center justify-center gap-2 px-3 py-3 text-sm text-muted-foreground"
                  data-testid="inbox-activity-unanswered"
                >
                  {activity.status === 'error' && activity.refused ? (
                    // A refused read (the feed's `isRefusedFeedRead` verdict)
                    // says so with Home's lock and sentence (objectui#12859);
                    // every other failure keeps the generic copy.
                    <span className="flex items-center gap-2" data-testid="inbox-activity-access-denied">
                      <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {t('layout.activityFeed.accessDenied', {
                        defaultValue: "You don't have permission to view activity.",
                      })}
                    </span>
                  ) : activity.status === 'error' ? (
                    <>
                      <CircleAlert className="h-4 w-4 text-amber-500" />
                      {t('errors.unknown', { defaultValue: 'An unexpected error occurred.' })}
                    </>
                  ) : (
                    t('common.loading', { defaultValue: 'Loading…' })
                  )}
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-auto">
              {activity.value.length === 0 ? (
                activity.status === 'ready' && (
                  <div className="px-3 py-8 text-sm text-muted-foreground text-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
                    {t('layout.activityFeed.empty', { defaultValue: 'No recent activity' })}
                  </div>
                )
              ) : (
                <ul className="divide-y">
                  {activity.value.slice(0, 20).map((a, idx) => (
                    <li
                      key={a.id}
                      className="px-3 py-2.5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200"
                      style={{ animationDelay: `${Math.min(idx, 6) * 20}ms` }}
                    >
                      <div className="text-sm leading-tight truncate">
                        <span className="font-medium">{a.user}</span>{' '}
                        <span className="text-muted-foreground">{a.description}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {timeAgo(a.timestamp, displayLocale)} · <ActivityObjectLabel objectName={a.objectName} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              </div>
              {/* Footer link to dedicated /sys_activity list. Symmetric with
                  the Notifications tab footer — the popover caps at 20 rows;
                  users need a path to the full activity stream. Rendered even
                  in the empty state so users can still browse historical data. */}
              <div className="shrink-0 border-t px-3 py-2 text-center">
                <button
                  type="button"
                  onClick={goToAllActivity}
                  className={`text-xs text-primary hover:underline ${PHONE_TAP} max-md:w-full`}
                >
                  {t('layout.activityFeed.viewAll', { defaultValue: 'View all activity' })}
                </button>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
