/**
 * HomeRail
 *
 * Dashboard cards for the Home work-dashboard:
 *   - HomeActionCenter — the "My work" section: approvals waiting on the
 *     user, unread notifications, and the pending-drafts row
 *     (`HomePendingDraftsRow`) — what needs the user (objectui#12602).
 *   - HomeContinue     — recent items, compact "pick up where you left off".
 *   - HomeActivity     — recent human activity feed (ambient context).
 *
 * Each renders a graceful empty state so a quiet workspace still looks
 * intentional rather than broken.
 *
 * @module
 */
import {
  ArrowRight, Bell, Check,
  FileText, Database, LayoutDashboard, File, List, CircleAlert, Rocket, Lock,
} from 'lucide-react';
import { useDisplayLocale } from '@object-ui/i18n';
import { Button, cn } from '@object-ui/components';
import type { ActivityFeedReading } from '../../hooks/sharedUserFeeds.js';
import type { HomeInboxStatus, HomeNotification, PendingApprovalRequest } from '../../hooks/useHomeInbox.js';
import type { RecentItem } from '../../hooks/useRecentItems.js';
import type { RecentItemLabelResolver } from '../../hooks/useRecentItemLabel.js';
import { ActivityObjectLabel } from '../../layout/ActivityObjectLabel.js';
import { timeAgo } from '../../utils/relativeTime.js';
import { getIcon } from '../../utils/getIcon.js';

type TFn = (key: string, opts?: any) => string;

/** Rows a My-work column lists — a preview; its pill carries the total. */
const MY_WORK_ROWS = 3;

/** The section's count pills: 18 px, 11 px / 600 (objectui#12602). */
function CountPill({ count, primary, testId }: { count: number; primary?: boolean; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
        primary ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
      )}
    >
      {count}
    </span>
  );
}

/**
 * One 40 px row of a My-work column: a 24 px icon tile, the one-line title
 * with an ellipsis, and a 12 px muted time at the right.
 */
