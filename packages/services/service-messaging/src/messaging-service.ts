// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/spec/contracts';
import { isUniqueViolationError } from '@objectstack/types';
import type {
    MessagingChannel,
    MessagingChannelContext,
    Notification,
} from './channel.js';
import { RecipientResolver } from './recipient-resolver.js';
import { PreferenceResolver, type PreferenceTarget } from './preference-resolver.js';
import type { INotificationOutbox } from './outbox.js';
import type { EnqueueHttpInput, HttpDelivery, HttpDeliveryStatus, IHttpOutbox } from './http-outbox.js';
import { INBOX_OBJECT, RECEIPT_OBJECT } from './inbox-channel.js';

/** The L2 event object every `emit()` writes one row to (ADR-0030). */
export const NOTIFICATION_EVENT_OBJECT = 'sys_notification';

/** Receipt states that count as "read" for the inbox unread badge (ADR-0030). */
const READ_RECEIPT_STATES = new Set(['read', 'clicked', 'dismissed']);

/**
 * One row of the inbox list REST response — the `Notification` shape in the API
 * spec (`NotificationSchema`). `id` is the notification's event id
 * (`notification_id`), which keys its read-state receipt, falling back to the
 * inbox row id for synthetic/legacy rows that carry no event id.
 */
export interface InboxNotificationView {
    id: string;
    type: string;
    title: string;
    body: string;
    read: boolean;
    actionUrl?: string;
    createdAt: string;
}

/**
 * Audience selector for {@link EmitInput}. P0 resolves explicit user ids and
 * email-shaped recipients inline (email→id is finished at the inbox channel);
 * `role:` / `team:` / `owner_of:` selectors are forwarded but only fully
 * expanded by the `RecipientResolver` in P1.
 */
export type AudienceSpec =
    | string // user id | email | 'role:x' | 'team:x'
    | { ownerOf: { object: string; id: string } };

export type Audience = AudienceSpec | readonly AudienceSpec[];

/**
 * The single notification ingress (ADR-0030 §3). Every producer — the flow
 * `notify` node, collaboration `@mention`, record assignment, system alerts —
 * calls `emit()` with this shape. No producer writes a per-user inbox row
 * directly; the in-app inbox is a *materialization of delivery*.
 */
export interface EmitInput {
    /** Topic id, e.g. `task.assigned`, `collab.mention`. */
    readonly topic: string;
    /** Who should receive it. See {@link Audience}. */
    readonly audience: Audience;
    /** Template inputs carried to channels (title/body/url/actor/source/…). */
    readonly payload?: Record<string, unknown>;
    /** Severity hint for rendering / filtering. */
    readonly severity?: 'info' | 'warning' | 'critical';
    /** Idempotency key within a topic window; a repeat `emit` is a no-op. */
    readonly dedupKey?: string;
    /** The record that triggered the event. */
    readonly source?: { object: string; id: string };
    /** User who caused the event (mentioner, assigner). */
    readonly actorId?: string;
    /** Tenant stamp for sudo/background paths so RLS matches recipients. */
    readonly organizationId?: string;
    /** Channels to fan out to. Defaults to `['inbox']` (always on). */
    readonly channels?: string[];
}

/** Per-delivery outcome record returned from {@link MessagingService.emit}. */
export interface DeliveryOutcome {
    readonly channel: string;
    readonly recipient: string;
    readonly ok: boolean;
    readonly externalId?: string;
    readonly error?: string;
}

/** Aggregate result of fanning one notification out to its channels. */
export interface EmitResult {
    /** Id of the L2 `sys_notification` event written (or matched, on dedup). */
    readonly notificationId: string;
    /** True when `dedupKey` matched an existing event and fan-out was skipped. */
    readonly deduped: boolean;
    readonly deliveries: DeliveryOutcome[];
    readonly delivered: number;
    readonly failed: number;
}

