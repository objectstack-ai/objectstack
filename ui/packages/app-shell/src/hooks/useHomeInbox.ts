/**
 * useHomeInbox
 *
 * The inbox streams the Home work-dashboard surfaces:
 *   - pendingApprovalsCount — items waiting on the user (REST endpoint)
 *   - notifications         — latest in-app inbox messages (assignments/@mentions)
 *   - activity              — recent human activity feed (sys_activity), with
 *                             its status and the caller's read grant
 *
 * A deployment without the approvals plugin, the inbox pipeline or a
 * `sys_activity` object still renders Home: a MISSING object (404 /
 * `OBJECT_NOT_FOUND`) is an answer — this deployment has no inbox, so nothing is
 * waiting — and degrades to empty, exactly as `sharedUserFeeds.markUnavailable`
 * treats its own feeds.
 *
 * Every OTHER failure is NOT an answer, and `notificationsStatus` is what says
 * so (#4235). This hook used to swallow all of them to `[]`, which handed the
 * Home action centre the empty array and nothing else — so a denial arrived
 * wearing the shape of good news and the panel said "You're all caught up".
 * Measured, that is not hypothetical: objectstack#7344 recorded every non-admin
 * session taking `403 PERMISSION_DENIED` on this exact read
 * (`operation 'find' on object 'sys_inbox_message' is not permitted for
 * positions [org_member, contributor, finance, everyone]`) while
 * `/api/v1/notifications` — a projection of the very same rows — answered with
 * their unread messages. Admin sessions read the rows and saw the card work.
 * One build, one console pin, opposite screenshots, decided by who was signed in.
 *
 * The vocabulary is `MetadataProvider`'s per-type status, deliberately — see
 * #4300, which fixed the same class ("an unloadable app list is UNKNOWN, not
 * 'no default app'") and ruled one source of truth, no second dialect.
 *
 * NOTHING is fetched here (#4197, #4225). All three streams come from
 * `sharedUserFeeds`, which the top-bar bell reads too — on `/home` the bell and
 * these cards mount in one tree, so two owners meant the same read went out
 * twice per page. One fetch now feeds both, which is also what makes the bell's
 * badge and this card structurally incapable of showing different numbers.
 *
 * The inbox list was the last hold-out (#4225) and its own read carried the
 * #4316 defect: it queried `sys_inbox_message` alone, never joining
 * `sys_notification_receipt`, so it could not tell a read message from an
 * unread one and listed the five most recent unconditionally. A user who had
 * just read all nine in the bell came back to Home and found up to five of them
 * still filed under "Needs your attention", badged — while the bell two hundred
 * pixels above correctly showed zero. Read-state is not on the message row;
 * ADR-0030 resolved decision 2 puts it in the receipt, per recipient×channel.
 *
 * Both surfaces now cut from the shared feed's already-joined superset: the
 * bell lists all 20 and badges its unread topics, this card takes the UNREAD
 * ones newest-first and caps them at `limit`. The two cannot disagree about a
 * row's read-state because there is no second read left to drift.
 *
 * That left HOW MANY (#4329). The card's badge counted the list it renders, so
 * the cap leaked into it: nine unread read as "9" on the bell and "5" here.
 * `unreadTopicCount` is the count of the whole unread set, folded the way the
 * bell folds it — the list stays a capped preview, and the badge stops
 * reporting a preview's size as a total.
 *
 * @module
 */
import { useMemo } from 'react';
import { useAuth } from '@object-ui/auth';
import { usePermissions } from '@object-ui/permissions';
import {
  useHumanActivityFeed,
  useSharedInboxFeed,
  useSharedPendingApprovalRequests,
  type ActivityFeedReading,
  type PendingApprovalRequest,
  type SharedFeedStatus,
} from './sharedUserFeeds.js';
import { groupNotifications } from '../layout/inboxGrouping.js';

export interface HomeNotification {
  id: string;
  title: string;
  actionUrl?: string;
  createdAt?: string;
}

/**
 * Whether `notifications` is an ANSWER about the user's inbox.
 *
 *  - `idle`    — not asked yet (no adapter, or no signed-in user).
 *  - `loading` — asked, still in flight.
 *  - `ready`   — the read answered. `notifications` is that answer, and only
 *                here does an empty array mean the inbox is genuinely empty.
 *  - `error`   — the read failed (denied, unreachable, malformed). The empty
 *                array is the absence of an answer, not an empty inbox.
 *
 * Same four words as `MetadataTypeStatus` (`providers/MetadataProvider`) and
 * `SharedFeedStatus` (`sharedUserFeeds`), on purpose: #4300 ruled one status
 * dialect for this exact question, and #4225 made the store speak it too
 * rather than adding a second dialect beside it. This is now that store's
 * status, passed through — a failed inbox read reaches this card as `error`
 * instead of being swallowed into stale-but-`ready` data.
 */
export type HomeInboxStatus = 'idle' | 'loading' | 'ready' | 'error';

/** The inbox object the notifications column reads, through the shared feed. */
const INBOX_OBJECT = 'sys_inbox_message';

export type { PendingApprovalRequest };