function WorkRow({
  icon: Icon,
  tileClass,
  label,
  meta,
  onClick,
  testId,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tileClass: string;
  label: string;
  meta?: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <li className="h-10 border-t">
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className="flex h-full w-full items-center gap-2.5 px-3 text-left text-[13px] transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
      >
        <span className={cn('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md', tileClass)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {meta && <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>}
      </button>
    </li>
  );
}

/**
 * A column's notice line: its empty line, or why it has no answer. "Nothing waiting" is an
 * ASSERTION about the source, so it is made only once the source has answered
 * (#4235): before that the column says it is loading, and after a failed read
 * it says the read failed — never the affirmative empty copy.
 */
function ColumnNotice({
  status,
  empty,
  t,
  testId,
}: {
  status: HomeInboxStatus;
  empty: string;
  t: TFn;
  testId: string;
}) {
  return (
    <div
      className="flex h-10 items-center gap-2 border-t px-3 text-[13px] text-muted-foreground"
      data-testid={testId}
      data-status={status}
    >
      {status === 'ready' ? (
        empty
      ) : status === 'error' ? (
        <>
          <CircleAlert className="h-4 w-4 text-amber-500" />
          {t('errors.unknown', { defaultValue: 'An unexpected error occurred.' })}
        </>
      ) : (
        t('common.loading', { defaultValue: 'Loading…' })
      )}
    </div>
  );
}

/**
 * A column's rows and, where it owes one, its notice line.
 *
 * Rendered ALONGSIDE the rows, not only instead of them: when the source has
 * rows in hand and its next read failed, the column is showing a stale
 * answer, and saying so is the same honesty the empty case owes (#4225). The
 * empty line is gated on the TOTAL, not on the rows on show: an unread
 * message with no title cannot be listed, and the column must not call the
 * inbox empty while the bell badges it.
 */
function ColumnBody({
  rows,
  total,
  status,
  empty,
  t,
  testId,
}: {
  rows: React.ReactNode[];
  total: number;
  status: HomeInboxStatus;
  empty: string;
  t: TFn;
  testId: string;
}) {
  const notice =
    status !== 'ready' || (rows.length === 0 && total === 0) ? (
      <ColumnNotice status={status} empty={empty} t={t} testId={testId} />
    ) : null;
  return (
    <>
      {rows.length > 0 && <ul>{rows}</ul>}
      {notice}
    </>
  );
}

/** A My-work column: an 8 px-radius card with a 40 px header and its rows. */
function WorkColumn({
  title,
  count,
  primaryPill,
  onViewAll,
  t,
  testId,
  children,
}: {
  title: string;
  count: number;
  primaryPill?: boolean;
  onViewAll: () => void;
  t: TFn;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border bg-card" data-testid={testId}>
      <div className="flex h-10 items-center justify-between gap-2 px-3">
        <h3 className="inline-flex min-w-0 items-center gap-2 text-[13px] font-semibold">
          <span className="truncate">{title}</span>
          {count > 0 && <CountPill count={count} primary={primaryPill} testId={`${testId}-count`} />}
        </h3>
        <button
          type="button"
          onClick={onViewAll}
          data-testid={`${testId}-view-all`}
          className="shrink-0 text-xs text-primary hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {t('home.myWork.viewAll', { defaultValue: 'View all' })}
        </button>
      </div>
      {children}
    </section>
  );
}

/**
 * The pending-drafts row of the My-work section (objectui#12602), in place of
 * the full-width banner that sat above the greeting: one 40 px row on the
 * soft primary tint — the count, the first draft names and their package, and
 * a 28 px "Publish" button that runs the publish the banner ran
 * (`usePublishAllDrafts`, handed in as `onPublish`).
 */
export function HomePendingDraftsRow({
  count,
  names,
  packageName,
  publishing,
  onPublish,
  t,
}: {
  count: number;
  /** The first draft names to list — the caller caps them. */
  names: string[];
  /**
   * The name of the package every listed draft belongs to, when they share
   * one: the name Studio shows for it, not its id (objectui#13136).
   */
  packageName?: string;
  publishing: boolean;
  onPublish: () => void;
  t: TFn;
}) {
  const joined = names.join(t('home.pendingDrafts.nameSeparator', { defaultValue: ', ' }));
  const detail = !joined
    ? undefined
    : packageName
      ? t('home.pendingDrafts.inPackage', {
          names: joined,
          package: packageName,
          defaultValue: '{{names}} waiting to publish in {{package}}',
        })
      : t('home.pendingDrafts.waiting', { names: joined, defaultValue: '{{names}} waiting to publish' });
  return (
    <div
      className="flex h-10 items-center gap-2.5 rounded-lg border border-primary/35 bg-primary/5 px-3 dark:bg-primary/10"
      data-testid="home-pending-drafts"
    >
      <Rocket className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1 truncate text-[13px]">
        <span className="font-semibold">
          {t('home.pendingDrafts.title', { count, defaultValue: '{{count}} unpublished change(s)' })}
        </span>
        {detail && <span className="text-muted-foreground"> · {detail}</span>}
      </p>
      <Button
        size="sm"
        className="h-7 shrink-0 px-3 text-xs"
        onClick={onPublish}
        disabled={publishing}
        data-testid="pending-drafts-publish"
      >
        {publishing
          ? t('home.pendingDrafts.publishing', { defaultValue: 'Publishing…' })
          : t('home.pendingDrafts.cta', { defaultValue: 'Publish' })}
      </Button>
    </div>
  );
}

/**
 * Home's "My work" section (objectui#12602, section ③ of the four-part home):
 * a heading with the total and a link to the inbox, the pending-drafts row
 * when there is one, then one column per source — the approvals waiting on
 * the user first, then the unread notifications.
 *
 * ## Two columns, not three
 *
 * The design splits notifications into "Assigned to me" and "Reminders". An
 * inbox row cannot be sorted that way: `sys_inbox_message` carries a free-text
 * `topic` and a `severity`, and no declared kind that says an item was
 * assigned to the user, nor a due date that could read "overdue". So the
 * section ships the two-column form the card rules for that case — Approvals
 * and Notifications — rather than guessing a kind from a topic or a title.
 *
 * ## The numbers are the bell's
 *
 * The approvals pill is `pendingApprovalsCount`, the length of the one shared
 * approvals read the bell badges (objectui#4329); the notifications pill is
 * `unreadTopicCount`, the bell's own fold of the unread inbox. The heading's
 * total is their sum — the bell's badge. The rows are previews of those
 * totals: the first three of each.
 *
 * ## Who sees it
 *
 * A column is drawn only for a source the caller may read
 * (`pendingApprovalsReadable`, `notificationsReadable` — see `useHomeInbox`),
 * and the section renders nothing when the caller may read neither and has no
 * drafts row: no heading over an empty space, no links into pages that answer
 * `403`.
 */
export function HomeActionCenter({
  pendingApprovals,
  pendingApprovalsCount,
  pendingApprovalsStatus,
  pendingApprovalsReadable,
  notifications,
  unreadTopicCount,
  notificationsStatus,
  notificationsReadable,
  draftsRow,
  onOpenApprovals,
  onOpenApproval,
  onOpenInbox,
  onOpenNotification,
  t,
}: {
  /** The PREVIEW: the first approval requests, capped by `useHomeInbox`. */
  pendingApprovals: PendingApprovalRequest[];
  /** The TOTAL waiting — the bell's addend, not the preview's length. */
  pendingApprovalsCount: number;
  /** Whether the approvals read answered — the empty line waits for `ready`. */
  pendingApprovalsStatus: HomeInboxStatus;
  /** Whether the caller has an approvals inbox to read at all. */
  pendingApprovalsReadable: boolean;
  /** The PREVIEW: newest-first unread rows, one per title, capped by `useHomeInbox`. */
  notifications: HomeNotification[];
  /**
   * The TOTAL waiting in the inbox — every unread topic, not just the ones the
   * column has room for (#4329). Required, and separate from `notifications`,
   * so a call site cannot badge its preview's length by saying nothing.
   */
  unreadTopicCount: number;
  /**
   * Required, not optional-with-a-default: a call site that cannot say whether
   * its rows are an answer must not be able to reach the affirmative copy by
   * saying nothing.
   */
  notificationsStatus: HomeInboxStatus;
  /** Whether the caller may read the inbox at all. */
  notificationsReadable: boolean;
  /** The pending-drafts row, when there are drafts to publish. */
  draftsRow?: React.ReactNode;
  onOpenApprovals: () => void;
  onOpenApproval: (request: PendingApprovalRequest) => void;
  onOpenInbox: () => void;
  onOpenNotification: (n: HomeNotification) => void;
  t: TFn;
}) {
  // Relative times read the DISPLAY locale, never the UI language
  // (objectui#10668), as the Marketplace's and Studio home's already do.
  const displayLocale = useDisplayLocale();
  if (!pendingApprovalsReadable && !notificationsReadable && !draftsRow) return null;
  // "How much needs you" — the bell's badge, the same two addends.
  const total =
    (pendingApprovalsReadable ? pendingApprovalsCount : 0) + (notificationsReadable ? unreadTopicCount : 0);
  const columns = (pendingApprovalsReadable ? 1 : 0) + (notificationsReadable ? 1 : 0);
  return (
    <section data-testid="home-my-work" aria-labelledby="home-my-work-title">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 id="home-my-work-title" className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          {t('home.myWork.title', { defaultValue: 'My work' })}
          {total > 0 && <CountPill count={total} testId="home-my-work-count" />}
        </h2>
        {notificationsReadable && (
          <button
            type="button"
            onClick={onOpenInbox}
            data-testid="home-my-work-open-inbox"
            className="text-xs text-primary hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {t('home.myWork.openInbox', { defaultValue: 'Open inbox' })}
          </button>
        )}
      </div>
      {draftsRow && <div className={columns > 0 ? 'mb-2.5' : undefined}>{draftsRow}</div>}
      {columns > 0 && (
        <div className={cn('grid grid-cols-1 gap-3', columns === 2 && 'md:grid-cols-2')}>
          {pendingApprovalsReadable && (
            <WorkColumn
              title={t('home.myWork.approvals', { defaultValue: 'Awaiting approval' })}
              count={pendingApprovalsCount}
              primaryPill
              onViewAll={onOpenApprovals}
              t={t}
              testId="home-my-work-approvals"
            >
              <ColumnBody
                rows={pendingApprovals.slice(0, MY_WORK_ROWS).map((r) => (
                  <WorkRow
                    key={r.id}
                    icon={Check}
                    tileClass="bg-primary/10 text-primary"
                    label={approvalTitle(r)}
                    meta={r.createdAt ? timeAgo(r.createdAt, displayLocale) : undefined}
                    onClick={() => onOpenApproval(r)}
                    testId="home-my-work-approval-row"
                  />
                ))}
                total={pendingApprovalsCount}
                status={pendingApprovalsStatus}
                empty={t('home.myWork.approvalsEmpty', { defaultValue: 'Nothing waiting for your approval' })}
                t={t}
                testId="home-my-work-approvals-notice"
              />
            </WorkColumn>
          )}
          {notificationsReadable && (
            <WorkColumn
              title={t('home.myWork.notifications', { defaultValue: 'Notifications' })}
              count={unreadTopicCount}
              onViewAll={onOpenInbox}
              t={t}
              testId="home-my-work-notifications"
            >
              <ColumnBody
                rows={notifications.slice(0, MY_WORK_ROWS).map((n) => (
                  <WorkRow
                    key={n.id}
                    icon={Bell}
                    tileClass="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                    label={n.title}
                    meta={n.createdAt ? timeAgo(n.createdAt, displayLocale) : undefined}
                    onClick={() => onOpenNotification(n)}
                    testId="home-my-work-notification-row"
                  />
                ))}
                total={unreadTopicCount}
                status={notificationsStatus}
                empty={t('home.myWork.notificationsEmpty', { defaultValue: 'No unread notifications' })}
                t={t}
                testId="home-my-work-notifications-notice"
              />
            </WorkColumn>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * An approval row's one line: the flow's label, then the record's name — the
 * service's display enrichment, as the Approvals inbox shows it. The flow's
 * machine name stands in only when the service resolved no label for it.
 */
function approvalTitle(r: PendingApprovalRequest): string {
  return [r.processLabel || r.processName, r.recordTitle].filter(Boolean).join(' · ');
}

/**
 * A Home section with its heading above the card rather than inside it — the
 * "Recently accessed" and "Activity feed" columns (objectui#12604): a 15 px /
 * 600 heading, 8 px above a bordered card.
 */
function HomeSection({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0" data-testid={testId}>
      <h2 className="mb-2 text-[15px] font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

/**
 * The kind icon of a "Recently accessed" row (objectui#12604): a record draws
 * its object's icon (the {@link RecentItemContext.icon} the page resolved), and
 * every other kind draws its own.
 */
const RECENT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  object: Database,
  view: List,
  record: FileText,
  dashboard: LayoutDashboard,
  page: File,
};

/**
 * What a "Recently accessed" row prints beside its title (objectui#12604),
 * resolved by the page that has the metadata — this module reads none (see
 * {@link HomeContinue}).
 */
export interface RecentItemContext {
  /**
   * The trail's first part: a record's object label ("Account"), or the
   * entry's kind ("Dashboard", "List view") for every other kind.
   */
  context: string;
  /** The label of the app the entry was opened in, or `undefined` when no app on Home is it. */
  app?: string;
  /** A record's object icon (a Lucide name), or `undefined` to draw the kind's icon. */
  icon?: string;
}

/**
 * Home's "Recently accessed" column (objectui#12604): up to six 40 px rows,
 * newest first, each a 24 px kind icon tile, the title, and a muted trail
 * "Account · HotCRM · 10 minutes ago" — the context, the app, and when it was
 * opened, in the DISPLAY locale (objectui#10668).
 *
 * `labelOf` is `useRecentItemLabel()` and `describe` is the page's trail
 * resolver, handed in like `t`: an entry stores identity, not text, so its
 * label is resolved on the render, in the current language (objectui#11678).
 * Taken as props so this module — which also holds the action center and the
 * activity card — does not itself load the metadata cache they read. The one
 * read it does make is the activity card's: `ActivityObjectLabel` reads the
 * cached object list, and only while an activity row is on screen
 * (objectui#12238).
 */
export function HomeContinue({
  items,
  onOpen,
  t,
  labelOf,
  describe,
}: {
  items: RecentItem[];
  onOpen: (href: string) => void;
  t: TFn;
  labelOf: RecentItemLabelResolver;
  describe: (item: RecentItem) => RecentItemContext;
}) {
  const displayLocale = useDisplayLocale();
  return (
    <HomeSection title={t('home.recentApps.title', { defaultValue: 'Recently Accessed' })} testId="home-recent">
      {items.length === 0 ? (
        <p className="rounded-lg border border-border bg-card px-3 py-2.5 text-[13px] text-muted-foreground">
          {t('home.continueEmpty', { defaultValue: 'Items you open will show up here.' })}
        </p>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border bg-card">
          {items.map((it) => {
            const { context, app, icon } = describe(it);
            const Icon = icon ? getIcon(icon) : RECENT_ICON[it.type] || FileText;
            const trail = [context, app, timeAgo(it.visitedAt, displayLocale)].filter(Boolean).join(' · ');
            return (
              <li key={it.id} className="border-t border-border first:border-t-0">
                <button
                  type="button"
                  onClick={() => onOpen(it.href)}
                  data-testid="home-recent-row"
                  data-recent-type={it.type}
                  className="flex h-10 w-full items-center gap-2.5 px-3 text-left text-[13px] transition-colors hover:bg-muted/60"
                >
                  <span
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                    data-testid="home-recent-icon"
                    data-icon={icon ?? it.type}
                  >
                    <Icon className="h-[13px] w-[13px]" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{labelOf(it)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground" data-testid="home-recent-trail">
                    {trail}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </HomeSection>
  );
}

/**
 * Home's activity card. Takes the feed's whole reading, not its rows
 * (objectui#12081): "No recent activity" is an ASSERTION about the feed, made
 * only once it has answered — the rule `HomeActionCenter` above applies to
 * the inbox (#4235). The rows alone could not tell a refused `sys_activity`
 * read from an empty feed, so every non-admin was told there was none.
 *
 * Renders nothing for a caller who may not read `sys_activity`
 * (`readable: false`): no card, no empty claim, and no drill into a list page
 * that answers them `403`. `HomePage` drops the column with it.
 *
 * A row names its object through `ActivityObjectLabel`, the component the
 * bell's Activity tab renders for the same row (objectui#12238): the label in
 * the reader's language, the API name only when none resolves.
 *
 * A read the server REFUSED anyway (a grant the client believed, or no loaded
 * grant to ask) says so with a lock and a permission sentence (objectui#12843),
 * not the generic failure: the feed marks the refusal with the record activity
 * panel's verdict (`isRefusedFeedRead`, objectui#11195). The sentence is the
 * neutral `layout.activityFeed.accessDenied`, the one the bell's Activity tab
 * shows for the same refusal (objectui#12859); the record panel's
 * `detail.activityAccessDenied` names "this record", and Home has none. Every
 * other failure keeps the generic copy.
 *
 * Laid out as Home's section ④ (objectui#12604): the heading above a card with
 * 12 px padding; each row the actor (13 px / 500), the verb and target muted,
 * and a 12 px line of time and object; "View all activity →" the last row.
 */
export function HomeActivity({ activity, onViewAll, t }: { activity: ActivityFeedReading; onViewAll: () => void; t: TFn }) {
  // The display locale, as `HomeActionCenter` above (objectui#10668).
  const displayLocale = useDisplayLocale();
  if (!activity.readable) return null;
  const items = activity.value;
  return (
    <HomeSection title={t('sidebar.activityFeed', { defaultValue: 'Activity feed' })} testId="home-activity">
      <div className="rounded-lg border border-border bg-card px-3 pb-2 pt-1">
        {/* Beside the list, not only in place of it, as on the action centre. */}
        {activity.status !== 'ready' && (
          <div
            className="flex items-center gap-2 py-2 text-[13px] text-muted-foreground"
            data-testid="home-activity-unanswered"
          >
            {activity.status === 'error' && activity.refused ? (
              <span className="flex items-center gap-2" data-testid="home-activity-access-denied">
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
        {items.length === 0 ? (
          activity.status === 'ready' && (
            <p className="py-2 text-[13px] text-muted-foreground">
              {t('layout.activityFeed.empty', { defaultValue: 'No recent activity' })}
            </p>
          )
        ) : (
          <ul>
            {items.slice(0, 5).map((a) => (
              <li key={a.id} className="border-b border-border py-2 text-[13px] leading-snug" data-testid="home-activity-row">
                <span className="font-medium">{a.user}</span>{' '}
                <span className="text-muted-foreground">{a.description}</span>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {timeAgo(a.timestamp, displayLocale)} · <ActivityObjectLabel objectName={a.objectName} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={onViewAll}
          className="mt-1.5 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {t('layout.activityFeed.viewAll', { defaultValue: 'View all activity' })}
          <ArrowRight className="h-3 w-3" />
        </button>
      </div>
    </HomeSection>
  );
}