/** Context the service needs: a logger, plus data access for the L2 event. */
export interface MessagingServiceContext extends MessagingChannelContext {
    /**
     * Resolve the runtime data engine used to persist the L2 event. Returns
     * `undefined` on a minimal/test stack with no data layer — `emit()` then
     * uses a synthetic id and warns rather than throwing, matching the
     * platform's CRUD-node degradation.
     */
    getData?(): IDataEngine | undefined;
    /** Clock injection for deterministic tests. Defaults to `new Date()`. */
    now?(): string;
    /** Override the recipient resolver (tests). Defaults to a data-backed one. */
    recipientResolver?: RecipientResolver;
    /** Override the preference resolver (tests). Defaults to a data-backed one. */
    preferenceResolver?: PreferenceResolver;
    /**
     * Topics that bypass the per-user preference matrix (ADR-0030 P2) — e.g.
     * security/system alerts users must not be able to mute. Exact match, or a
     * `prefix.` entry for prefix match.
     */
    mandatoryTopics?: readonly string[];
    /**
     * Durable delivery outbox (ADR-0030 P1). When present, `emit()` enqueues a
     * `pending` delivery row per `(recipient × channel)` and the
     * `NotificationDispatcher` performs the send + retries. When absent, `emit()`
     * fans out inline (best-effort, no retry) — the P0 behavior.
     */
    outbox?: INotificationOutbox;
}

/**
 * MessagingService — the notification dispatcher (ADR-0012 / ADR-0030).
 *
 * Holds the `MessagingChannel` registry and implements the single ingress
 * `emit(EmitInput)`:
 *   1. write the L2 `sys_notification` event (idempotent on `dedupKey`);
 *   2. resolve the audience to recipient ids (inline in P0; `RecipientResolver`
 *      owns role/team/owner_of expansion in P1);
 *   3. fan `(channel × recipient)` deliveries and call each channel's `send()`,
 *      which materializes the artifact (inbox row + receipt, email, …).
 *
 * Deliberately *not* in this phase (ADR-0030 P1+): the durable outbox, retry
 * schedule, cluster-lock, dead-letter, the per-user preference matrix,
 * renderers/templates, and digest middleware. `emit()` is best-effort fan-out;
 * failures are reported in the result. The seams are shaped so those land
 * without breaking callers.
 */
export class MessagingService {
    private readonly channels = new Map<string, MessagingChannel>();
    private readonly now: () => string;
    private readonly resolver: RecipientResolver;
    private readonly preferences: PreferenceResolver;
    private outbox?: INotificationOutbox;
    private httpOutbox?: IHttpOutbox;

    constructor(private readonly ctx: MessagingServiceContext) {
        this.now = ctx.now ?? (() => new Date().toISOString());
        this.resolver =
            ctx.recipientResolver ??
            new RecipientResolver({ getData: () => ctx.getData?.(), logger: ctx.logger });
        this.preferences =
            ctx.preferenceResolver ??
            new PreferenceResolver({
                getData: () => ctx.getData?.(),
                logger: ctx.logger,
                mandatoryTopics: ctx.mandatoryTopics,
            });
        this.outbox = ctx.outbox;
    }

    /**
     * Attach the durable delivery outbox after construction. The plugin wires
     * this once the data engine is resolvable (kernel:ready), switching `emit()`
     * from inline fan-out to the reliable enqueue → dispatcher path.
     */
    setOutbox(outbox: INotificationOutbox): void {
        this.outbox = outbox;
    }

    /**
     * Attach the generic outbound-HTTP delivery outbox (ADR-0018 M3). Wired by
     * the plugin at `kernel:ready` once the data engine is resolvable. Once set,
     * {@link enqueueHttp} persists durable rows the {@link HttpDispatcher}
     * drains with retry / dead-letter; the Flow `http` node enqueues through it.
     */
    setHttpOutbox(outbox: IHttpOutbox): void {
        this.httpOutbox = outbox;
    }

    /**
     * Whether durable HTTP delivery is available. Callers (e.g. the `http` node)
     * fall back to a direct, non-durable send when this is `false`.
     */
    isHttpDeliveryReady(): boolean {
        return this.httpOutbox !== undefined;
    }

    /**
     * Enqueue a durable outbound-HTTP delivery (ADR-0018 M3). Returns the row id.
     * Throws if no HTTP outbox is wired — guard with {@link isHttpDeliveryReady}.
     */
    async enqueueHttp(input: EnqueueHttpInput): Promise<string> {
        if (!this.httpOutbox) {
            throw new Error('messaging: HTTP delivery outbox not configured (no data engine / reliableDelivery off)');
        }
        return this.httpOutbox.enqueue(input);
    }

