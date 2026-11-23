// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The full-page inbox (objectstack#36741, under epic objectstack#36107): from
 * 768 px up the sidebar's bell opens this page instead of the right-hand
 * panel. A list on the left, the selected item on the right, three tabs —
 * Notifications, Approvals, Activity — in the current app's shell, at an
 * address that can be bookmarked and that the browser's Back leaves.
 *
 * The data and its rules are the bell's, unchanged: the same shared feeds,
 * the same `(topic, title)` coalescing, the same badge counts, the same
 * mark-read writes, the requests' own declared decision actions. What the
 * page adds is room: a longer list (older notifications page in beneath the
 * shared window, and a full page of waiting requests)
 * and the item drawn whole beside it (`InboxPageDetail`).
 *
 * Selecting a notification marks it read («看过自动标已读»). A decision taken
 * in the right pane moves the selection to the next request («处理完自动选下一
 * 条»). J / K move through the list.
 *
 * @module
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, cn, useIsMobile } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useAuth } from '@object-ui/auth';
import { Activity as ActivityIcon, Bell, CheckSquare, Lock } from 'lucide-react';
import { useInboxBell, postInboxReadReceipts } from '../../hooks/useInboxBell.js';
import {
  SHARED_INBOX_WINDOW,
  readEarlierInboxMessages,
  refreshSharedInbox,
  useSharedActivityFeed,
} from '../../hooks/sharedUserFeeds.js';
import { useMetadata } from '../../providers/MetadataProvider.js';
import { useAdapter } from '../../providers/AdapterProvider.js';
import { useServedAppLabel } from '../../hooks/useServedAppLabel.js';
import { matchAppBySegment, resolveHostAppSegment, resolveNotificationTarget } from '../../utils/appRoute.js';
import { objectHostAppSegment, type ObjectHostApp } from '../../utils/objectHostApp.js';
import { groupNotifications, type InboxNotification } from '../../layout/inboxGrouping.js';
import { approvalRequestTitle } from '../../layout/InboxApprovalItem.js';
import { ActivityObjectLabel } from '../../layout/ActivityObjectLabel.js';
import { confirmUnsavedLeave } from '../../chrome/unsavedEdits.js';
import {
  INBOX_ITEM_PARAM,
  INBOX_PAGE_TABS,
  inboxPagePath,
  inboxTabFromSegment,
  isTypingTarget,
  notificationSubject,
  selectionAfterLeaving,
  stepSelection,
  type InboxPageTab,
} from './inboxPageModel.js';
import { useInboxPageApprovals } from './useInboxPageApprovals.js';
import { InboxListNote, InboxListRow } from './InboxPageList.js';
import {
  APPROVAL_REQUEST_OBJECT,
  InboxDetailEmpty,
  InboxDetailHeader,
  InboxEmbeddedRecord,
  InboxGroupOccurrences,
} from './InboxPageDetail.js';

export interface InboxPageProps {
  dataSource: unknown;
  objects: unknown[];
}

/** One page of older notifications per «Load earlier». */
const EARLIER_PAGE = 50;

const NO_IDS: ReadonlySet<string> = new Set<string>();