export interface HomeInboxData {
  pendingApprovalsCount: number;
  /**
   * The first `limit` approval requests waiting on the user, newest first as
   * the endpoint serves them (objectui#12602) — the PREVIEW of
   * `pendingApprovalsCount`, which is the read's `total` (objectui#13027).
   */
  pendingApprovals: PendingApprovalRequest[];
  /**
   * Whether this caller has an approvals inbox to read at all
   * (objectui#12602): the endpoint answers every signed-in user about their
   * own requests, so it is `false` only when nobody is signed in — the feed
   * then asks nothing.
   */
  pendingApprovalsReadable: boolean;
  /**
   * Whether `pendingApprovalsCount` is an answer (objectui#12601) — the
   * approvals feed's own status, passed through as `notificationsStatus` is
   * for the inbox. Only `ready` is one; a surface that states the count as a
   * fact ("Nothing is waiting for you today") states it only then.
   */
  pendingApprovalsStatus: SharedFeedStatus;
  notifications: HomeNotification[];
  /**
   * How many distinct unread TOPICS are waiting — the whole unread set, not the
   * `limit`-capped slice `notifications` renders (#4329).
   *
   * `notifications` is a PREVIEW: newest-first, one row per title, five of
   * them. Counting it badged the size of that preview as if it were the total,
   * so nine unread messages read as "9" on the bell and "5" on the card two
   * hundred pixels below — one page, one question, two numbers.
   *
   * Deliberately the bell's own fold (`groupNotifications`, by `(topic,
   * title)`) over the bell's own rows, rather than the pre-slice length of the
   * list above: that length is title-folded and drops blank titles, so it
   * agrees with the bell on ordinary data and disagrees when two topics share a
   * title. "Agrees usually" between two derivations of one number is exactly
   * what #4316 was; one fold, applied twice, cannot drift.
   */
  unreadTopicCount: number;
  /** Whether `notifications` is an answer — see {@link HomeInboxStatus}. */
  notificationsStatus: HomeInboxStatus;
  /**
   * Whether this caller may read the inbox at all (objectui#12602): `false`
   * only when the LOADED permissions refuse read on `sys_inbox_message`, the
   * predicate the activity feed applies to `sys_activity` (objectui#12081).
   * Unknown permissions read `true`. A surface renders no notifications widget
   * for `false` — no empty claim, and no link into a list that answers `403`.
   */
  notificationsReadable: boolean;
  /**
   * Home's cut of the activity feed, with its status and whether the caller
   * may read the feed at all (objectui#12081). The rows and the status travel
   * together for the reason `notificationsStatus` exists: rows alone made a
   * refused `sys_activity` read indistinguishable from an empty feed, and the
   * card said "No recent activity" to every non-admin.
   */
  activity: ActivityFeedReading;
}

export function useHomeInbox(limit = 5): HomeInboxData {
  // Shared with the top-bar bell — one read each, not one per consumer
  // (#4197, #4225). `useHumanActivityFeed` is Home's narrower cut of the bell's
  // activity rows: real human actions only, dropping the sys_*/ai_* churn
  // (actor "System"). `useSharedInboxFeed` is the bell's already-joined inbox
  // superset, cut here to what is actually waiting on the user.
  const { value: approvalPage, status: pendingApprovalsStatus } = useSharedPendingApprovalRequests();
  // The count is the page's `total` — the number the bell badges, from the
  // same one read (objectui#12602). Not the rows' length: the read asks for
  // one page, so the rows are a preview of it (objectui#13027).
  const pendingApprovalsCount = approvalPage.total;
  const approvalRequests = approvalPage.requests;
  const pendingApprovals = useMemo(() => approvalRequests.slice(0, limit), [approvalRequests, limit]);
  const { user } = useAuth();
  const perms = usePermissions();
  const notificationsReadable = !perms.isLoaded || perms.can(INBOX_OBJECT, 'read');
  const activity = useHumanActivityFeed(limit);
  const { value: messages, status: notificationsStatus } = useSharedInboxFeed();

  const notifications = useMemo<HomeNotification[]>(() => {
    const seenTitles = new Set<string>();
    return messages
      // #4316: "Needs your attention" means UNREAD. Read-state comes from the
      // receipts join in the shared feed — the read this hook used to issue
      // had none, so an already-read message was indistinguishable from a
      // waiting one and got listed and badged all the same.
      .filter((m) => !m.is_read)
      .filter((m) => (m.title ?? '').trim().length > 0)
      .map((m) => ({
        id: m.id,
        title: String(m.title),
        actionUrl: m.action_url ?? undefined,
        createdAt: m.created_at ?? undefined,
      }))
      // Collapse repeated identical notifications (e.g. recurring digests)
      // — keep the most recent of each title (rows are newest-first).
      .filter((n) => (seenTitles.has(n.title) ? false : (seenTitles.add(n.title), true)))
      // The cap is applied here rather than as the read's `$top`, because the
      // read is the bell's now and holds its 20. Same shape as `activities`,
      // which has sliced the shared feed at its own call site since #4197.
      .slice(0, limit);
  }, [messages, limit]);

  // The badge's inbox addend — see {@link HomeInboxData.unreadTopicCount}. Same
  // rows, same fold, same reduce as the bell's `unreadTopics`, so the number
  // Home shows is the number the bell shows by construction rather than by
  // coincidence. Note it is NOT `notifications.length`: that is the preview.
  const unreadTopicCount = useMemo(
    () => groupNotifications(messages).reduce((n, g) => n + (g.unreadCount > 0 ? 1 : 0), 0),
    [messages],
  );

  return {
    pendingApprovalsCount,
    pendingApprovals,
    pendingApprovalsReadable: Boolean(user?.id),
    pendingApprovalsStatus,
    notifications,
    unreadTopicCount,
    notificationsStatus,
    notificationsReadable,
    activity,
  };
}