    /**
     * Reset a terminal HTTP delivery row back to `pending` so the dispatcher
     * re-sends it (ADR-0018 M3). Backs the webhook redeliver admin endpoint.
     * Throws if no HTTP outbox is wired, or `HttpRedeliverError` for a missing /
     * non-terminal row.
     */
    async redeliverHttp(id: string): Promise<HttpDelivery> {
        if (!this.httpOutbox) {
            throw new Error('messaging: HTTP delivery outbox not configured');
        }
        return this.httpOutbox.redeliver(id);
    }

    /** List HTTP delivery rows (admin/tests). Empty when no outbox is wired. */
    async listHttp(filter?: { status?: HttpDeliveryStatus; source?: string }): Promise<HttpDelivery[]> {
        if (!this.httpOutbox) return [];
        return this.httpOutbox.list(filter);
    }

    /** Register a channel implementation. A duplicate id warns and replaces. */
    registerChannel(channel: MessagingChannel): void {
        if (this.channels.has(channel.id)) {
            this.ctx.logger.warn(`[messaging] channel '${channel.id}' already registered; replacing`);
        }
        this.channels.set(channel.id, channel);
        this.ctx.logger.info(`[messaging] channel registered: ${channel.id}`);
    }

    /** Remove a channel. No-op when absent. */
    unregisterChannel(id: string): void {
        this.channels.delete(id);
    }

    /** Look up a channel by id. */
    getChannel(id: string): MessagingChannel | undefined {
        return this.channels.get(id);
    }

    /** All registered channel ids. */
    getRegisteredChannels(): string[] {
        return [...this.channels.keys()];
    }

    /* ------------------------------------------------------------------ */
    /*  Inbox read API (ADR-0030) — backs /api/v1/notifications            */
    /*                                                                     */
    /*  The REST notification surface reads the L5 `sys_inbox_message`      */
    /*  materialization joined with the `sys_notification_receipt`         */
    /*  read-state spine — NOT the re-modeled `sys_notification` L2 event   */
    /*  (which carries no recipient/read columns). Mark-read upserts the    */
    /*  receipt, keyed `(notification_id, user_id, channel:'inbox')`.       */
    /* ------------------------------------------------------------------ */

    /**
     * List the signed-in user's in-app inbox, joined with read-state.
     *
     * A message is unread until its event has a `read`/`clicked`/`dismissed`
     * receipt; the `read` filter (when given) is applied in-memory after the
     * join.
     *
     * Two different bounds, deliberately (#6363):
     *
     *   * `notifications[]` is the fetched WINDOW — `limit` rows, defaulting to
     *     50 and hard-capped at 200, newest first. Unchanged: the Console
     *     bell's poll and every other caller page through this list.
     *   * `unreadCount` is the **total** unread across the user's whole
     *     matching inbox, which is what `ListNotificationsResponseSchema`
     *     publishes into the API reference ("Total number of unread
     *     notifications"). Counting it over `rows` — the window — made the
     *     badge saturate at the window size forever: a user with 60 unread was
     *     told 50, and `?limit=10` told them 10. The declaration was right and
     *     the implementation was wrong (maintainer ruling, #6363 Option A).
     *
     * The `read` filter never moves `unreadCount`: asking for the read half of
     * the inbox does not mean the badge is zero. A `type` filter does — the
     * count answers the query that was asked, as it always has.
     *
     * Returns the REST contract shape: `{ notifications, unreadCount }`.
     */
    async listInbox(
        userId: string,
        opts: { read?: boolean; type?: string; limit?: number } = {},
    ): Promise<{ notifications: InboxNotificationView[]; unreadCount: number }> {
        const data = this.ctx.getData?.();
        if (!data || !userId) return { notifications: [], unreadCount: 0 };

        const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
        const where: Record<string, unknown> = { user_id: userId };
        if (opts.type) where.topic = opts.type;

        const [rows, stateByNotif] = await Promise.all([
            data.find(INBOX_OBJECT, { where, orderBy: [{ field: 'created_at', order: 'desc' }], limit }) as Promise<Array<Record<string, unknown>>>,
            this.readReceiptStates(data, userId),
        ]);

        let windowUnread = 0;
        const all: InboxNotificationView[] = rows.map((m) => {
            const nid = m?.notification_id != null ? String(m.notification_id) : null;
            const state = nid ? stateByNotif.get(nid) : undefined;
            const read = state ? READ_RECEIPT_STATES.has(state) : false;
            if (!read) windowUnread += 1;
            return {
                id: nid ?? String(m.id),
                type: (m.topic as string) ?? 'notification',
                title: (m.title as string) ?? '',
                body: (m.body_md as string) ?? '',
                read,
                actionUrl: (m.action_url as string) ?? undefined,
                createdAt: (m.created_at as string) ?? this.now(),
            };
        });

        // A window that came back SHORT is the whole matching set — nothing was
        // truncated, so the window count already IS the total and the second
        // read would be a duplicate of the first. Only a saturated window
        // (`rows.length === limit`) can be hiding rows, and that is exactly the
        // case #6363 is about. So the common inbox — fewer messages than the
        // page size — costs precisely what it cost before this change.
        const unreadCount = rows.length < limit
            ? windowUnread
            : await this.countUnreadTotal(data, where, stateByNotif);

        const notifications = opts.read === undefined ? all : all.filter((n) => n.read === opts.read);
        return { notifications, unreadCount };
    }