export function InboxPage({ dataSource, objects }: InboxPageProps) {
  const { t } = useObjectTranslation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { appName, inboxTab } = useParams<{ appName?: string; inboxTab?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { apps } = useMetadata();
  const { appLabel } = useServedAppLabel();
  const adapter = useAdapter();
  const { user } = useAuth();
  const tab = inboxTabFromSegment(inboxTab);
  const selectedId = searchParams.get(INBOX_ITEM_PARAM);
  const appSegment = resolveHostAppSegment(apps, appName);

  const bell = useInboxBell();
  const activity = useSharedActivityFeed({ enabled: true });
  const approvals = useInboxPageApprovals(bell.pendingApprovalsCount);
  const [unreadOnly, setUnreadOnly] = useState(true);

  // ── Notifications: the shared window, then older pages beneath it ──────
  const [earlier, setEarlier] = useState<{ rows: InboxNotification[]; loading: boolean; done: boolean; failed: boolean }>(
    { rows: [], loading: false, done: false, failed: false },
  );
  const [earlierRead, setEarlierRead] = useState<ReadonlySet<string>>(NO_IDS);
  // Rows read on this visit stay listed under «Unread only» until the user
  // leaves, so the row being read does not vanish from under the pointer.
  const [readHere, setReadHere] = useState<ReadonlySet<string>>(NO_IDS);
  const allNotifications = useMemo(() => {
    const seen = new Set(bell.notifications.map((n) => n.id));
    const older = earlier.rows
      .filter((n) => !seen.has(n.id))
      .map((n) => (earlierRead.has(n.id) ? { ...n, is_read: true } : n));
    return [...bell.notifications, ...older];
  }, [bell.notifications, earlier.rows, earlierRead]);
  const unreadTopics = useMemo(
    () => groupNotifications(bell.notifications).filter((g) => g.unreadCount > 0).length,
    [bell.notifications],
  );
  const groups = useMemo(() => {
    const shown = unreadOnly ? allNotifications.filter((n) => !n.is_read || readHere.has(n.id)) : allNotifications;
    return groupNotifications(shown);
  }, [allNotifications, unreadOnly, readHere]);
  const canLoadEarlier = !earlier.done && bell.notifications.length >= SHARED_INBOX_WINDOW;
  const loadEarlier = useCallback(() => {
    const userId = user?.id;
    if (!userId || earlier.loading) return;
    setEarlier((prev) => ({ ...prev, loading: true, failed: false }));
    const skip = SHARED_INBOX_WINDOW + earlier.rows.length;
    readEarlierInboxMessages(adapter as never, userId, skip, EARLIER_PAGE).then(
      (rows) => setEarlier((prev) => ({ rows: [...prev.rows, ...rows], loading: false, done: rows.length < EARLIER_PAGE, failed: false })),
      () => setEarlier((prev) => ({ ...prev, loading: false, failed: true })),
    );
  }, [adapter, user?.id, earlier.loading, earlier.rows.length]);

  const markNotificationsRead = useCallback(
    (rows: readonly InboxNotification[]) => {
      const unread = rows.filter((n) => !n.is_read);
      if (unread.length === 0) return;
      const ids = unread.map((n) => n.id);
      setReadHere((prev) => new Set([...prev, ...ids]));
      const inWindow = new Set(bell.notifications.map((n) => n.id));
      const shared = ids.filter((id) => inWindow.has(id));
      const older = unread.filter((n) => !inWindow.has(n.id));
      const writes: Promise<unknown>[] = [];
      if (shared.length > 0) writes.push(bell.markManyRead(shared));
      if (older.length > 0) {
        setEarlierRead((prev) => new Set([...prev, ...older.map((n) => n.id)]));
        const nids = older.map((n) => n.notification_id).filter((v): v is string => !!v);
        if (nids.length > 0) writes.push(postInboxReadReceipts('read', nids).catch(() => undefined));
      }
      // The sidebar's bell reads the same feed: re-read it once the receipts land.
      void Promise.all(writes).then(refreshSharedInbox, refreshSharedInbox);
    },
    [bell],
  );
  const markAllRead = useCallback(() => {
    setReadHere((prev) => new Set([...prev, ...allNotifications.filter((n) => !n.is_read).map((n) => n.id)]));
    setEarlierRead(new Set(earlier.rows.map((n) => n.id)));
    void bell.markAllRead().then(refreshSharedInbox, refreshSharedInbox);
  }, [allNotifications, bell, earlier.rows]);

  // ── The current tab's rows, as ids in list order ─────────────────────────
  const approvalRows = approvals.requests;
  const activityRows = activity.readable ? activity.value : [];
  const ids = useMemo(() => {
    if (tab === 'approvals') return approvalRows.map((r) => r.id);
    if (tab === 'activity') return activityRows.map((a) => a.id);
    return groups.map((g) => g.items[0].id);
  }, [tab, approvalRows, activityRows, groups]);
  const listAnswered =
    tab === 'approvals' ? approvals.status !== 'loading' : tab === 'activity' ? activity.status !== 'idle' && activity.status !== 'loading' : bell.status !== 'idle' && bell.status !== 'loading';

  const select = useCallback(
    (id: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set(INBOX_ITEM_PARAM, id);
          else next.delete(INBOX_ITEM_PARAM);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Keep a row selected on the desktop: the first one on arrival, and the
  // next one when the selected row leaves the list (a request decided). A
  // phone shows the list until a row is picked.
  const previousIds = useRef<{ tab: InboxPageTab; ids: readonly string[] }>({ tab, ids });
  useEffect(() => {
    const prev = previousIds.current;
    previousIds.current = { tab, ids };
    if (!listAnswered) return;
    if (selectedId && ids.includes(selectedId)) return;
    // A notification selected by a member id of its coalesced row stays put.
    if (selectedId && tab === 'notifications' && groups.some((g) => g.items.some((n) => n.id === selectedId))) return;
    if (selectedId && prev.tab === tab && prev.ids.includes(selectedId)) {
      select(selectionAfterLeaving(prev.ids, selectedId, ids));
      return;
    }
    if (!isMobile && !selectedId && ids.length > 0) select(ids[0]);
  }, [tab, ids, selectedId, listAnswered, groups, isMobile, select]);

  // J / K move through the list, as on the approvals queue and the record pages.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target) || document.querySelector('[role="dialog"],[role="alertdialog"]')) return;
      const key = e.key.toLowerCase();
      if (key !== 'j' && key !== 'k') return;
      const next = stepSelection(ids, selectedId, key === 'j' ? 1 : -1);
      if (next && next !== selectedId) {
        e.preventDefault();
        select(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ids, selectedId, select]);

  const selectedGroup =
    tab === 'notifications' ? groups.find((g) => g.items.some((n) => n.id === selectedId)) : undefined;
  useEffect(() => {
    if (selectedGroup) markNotificationsRead(selectedGroup.items);
    // Marked once per selection, not again when the overlay redraws it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup?.key, selectedGroup?.unreadCount]);

  // ── Leaving the page ─────────────────────────────────────────────────────
  const leaveTo = useCallback((to: string) => confirmUnsavedLeave(() => navigate(to)), [navigate]);
  const goTab = (next: InboxPageTab) => navigate(inboxPagePath(appName ?? appSegment, next), { replace: true });
  const approvalsCenterPath = `/apps/${appSegment}/system/approvals`;
  const openApproval = (requestId: string) =>
    leaveTo(`${approvalsCenterPath}?request=${encodeURIComponent(requestId)}`);

  // ── Where an object comes from ──────────────────────────────────────────
  const appOf = (objectName: string | null | undefined) => {
    const seg = objectHostAppSegment(apps as readonly ObjectHostApp[] | undefined, objectName, appName, { orSetup: false });
    const app = matchAppBySegment(apps as readonly ObjectHostApp[] | undefined, seg);
    return app ? appLabel(app as never) : undefined;
  };

  const counts: Record<InboxPageTab, number | undefined> = {
    notifications: unreadTopics,
    approvals: approvals.status === 'ready' ? approvals.total : bell.pendingApprovalsCount,
    activity: undefined,
  };
  const tabLabel: Record<InboxPageTab, string> = {
    notifications: t('sidebar.notifications', { defaultValue: 'Notifications' }) as string,
    approvals: t('sidebar.approvals', { defaultValue: 'Approvals' }) as string,
    activity: t('sidebar.activityFeed', { defaultValue: 'Activity feed' }) as string,
  };
  const tabIcon = { notifications: Bell, approvals: CheckSquare, activity: ActivityIcon } as const;
  const shownTabs = INBOX_PAGE_TABS.filter((x) => x !== 'activity' || activity.readable);

  // ── The list column ──────────────────────────────────────────────────────
  const renderList = () => {
    if (tab === 'approvals') {
      if (approvalRows.length === 0) {
        return (
          <InboxListNote testId="inbox-page-approvals-empty">
            {approvals.status === 'loading'
              ? t('common.loading', { defaultValue: 'Loading…' })
              : approvals.status === 'error'
                ? t('errors.unknown', { defaultValue: 'An unexpected error occurred.' })
                : t('notifications.noPendingApprovals', { defaultValue: 'No pending approvals' })}
          </InboxListNote>
        );
      }
      return (
        <ul data-testid="inbox-page-approvals-list">
          {approvalRows.map((r) => (
            <InboxListRow
              key={r.id}
              id={r.id}
              selected={r.id === selectedId}
              unread
              app={appOf(r.row?.object_name as string | undefined)}
              kind={r.processLabel || r.processName}
              time={r.createdAt}
              title={r.recordTitle || approvalRequestTitle(r)}
              summary={typeof r.row?.submitter_name === 'string' ? r.row.submitter_name : undefined}
              onSelect={select}
            />
          ))}
          {approvals.total > approvalRows.length && (
            <li className="px-4 py-3 text-center">
              <button type="button" className="text-xs text-primary hover:underline" onClick={() => leaveTo(approvalsCenterPath)}>
                {t('inboxPage.moreApprovals', { defaultValue: 'See the rest in the Approvals inbox' })}
              </button>
            </li>
          )}
        </ul>
      );
    }
    if (tab === 'activity') {
      if (activityRows.length === 0) {
        return (
          <InboxListNote testId="inbox-page-activity-empty">
            {activity.status === 'error' && activity.refused ? (
              <span className="inline-flex items-center gap-2">
                <Lock className="h-4 w-4" aria-hidden />
                {t('layout.activityFeed.accessDenied', { defaultValue: "You don't have permission to view activity." })}
              </span>
            ) : activity.status === 'ready' ? (
              t('layout.activityFeed.empty', { defaultValue: 'No recent activity' })
            ) : activity.status === 'error' ? (
              t('errors.unknown', { defaultValue: 'An unexpected error occurred.' })
            ) : (
              t('common.loading', { defaultValue: 'Loading…' })
            )}
          </InboxListNote>
        );
      }
      return (
        <ul data-testid="inbox-page-activity-list">
          {activityRows.map((a) => (
            <InboxListRow
              key={a.id}
              id={a.id}
              selected={a.id === selectedId}
              app={appOf(a.objectName)}
              kind={<ActivityObjectLabel objectName={a.objectName} />}
              time={a.timestamp}
              title={a.user}
              summary={a.description}
              onSelect={select}
            />
          ))}
        </ul>
      );
    }
    return (
      <>
        {counts.approvals !== undefined && counts.approvals > 0 && (
          <button
            type="button"
            onClick={() => goTab('approvals')}
            data-testid="inbox-page-needs-you"
            className="mx-4 my-3 flex w-[calc(100%-2rem)] items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-left text-sm text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <span className="font-semibold">{t('notifications.needsYou', { defaultValue: 'Needs your action' })}</span>
            <span>
              {t('notifications.approvalsPending', { defaultValue: '{{count}} pending approvals', count: counts.approvals })}
            </span>
            <span className="ml-auto">{t('inboxPage.goApprove', { defaultValue: 'Review ›' })}</span>
          </button>
        )}
        {groups.length === 0 ? (
          <InboxListNote testId="inbox-page-notifications-empty">
            {bell.status === 'error'
              ? t('errors.unknown', { defaultValue: 'An unexpected error occurred.' })
              : unreadOnly
                ? t('notifications.emptyUnread', { defaultValue: "You're all caught up" })
                : t('notifications.empty', { defaultValue: 'No notifications' })}
          </InboxListNote>
        ) : (
          <ul data-testid="inbox-page-notifications-list">
            {groups.map((g) => {
              const lead = g.items[0];
              const subject = notificationSubject(lead.action_url);
              return (
                <InboxListRow
                  key={g.key}
                  id={lead.id}
                  selected={g.items.some((n) => n.id === selectedId)}
                  unread={g.unreadCount > 0}
                  app={subject?.kind === 'record' ? appOf(subject.objectName) : undefined}
                  kind={
                    subject?.kind === 'record' ? (
                      <ActivityObjectLabel objectName={subject.objectName} />
                    ) : subject?.kind === 'approval' || subject?.kind === 'approvals' ? (
                      tabLabel.approvals
                    ) : undefined
                  }
                  time={g.latestCreatedAt}
                  title={g.title}
                  summary={lead.body}
                  count={g.items.length}
                  countLabel={t('notifications.groupCount', { defaultValue: '{{count}} notifications', count: g.items.length }) as string}
                  onSelect={select}
                />
              );
            })}
          </ul>
        )}
        {(canLoadEarlier || earlier.failed) && (
          <div className="px-4 py-3 text-center">
            <Button size="sm" variant="ghost" onClick={loadEarlier} disabled={earlier.loading} data-testid="inbox-page-load-earlier">
              {earlier.failed
                ? t('inboxPage.loadEarlierFailed', { defaultValue: 'Could not load. Try again' })
                : earlier.loading
                  ? t('common.loading', { defaultValue: 'Loading…' })
                  : t('inboxPage.loadEarlier', { defaultValue: 'Load earlier notifications' })}
            </Button>
          </div>
        )}
      </>
    );
  };

  // ── The right pane ───────────────────────────────────────────────────────
  const back = isMobile ? () => select(null) : undefined;
  const renderDetail = () => {
    if (tab === 'approvals') {
      const r = approvalRows.find((x) => x.id === selectedId);
      if (!r) return <InboxDetailEmpty>{t('inboxPage.pickApproval', { defaultValue: 'Pick a request to review it here.' })}</InboxDetailEmpty>;
      return (
        <>
          <InboxDetailHeader
            meta={[appOf(r.row?.object_name as string | undefined), r.processLabel || r.processName].filter(Boolean).join(' · ')}
            title={r.recordTitle || approvalRequestTitle(r)}
            onOpenFull={() => openApproval(r.id)}
            openFullLabel={t('inboxPage.openRequest', { defaultValue: 'Open request' }) as string}
            onBack={back}
          >
            <span className="self-center text-xs text-muted-foreground max-lg:hidden">
              {t('inboxPage.nextHint', { defaultValue: 'Moves to the next once decided · J / K to move' })}
            </span>
          </InboxDetailHeader>
          <InboxEmbeddedRecord objectName={APPROVAL_REQUEST_OBJECT} recordId={r.id} dataSource={dataSource} objects={objects} />
        </>
      );
    }
    if (tab === 'activity') {
      const a = activityRows.find((x) => x.id === selectedId);
      if (!a) return <InboxDetailEmpty>{t('inboxPage.pickItem', { defaultValue: 'Pick an item to see it here.' })}</InboxDetailEmpty>;
      const host = objectHostAppSegment(apps as readonly ObjectHostApp[] | undefined, a.objectName, appName) ?? appSegment;
      return (
        <>
          <InboxDetailHeader
            meta={<><ActivityObjectLabel objectName={a.objectName} /> · {a.user}</>}
            title={a.description}
            onOpenFull={a.recordId ? () => leaveTo(`/apps/${host}/${a.objectName}/record/${encodeURIComponent(a.recordId!)}`) : undefined}
            onBack={back}
          />
          {a.recordId && (
            <InboxEmbeddedRecord objectName={a.objectName} recordId={a.recordId} dataSource={dataSource} objects={objects} />
          )}
        </>
      );
    }
    const g = selectedGroup;
    if (!g) return <InboxDetailEmpty>{t('inboxPage.pickItem', { defaultValue: 'Pick an item to see it here.' })}</InboxDetailEmpty>;
    const lead = g.items[0];
    const subject = notificationSubject(lead.action_url);
    const target = resolveNotificationTarget(
      lead.action_url,
      subject?.kind === 'record'
        ? (objectHostAppSegment(apps as readonly ObjectHostApp[] | undefined, subject.objectName, appName) ?? appSegment)
        : appSegment,
    );
    const openFull = target
      ? () => (target.kind === 'external' ? window.open(target.url, '_blank', 'noopener,noreferrer') : leaveTo(target.path))
      : undefined;
    return (
      <>
        <InboxDetailHeader
          meta={
            subject?.kind === 'record' ? (
              <>
                {appOf(subject.objectName) ? `${appOf(subject.objectName)} · ` : ''}
                <ActivityObjectLabel objectName={subject.objectName} />
              </>
            ) : (
              tabLabel.notifications
            )
          }
          title={g.title}
          body={g.items.length > 1 ? undefined : lead.body}
          onOpenFull={subject?.kind === 'approval' ? () => openApproval(subject.requestId) : openFull}
          openFullLabel={
            subject?.kind === 'record'
              ? undefined
              : (t('inboxPage.openLink', { defaultValue: 'Open' }) as string)
          }
          onBack={back}
        >
          {subject?.kind === 'approvals' && (
            <Button size="sm" onClick={() => goTab('approvals')}>
              {t('notifications.viewApprovals', { defaultValue: 'View approvals' })}
            </Button>
          )}
        </InboxDetailHeader>
        {g.items.length > 1 && <InboxGroupOccurrences items={g.items} />}
        {subject?.kind === 'record' && (
          <InboxEmbeddedRecord objectName={subject.objectName} recordId={subject.recordId} dataSource={dataSource} objects={objects} />
        )}
        {subject?.kind === 'approval' && (
          <InboxEmbeddedRecord objectName={APPROVAL_REQUEST_OBJECT} recordId={subject.requestId} dataSource={dataSource} objects={objects} />
        )}
      </>
    );
  };

  const detailShown = !isMobile || !!selectedId;
  const listShown = !isMobile || !selectedId;
  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="inbox-page" data-inbox-tab={tab}>
      <header className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b px-4 pt-3 md:px-6">
        <h1 className="pb-2.5 text-lg font-semibold">{t('sidebar.inbox', { defaultValue: 'Inbox' })}</h1>
        <div role="tablist" aria-label={t('sidebar.inbox', { defaultValue: 'Inbox' }) as string} className="flex gap-1">
          {shownTabs.map((x) => {
            const Icon = tabIcon[x];
            const count = counts[x];
            return (
              <button
                key={x}
                type="button"
                role="tab"
                aria-selected={tab === x}
                data-testid={`inbox-page-tab-${x}`}
                onClick={() => goTab(x)}
                className={cn(
                  'flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm max-md:min-h-11',
                  tab === x ? 'border-foreground font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5 max-md:hidden" aria-hidden />
                {tabLabel[x]}
                {count !== undefined && count > 0 && (
                  <span
                    data-testid={`inbox-page-tab-count-${x}`}
                    className={cn(
                      'rounded-full px-1.5 text-xs leading-5',
                      x === 'approvals' ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100' : 'bg-muted text-foreground',
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 pb-2">
          {tab === 'notifications' && (
            <>
              <Button
                size="sm"
                variant={unreadOnly ? 'secondary' : 'outline'}
                aria-pressed={unreadOnly}
                onClick={() => setUnreadOnly((v) => !v)}
                data-testid="inbox-page-unread-only"
              >
                {t('inboxPage.unreadOnly', { defaultValue: 'Unread only' })}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={markAllRead}
                disabled={!allNotifications.some((n) => !n.is_read)}
                data-testid="inbox-page-mark-all-read"
              >
                {t('notifications.markAllRead', { defaultValue: 'Mark all read' })}
              </Button>
            </>
          )}
          {tab === 'approvals' && (
            <Button size="sm" variant="outline" onClick={() => leaveTo(approvalsCenterPath)} data-testid="inbox-page-approvals-center">
              {t('inboxPage.allApprovals', { defaultValue: 'All approvals' })}
            </Button>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {listShown && (
          <section
            aria-label={tabLabel[tab]}
            className="min-h-0 w-full shrink-0 overflow-y-auto border-r md:w-[360px] lg:w-[400px]"
            data-testid="inbox-page-list"
          >
            {renderList()}
          </section>
        )}
        {detailShown && (
          <section className="min-h-0 min-w-0 flex-1 overflow-y-auto" data-testid="inbox-page-detail">
            {renderDetail()}
          </section>
        )}
      </div>
    </div>
  );
}

