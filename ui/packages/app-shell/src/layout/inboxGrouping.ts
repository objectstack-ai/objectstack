/**
 * inboxGrouping — pure grouping/coalescing for the message center (#2765).
 *
 * The inbox lists every notification individually, so a recurring notification
 * (e.g. `showcase_scheduled_digest`, which fires once a minute) floods the
 * surface with identical rows and inflates the bell badge to "9+". Coalescing
 * repeats of the same `(topic, title)` into one expandable group is the durable
 * fix — the demo-data cadence only makes the gap loud.
 *
 * Kept here (not in InboxPopover.tsx) so it stays a plain unit-testable module
 * and the popover file only exports its component (Fast Refresh friendly).
 *
 * @module
 */

/**
 * One inbox row as the UI knows it: the shape `mergeInboxRows`
 * (`hooks/sharedUserFeeds.ts`) produces, and it is the single producer of every
 * row both the bell (`InboxPopover`) and Home's action centre render.
 *
 * Every member below is mapped by that producer and read by at least one
 * consumer of its rows — those two surfaces, or the arrival announcer the bell
 * mounts (`hooks/useInboxArrivalNotifier.ts`) — and that agreement is what this
 * interface is for. A field declared here but filled by nobody is not
 * documentation — it is a standing invitation to wire it up, and two rounds of
 * them have now been removed: `source_object`/`source_id` (objectui#5190, see
 * `action_url` below) and `actor_name` (objectui#5203).
 *
 * `actor_name` was dead at BOTH ends — `mergeInboxRows` never mapped it, no
 * consumer read it, and `sys_inbox_message` then had no actor column for it to
 * be mapped FROM. Beware that the same NAME is alive on unrelated shapes in
 * this package: the `sys_activity` -> `ActivityItem` map in
 * `hooks/sharedUserFeeds.ts` and the approval activity rows in
 * `hooks/useRecordApprovals.ts` both carry a real `actor_name`, so a grep for
 * the bare name conflates three different fields.
 *
 * Naming an actor on an inbox row was, this comment said, a capability
 * expansion (a column on `sys_inbox_message`, then a producer that maps it),
 * not a re-declaration here — and that is the route `actor_id` below took: the
 * column landed first (objectstack#16974), then the producer mapped it
 * (objectui#8667). The objectui#5203 retirement rested on "no column to map
 * from", which no longer holds for an actor ID. It still holds for a NAME: the
 * column is a lookup to `sys_user`, nothing on the row carries a display name,
 * and `actor_name` stays retired.
 */
export interface InboxNotification {
  id: string;
  /** FK → sys_notification (L2 event) — keys the read-state receipt (ADR-0030). */
  notification_id?: string | null;
  receipt_id?: string | null;
  /** The notification topic (e.g. `project.digest`) — the primary group key. */
  type: string;
  title: string;
  body?: string | null;
  /**
   * Deep-link target carried by the inbox materialization — the ONLY pointer a
   * row carries (ADR-0030 L5).
   *
   * The pre-ADR-0030 `source_object`/`source_id` pair used to sit here as a
   * back-compat fallback. It was declared and never filled: `mergeInboxRows`
   * (`hooks/sharedUserFeeds.ts`), the single producer of every row both the bell
   * and Home render, maps neither, and the `sys_inbox_message` object declares
   * `action_url` with no source columns to map FROM. A declared input no
   * producer fills is a standing invitation to wire it up; removed rather than
   * maintained (objectui#5190). A row that carries no link at all is a real
   * state — the producer leaves `action_url` undefined when an emit has neither
   * a `payload.url` nor a `source` — and both consumers now answer it the same
   * way, by opening the full inbox.
   */
  action_url?: string | null;
  is_read?: boolean;
  created_at?: string;
  /**
   * Who caused the event (the assigner, the mentioner): a bare `sys_user` id,
   * mapped from `sys_inbox_message.actor_id` (objectstack#16974). Its reader is
   * the arrival filter (`claimInboxArrivals` in `hooks/inboxArrivals.ts`),
   * which compares it with the signed-in user's id so that a row the user
   * caused themselves does not pop (objectui#8667).
   *
   * `null` means "no known actor" and nothing stronger. A digest row carries
   * none by construction (a collapsed group has no single actor), and a server
   * older than the column sends no key, which the producer maps to `null` as
   * well. Both announce exactly as a row did before this field existed.
   */
  actor_id?: string | null;
}

/**
 * A coalesced run of notifications sharing the same `(topic, title)`. A group
 * of one renders as an ordinary row; a group of many collapses behind a count
 * pill and expands to reveal its members.
 */
export interface NotificationGroup {
  /** Stable identity for React keys + expand state (topic + title, or a row id). */
  key: string;
  type: string;
  title: string;
  /** Members in input order — the caller passes them newest-first. */
  items: InboxNotification[];
  /** How many members are unread — drives the group's unread dot + mark-read. */
  unreadCount: number;
  /** Newest member's timestamp — what the collapsed header shows. */
  latestCreatedAt?: string;
}

/**
 * Coalesce a (newest-first) notification list into `(topic, title)` groups,
 * preserving first-seen order so the newest group stays on top. Rows missing
 * both a topic and a title fall back to a per-id key so they stand alone
 * instead of collapsing into a catch-all bucket.
 */
export function groupNotifications(list: InboxNotification[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  const byKey = new Map<string, NotificationGroup>();
  for (const n of list) {
    const topic = (n.type ?? '').trim();
    const title = (n.title ?? '').trim();
    // Compose (topic, title) with a NUL separator that can't occur in either,
    // so distinct pairs never collide. A row with neither keys off its id.
    const key = topic || title ? `${topic}\u0000${title}` : `__row__${n.id}`;
    let group = byKey.get(key);
    if (!group) {
      group = { key, type: n.type, title: n.title, items: [], unreadCount: 0, latestCreatedAt: n.created_at };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(n);
    if (!n.is_read) group.unreadCount += 1;
    // Defensive: keep the max timestamp even if the input isn't perfectly sorted.
    if (n.created_at && (!group.latestCreatedAt || n.created_at > group.latestCreatedAt)) {
      group.latestCreatedAt = n.created_at;
    }
  }
  return groups;
}