    /**
     * Total unread across the user's whole matching inbox — the reverse join
     * `unreadCount` is declared to answer (#6363).
     *
     * Read-state lives on `sys_notification_receipt`, not on the inbox row
     * (ADR-0030), so no single `count()` answers this: the predicate spans two
     * objects. The receipt side is already fully in memory — `listInbox` reads
     * every one of the user's inbox receipts, unbounded, to build the join —
     * so all that is missing is the message side, and it is read as a
     * PROJECTION of one column with no `orderBy` and no `limit`. That keeps
     * this the same order of work as the receipt scan the method already
     * performs unconditionally, one column wide, and it stays exact under a
     * `type` filter and for rows carrying no `notification_id` (never
     * receipted, therefore always unread) — neither of which a
     * `count(messages) - count(read receipts)` subtraction survives.
     *
     * NOT best-effort, unlike the receipt read above. That one degrades because
     * receipts are a DIFFERENT object which a minimal stack may not have
     * registered at all; this one re-reads the very object whose `find` just
     * succeeded with the very same `where`. There is no state in which it fails
     * and the caller still holds a trustworthy list — and swallowing it would
     * silently restore the window-sized lie this method exists to stop telling.
     */
    private async countUnreadTotal(
        data: IDataEngine,
        where: Record<string, unknown>,
        stateByNotif: ReadonlyMap<string, string>,
    ): Promise<number> {
        const ids = (await data.find(INBOX_OBJECT, {
            where,
            fields: ['notification_id'],
        })) as Array<Record<string, unknown>>;

        let unread = 0;
        for (const row of ids) {
            const nid = row?.notification_id != null ? String(row.notification_id) : null;
            const state = nid ? stateByNotif.get(nid) : undefined;
            if (!state || !READ_RECEIPT_STATES.has(state)) unread += 1;
        }
        return unread;
    }

    /**
     * The user's inbox read-state spine: `notification_id` → most-advanced
     * receipt state, where `read`/`clicked`/`dismissed` wins over a plain
     * `delivered` one (ADR-0030 keeps read-state on `sys_notification_receipt`,
     * not on the inbox row).
     *
     * Best-effort by design: receipts are a DIFFERENT object which a minimal
     * stack may not have registered at all, so an unavailable spine degrades to
     * "nothing is known to be read" rather than failing the caller. Both
     * callers survive that direction — `listInbox` lists everything as unread,
     * and `markAllRead` sweeps everything (re-marking a read message is
     * idempotent; skipping an unread one is #6436).
     */
    private async readReceiptStates(data: IDataEngine, userId: string): Promise<Map<string, string>> {
        const receipts = await (data.find(RECEIPT_OBJECT, {
            where: { user_id: userId, channel: 'inbox' },
        }) as Promise<Array<Record<string, unknown>>>).catch(() => [] as Array<Record<string, unknown>>);

        const stateByNotif = new Map<string, string>();
        for (const r of receipts) {
            const nid = r?.notification_id != null ? String(r.notification_id) : '';
            if (!nid) continue;
            const state = String(r.state ?? 'delivered');
            const prev = stateByNotif.get(nid);
            if (!prev || (!READ_RECEIPT_STATES.has(prev) && READ_RECEIPT_STATES.has(state))) {
                stateByNotif.set(nid, state);
            }
        }
        return stateByNotif;
    }

    /**
     * Mark specific notifications read by upserting their inbox receipts to
     * `read`. Updates the existing `delivered` receipt in place (keyed
     * `(notification_id, user_id, channel:'inbox')`); inserts one only when
     * absent. `ids` are notification (event) ids. Returns the REST contract
     * shape (`MarkNotificationsReadResponseSchema`): `{ success, readCount }`.
     */
    async markRead(userId: string, ids: readonly string[]): Promise<{ success: boolean; readCount: number }> {
        const data = this.ctx.getData?.();
        if (!data || !userId || !ids?.length) return { success: true, readCount: 0 };
        const at = this.now();
        let readCount = 0;
        for (const id of ids) {
            const nid = String(id ?? '');
            if (!nid) continue;
            try {
                readCount += await this.upsertReadReceipt(data, userId, nid, at);
            } catch (err) {
                this.ctx.logger.warn(`[messaging] markRead failed for '${nid}': ${(err as Error).message}`);
            }
        }
        return { success: true, readCount };
    }

    /**
     * Mark every currently-unread inbox message for the user as read — the
     * whole inbox, not a page of it (#6436). Returns `{ success, readCount }`
     * (`MarkAllNotificationsReadResponseSchema`), where `readCount` is the
     * number of DISTINCT notifications this call flipped to `read`: the
     * unread set it found, minus any whose receipt write failed (those are
     * logged by `markRead` and left for the next sweep, which is idempotent).
     *
     * It used to sweep `listInbox(userId, { read: false, limit: 200 })` — one
     * page of the LIST, and 200 is that list's hard cap — so the route
     * documented as "mark **every** currently-unread inbox message as read"
     * cleared at most 200 receipts per call. Two ways that showed:
     *
     *   * 350 unread → `{ readCount: 200 }`, 150 still unread. Invisible while
     *     `unreadCount` was itself window-scoped; since #6363 made the badge a
     *     true total, one response pair states the contradiction on its own.
     *   * Worse, and the reason a paging loop is not the fix: that window is
     *     `created_at desc` over ALL rows, with the `read` filter applied in
     *     memory AFTER the truncation. An inbox whose newest 200 are already
     *     read handed the sweep an EMPTY list and marked NOTHING, however much
     *     older unread sat behind it — and "loop until the page comes back
     *     empty" exits on exactly that empty first page.
     *
     * So the sweep reads the unread SET instead of a page of the list, in a
     * FIXED two reads whatever the inbox size: the same one-column, unwindowed
     * projection of `sys_inbox_message` that #6363's `countUnreadTotal` already
     * issues to answer the badge, joined against the receipt spine that
     * `listInbox` already reads unbounded. No loop, no page count to bound, and
     * nothing asked of the data layer that the bell's poll does not ask on
     * every saturated page. What remains linear is the WRITE — one receipt per
     * unread notification, which is the receipt model itself (ADR-0030), and
     * the only thing that could collapse it is a predicate-shaped bulk write
     * (route B), which would have to redesign `markRead`'s check-then-act
     * upsert and its "no receipt row yet" insert face. Deliberately not done
     * here.
     *
     * No cap: a numeric safety valve is route C wearing a larger number — above
     * it, "all" would be a lie again, which is the reading the maintainer ruled
     * against on #6363 (make the declaration true rather than document the
     * shortfall). What bounds a pathological inbox instead is that the work is
     * idempotent and resumable — a failed receipt write is logged, skipped, and
     * picked up by the next sweep.
     */
    async markAllRead(userId: string): Promise<{ success: boolean; readCount: number }> {
        const data = this.ctx.getData?.();
        if (!data || !userId) return { success: true, readCount: 0 };
        return this.markRead(userId, await this.unreadNotificationIds(data, userId));
    }

    /**
     * Every notification id in the user's inbox that has no `read`-class
     * receipt yet — the set `markAllRead` must flip, deduplicated so a
     * notification materialized by several inbox rows is counted (and upserted)
     * once, since its receipt is keyed `(notification_id, user_id, channel)`.
     *
     * The inbox read is NOT best-effort, matching `countUnreadTotal`: it is the
     * primary read, and a failure means we do not know what to mark — far
     * better to surface it than to report a confident `readCount` over a set we
     * could not see. The receipt read degrades (see `readReceiptStates`).
     *
     * Rows carrying no `notification_id` are skipped: read-state is keyed by
     * the event id, and the inbox channel writes no receipt for a row without
     * one, so there is nothing addressable to write. The previous sweep fed
     * `markRead` the inbox ROW id for those (`listInbox` views them as
     * `nid ?? String(m.id)`), inserting a receipt the join never reads back —
     * it could not make the row read and still counted itself into
     * `readCount`. They keep reporting as unread, which is the true state.
     * Whether such a row should be readable at all is a gap in the receipt KEY,
     * not in this sweep: filed as #6448 (dormant — the single `emit()` ingress
     * always carries an event id, so only data written around it can be null).
     */
    private async unreadNotificationIds(data: IDataEngine, userId: string): Promise<string[]> {
        const [rows, stateByNotif] = await Promise.all([
            data.find(INBOX_OBJECT, {
                where: { user_id: userId },
                fields: ['notification_id'],
            }) as Promise<Array<Record<string, unknown>>>,
            this.readReceiptStates(data, userId),
        ]);

        const ids: string[] = [];
        const seen = new Set<string>();
        for (const row of rows) {
            const nid = row?.notification_id != null ? String(row.notification_id) : '';
            if (!nid || seen.has(nid)) continue;
            const state = stateByNotif.get(nid);
            if (state && READ_RECEIPT_STATES.has(state)) continue;
            seen.add(nid);
            ids.push(nid);
        }
        return ids;
    }

    /** Upsert a `read` receipt for one notification; returns 1 when it persisted. */
    private async upsertReadReceipt(
        data: IDataEngine,
        userId: string,
        notificationId: string,
        at: string,
    ): Promise<number> {
        const where = { notification_id: notificationId, user_id: userId, channel: 'inbox' };
        const flipToRead = async (): Promise<boolean> => {
            const existing = await data.findOne(RECEIPT_OBJECT, { where, fields: ['id'] });
            if (!existing?.id) return false;
            await data.update(RECEIPT_OBJECT, { state: 'read', at }, { where: { id: existing.id } } as never);
            return true;
        };

        if (await flipToRead()) return 1;

        // No receipt yet — insert one. findOne→insert is check-then-act, so a
        // concurrent mark-read (or the best-effort `delivered` write still in
        // flight) can win the (notification_id, user_id, channel) unique index
        // between our read and write. Treat that collision as "someone else
        // created it" and flip the now-present row to `read` instead of failing.
        try {
            await data.insert(RECEIPT_OBJECT, {
                notification_id: notificationId,
                delivery_id: null,
                user_id: userId,
                channel: 'inbox',
                state: 'read',
                at,
                created_at: at,
            });
            return 1;
        } catch (err) {
            if (isUniqueViolationError(err) && (await flipToRead())) return 1;
            throw err;
        }
    }

    /**
     * The single notification ingress. Writes the L2 event, resolves the
     * audience, and fans the result out to its channels. An unregistered
     * channel, or a channel that throws, is reported as a failed delivery — it
     * never aborts the rest of the fan-out. A `dedupKey` that matches an
     * existing event short-circuits: the event id is returned and no new
     * deliveries are produced.
     */
    async emit(input: EmitInput): Promise<EmitResult> {
        const data = this.ctx.getData?.();

        // 1) Idempotency — a prior event with the same dedup_key is a no-op.
        if (input.dedupKey && data) {
            const existing = await this.findEventByDedupKey(data, input.dedupKey);
            if (existing) {
                this.ctx.logger.info(
                    `[messaging] emit: dedupKey '${input.dedupKey}' already emitted (${existing}); skipping`,
                );
                return { notificationId: existing, deduped: true, deliveries: [], delivered: 0, failed: 0 };
            }
        }

        // 2) Write the L2 event (or synthesize an id when there is no data layer).
        //    The check at (1) is a fast-path. Where the driver materializes the
        //    UNIQUE(dedup_key) index, it is the real guard: a concurrent emit
        //    that raced past (1) and inserted first makes our insert hit the
        //    unique violation — we catch it and converge to the winner's event
        //    (treated as a dedup hit), so a record-change storm can't produce
        //    duplicate notifications. Mirrors the delivery outbox's enqueue
        //    convergence. (Drivers that don't enforce the index fall back to the
        //    best-effort fast-path — the catch is then simply never taken.)
        let notificationId: string;
        try {
            notificationId = await this.writeEvent(data, input);
        } catch (err) {
            if (input.dedupKey && data) {
                const winner = await this.findEventByDedupKey(data, input.dedupKey);
                if (winner) {
                    this.ctx.logger.info(
                        `[messaging] emit: dedupKey '${input.dedupKey}' raced; converged to ${winner}`,
                    );
                    return { notificationId: winner, deduped: true, deliveries: [], delivered: 0, failed: 0 };
                }
            }
            throw err;
        }

        // 3) Resolve the audience to recipient user ids (RecipientResolver owns
        //    role:/team:/owner_of:/email→id expansion).
        const recipients = await this.resolver.resolve(input.audience, {
            organizationId: input.organizationId,
        });
        if (recipients.length === 0) {
            this.ctx.logger.warn(`[messaging] emit: topic '${input.topic}' resolved to 0 recipients`);
            return { notificationId, deduped: false, deliveries: [], delivered: 0, failed: 0 };
        }

        // 3b) Preference filter (ADR-0030 P2): drop the (recipient × channel)
        //     pairs the user muted. Mandatory topics bypass; fail-open on error.
        const payload = input.payload ?? {};
        const channels = input.channels?.length ? input.channels : ['inbox'];
        const targets = await this.preferences.filter(recipients, channels, {
            topic: input.topic,
            organizationId: input.organizationId,
            severity: input.severity,
        });
        if (targets.length === 0) {
            this.ctx.logger.info(`[messaging] emit: topic '${input.topic}' suppressed for all recipients by preference`);
            return { notificationId, deduped: false, deliveries: [], delivered: 0, failed: 0 };
        }

        // 4) Either enqueue durable deliveries (P1 outbox) or fan out inline (P0).
        if (this.outbox) {
            const deliveries = await this.enqueueDeliveries(this.outbox, notificationId, targets, input, payload);
            const delivered = deliveries.filter((d) => d.ok).length;
            return { notificationId, deduped: false, deliveries, delivered, failed: deliveries.length - delivered };
        }

        const notification: Notification = {
            notificationId,
            organizationId: input.organizationId,
            topic: input.topic,
            title: str(payload.title) ?? input.topic,
            body: str(payload.body) ?? '',
            severity: input.severity ?? 'info',
            recipients,
            channels: input.channels,
            actionUrl: actionUrlFor(input, payload),
            payload: input.payload,
        };

        const { deliveries, delivered, failed } = await this.fanOut(notification, targets);
        return { notificationId, deduped: false, deliveries, delivered, failed };
    }

    /**
     * Enqueue one `pending` delivery row per `(channel × recipient)`. The
     * dispatcher does the actual send + retry; here `ok` means "accepted for
     * delivery" (enqueued), not yet delivered — progress is observable on the
     * `sys_notification_delivery` row.
     */
    private async enqueueDeliveries(
        outbox: INotificationOutbox,
        notificationId: string,
        targets: PreferenceTarget[],
        input: EmitInput,
        payload: Record<string, unknown>,
    ): Promise<DeliveryOutcome[]> {
        // Snapshot the rendered content onto each delivery so a later event edit
        // can't rewrite an in-flight send.
        const deliveryPayload = {
            ...payload,
            title: str(payload.title) ?? input.topic,
            body: str(payload.body) ?? '',
            severity: input.severity ?? 'info',
            actionUrl: actionUrlFor(input, payload),
        };
        const deliveries: DeliveryOutcome[] = [];
        for (const { recipient, channels, notBefore, digest } of targets) {
            for (const channel of channels) {
                try {
                    const id = await outbox.enqueue({
                        notificationId,
                        recipientId: recipient,
                        channel,
                        topic: input.topic,
                        payload: deliveryPayload,
                        organizationId: input.organizationId,
                        // Quiet-hours / digest deferral (P3b): the dispatcher won't
                        // claim this row until `notBefore`. Absent ⇒ immediate.
                        notBefore,
                        // P3b-2: tag batched deliveries so the dispatcher collapses
                        // a `(recipient, channel, window)` group into one message.
                        digestKey: digest ? `${recipient}|${channel}|${digest.window}` : undefined,
                    });
                    deliveries.push({ channel, recipient, ok: true, externalId: id });
                } catch (err) {
                    deliveries.push({ channel, recipient, ok: false, error: (err as Error)?.message ?? String(err) });
                }
            }
        }
        return deliveries;
    }

    /** Find an existing event id by its dedup key, tolerating lookup failure. */
    private async findEventByDedupKey(data: IDataEngine, dedupKey: string): Promise<string | undefined> {
        try {
            const row = await data.findOne(NOTIFICATION_EVENT_OBJECT, {
                where: { dedup_key: dedupKey },
                fields: ['id'],
            });
            const id = row?.id;
            return id != null && String(id).length > 0 ? String(id) : undefined;
        } catch (err) {
            this.ctx.logger.warn(`[messaging] dedup lookup failed (${(err as Error).message}); proceeding`);
            return undefined;
        }
    }

    /**
     * Persist the L2 event and return its id. With no data layer (minimal/test
     * stacks) we warn and synthesize an id so fan-out can still be exercised.
     */
    private async writeEvent(data: IDataEngine | undefined, input: EmitInput): Promise<string> {
        if (!data) {
            this.ctx.logger.warn('[messaging] no data engine registered; event not persisted');
            return `evt_${Math.random().toString(36).slice(2)}`;
        }
        const row: Record<string, unknown> = {
            topic: input.topic,
            payload: input.payload ?? null,
            severity: input.severity ?? 'info',
            dedup_key: input.dedupKey ?? null,
            // Normalize empty strings to null so the (source_object, source_id)
            // index keys on real ids, never '' (producers may pass a bare object
            // with no id — e.g. a comment thread_id with no record part).
            source_object: str(input.source?.object) ?? null,
            source_id: str(input.source?.id) ?? null,
            actor_id: input.actorId ?? null,
            organization_id: input.organizationId ?? null,
            created_at: this.now(),
        };
        const created = await data.insert(NOTIFICATION_EVENT_OBJECT, row);
        const id = Array.isArray(created) ? created[0]?.id : created?.id ?? created;
        return id != null ? String(id) : `evt_${Math.random().toString(36).slice(2)}`;
    }

    /**
     * Fan a notification out to each recipient's accepted channels. Each
     * `(recipient, channel)` pair becomes one `send()` call. An unregistered
     * channel, or a channel that throws, is reported as a failed delivery — it
     * never aborts the rest of the fan-out.
     */
    private async fanOut(
        notification: Notification,
        targets: PreferenceTarget[],
    ): Promise<{ deliveries: DeliveryOutcome[]; delivered: number; failed: number }> {
        const deliveries: DeliveryOutcome[] = [];

        for (const { recipient, channels } of targets) {
            for (const channelId of channels) {
                const channel = this.channels.get(channelId);
                if (!channel) {
                    deliveries.push({
                        channel: channelId,
                        recipient,
                        ok: false,
                        error: `channel '${channelId}' not registered`,
                    });
                    this.ctx.logger.warn(`[messaging] emit: channel '${channelId}' not registered`);
                    continue;
                }
                try {
                    const result = await channel.send(this.ctx, { notification, channel: channelId, recipient });
                    deliveries.push({
                        channel: channelId,
                        recipient,
                        ok: result.ok,
                        externalId: result.externalId,
                        error: result.error,
                    });
                } catch (err) {
                    deliveries.push({
                        channel: channelId,
                        recipient,
                        ok: false,
                        error: (err as Error)?.message ?? String(err),
                    });
                }
            }
        }

        const delivered = deliveries.filter((d) => d.ok).length;
        return { deliveries, delivered, failed: deliveries.length - delivered };
    }
}

/** Coerce a payload value to a non-empty string, else `undefined`. */
function str(v: unknown): string | undefined {
    if (v == null) return undefined;
    const s = String(v);
    return s.length > 0 ? s : undefined;
}

/**
 * The deep-link the in-app materialization should carry. An explicit
 * `payload.url`/`payload.actionUrl` wins; otherwise, when the emit names a
 * `source` record, synthesize an app-relative `/{object}/{id}` link so the
 * materialization is self-sufficient for navigation (the bell no longer has the
 * L2 event's `source_object/source_id` to fall back on — ADR-0030 L5). Returns
 * `undefined` when there is nothing to link to.
 */
function actionUrlFor(input: EmitInput, payload: Record<string, unknown>): string | undefined {
    const explicit = str(payload.url) ?? str(payload.actionUrl);
    if (explicit) return explicit;
    const obj = str(input.source?.object);
    const id = str(input.source?.id);
    return obj && id ? `/${obj}/${id}` : undefined;
}
