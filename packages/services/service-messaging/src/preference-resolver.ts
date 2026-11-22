// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/spec/contracts';
import { FAN_OUT_SYSTEM_CONTEXT } from './fan-out-system-context.js';

/** The object the preference matrix lives in. */
export const PREFERENCE_OBJECT = 'sys_notification_preference';

export interface PreferenceResolverLogger {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
}

export interface PreferenceResolverOptions {
    /** Lazily resolve the data engine; `undefined` ⇒ fail-open (deliver all). */
    getData(): IDataEngine | undefined;
    logger: PreferenceResolverLogger;
    /**
     * Topics that bypass preferences entirely (security/system alerts users
     * must not be able to mute). An entry ending in `.` is a prefix match
     * (`security.` matches `security.breach`); otherwise it is an exact match.
     */
    mandatoryTopics?: readonly string[];
    /** Object name override (default {@link PREFERENCE_OBJECT}). */
    objectName?: string;
}

export interface PreferenceContext {
    topic: string;
    organizationId?: string;
    /** Event severity — `critical` bypasses quiet-hours deferral (P3b). */
    severity?: string;
    /** "Now" reference (epoch ms) for quiet-hours math. Defaults to Date.now(). */
    now?: number;
}

/** A recipient with the channels they accept for this notification. */
export interface PreferenceTarget {
    recipient: string;
    channels: string[];
    /**
     * Earliest dispatch time (epoch ms) when the recipient is deferred — by
     * quiet-hours *or* a digest window (P3b). Absent ⇒ send now. Applies to all
     * of this recipient's channels. Honored only on the durable outbox path;
     * inline best-effort fan-out ignores it.
     */
    notBefore?: number;
    /**
     * P3b-2 digest: present when the recipient batches this topic. `window` is a
     * stable label for the accumulation window (e.g. the local date for `daily`,
     * the week-start date for `weekly`); the dispatcher collapses all
     * `${recipient}|${channel}|${window}` deliveries into one message. Pairs with
     * `notBefore` = the window's dispatch time.
     */
    digest?: { window: string };
}

/** Quiet-hours window declared on a preference row. */
export interface QuietHours {
    tz?: string;
    start?: string; // 'HH:MM'
    end?: string; // 'HH:MM'
}

/** Digest cadence declared on a preference row (P3b-2). `none` ⇒ no batching. */
export type DigestCadence = 'daily' | 'weekly';

/**
 * [ruling 7073270426 on #35123] The stored `quiet_hours` value that means "no
 * quiet hours, by this row's choice": an object whose `off` is `true`. Empty
 * (`null`) stays "not set". See {@link parseQuietHours} for the three states.
 *
 * A MARKED value rather than an empty object: `{}` and `null` are what a
 * cleared widget or an API caller writes for each other, and one written for
 * the other would turn "off" back into "follow the next row" without anyone
 * noticing. `{ off: true }` cannot be produced by clearing anything.
 */
export const QUIET_HOURS_OFF: Readonly<{ off: true }> = Object.freeze({ off: true });

/** A row's quiet-hours answer: a window, or `'off'` ({@link QUIET_HOURS_OFF} as stored). */
type QuietHoursAnswer = QuietHours | 'off';

/** A row's digest answer: a cadence, or `'none'` (send each one right away). */
type DigestAnswer = DigestCadence | 'none';

/**
 * [rulings 6968686390 and 6969143776] The context
 * {@link PreferenceResolver.effectiveFor} reads the preference rows under: the
 * explicit system opt-in. Kept apart from {@link FAN_OUT_SYSTEM_CONTEXT} on
 * purpose, because what this read derives DOES reach a caller: the
 * caller-scoped door answers a person whether each topic and channel is on
 * and whether that comes from the organization's default — the ruled
 * answer, which a member's own grant cannot read (the default rows are
 * outside their row scope). The read is bounded by the `organization_id`
 * term, never by the context; the rows themselves, and every row of another
 * person, stay inside the method.
 */
export const EFFECTIVE_PREFERENCES_SYSTEM_CONTEXT = { isSystem: true } as const;

/**
 * The most rows one of {@link PreferenceResolver.effectiveFor}'s reads may
 * answer. Each read is one person's rows, or the organization's default rows,
 * so a real answer is far below it. A read that comes back with MORE is a
 * fault, never a page: the rows past the cap could be the very rows that
 * decide a cell (or the row id the page edits), and a short answer would be
 * drawn as `default` / `builtin` and invite a duplicate row.
 */
export const EFFECTIVE_PREFERENCES_READ_CAP = 10000;

/**
 * The stored spellings of the admin-global default's empty `user_id` that an
 * equality read can name — `null` and `''` (see {@link isGlobalDefaultUser};
 * `undefined` is never stored).
 */
const GLOBAL_DEFAULT_USER_SPELLINGS: readonly (string | null)[] = [null, ''];

/** The topic / channel wildcard. ⛔ Not a user: see {@link GLOBAL_USER}. */
const WILDCARD = '*';

/**
 * The index key of the admin-global default's USER part.
 *
 * [ADR-0118 D1] `user_id` is a `sys_user` reference, and the row that applies
 * to every user is the one whose reference is EMPTY. This key is internal to
 * the in-memory index below and is never compared with a stored value: a row
 * reaches it only through {@link isGlobalDefaultUser}. It is the empty string
 * because a recipient id never is one.
 *
 * ⛔ A stored `user_id = '*'` is NOT read as the global default here. That was
 * the text column's sentinel; it is rewritten to the empty reference at boot
 * (`convertWildcardPreferenceUsers`), and a row still holding it is a row for
 * a user id nobody has, so it matches no recipient.
 */
const GLOBAL_USER = '';

/**
 * Is this stored `user_id` the empty reference — the admin-global default?
 *
 * `null`, `undefined` and `''` are the three spellings the engine itself reads
 * as "no link" (its reference check skips all three), so they are one value
 * here too. The NULL-safe unique index folds them the same way
 * (`COALESCE(user_id, '')`), so at most one such row exists per (topic,
 * channel) in an organization.
 */
function isGlobalDefaultUser(userId: unknown): boolean {
    return userId === null || userId === undefined || userId === '';
}

/**
 * PreferenceResolver — the ADR-0030 Layer-3 preference filter (P2).
 *
 * Given the resolved recipients and the requested channels, returns, per
 * recipient, the channels they actually accept for `topic`. Resolution is
 * most-specific-wins over `sys_notification_preference` rows with `*` wildcards
 * for topic / channel; a real-user row overrides the admin-global default (the
 * row whose `user_id` is empty, ADR-0118 D1); the built-in default is **on**.
 *
 * Two safety rules:
 *  - **Mandatory topics bypass** the matrix (all channels kept).
 *  - **Fail-open**: no data engine, or a lookup error, keeps all channels — a
 *    preference outage must never silently swallow notifications.
 */
export class PreferenceResolver {
    private readonly objectName: string;
    private readonly mandatory: readonly string[];

    constructor(private readonly opts: PreferenceResolverOptions) {
        this.objectName = opts.objectName ?? PREFERENCE_OBJECT;
        this.mandatory = opts.mandatoryTopics ?? [];
    }

    /** Whether a topic bypasses preferences (exact or `prefix.` match). */
    isMandatory(topic: string): boolean {
        return this.mandatory.some((m) =>
            m.endsWith('.') ? topic.startsWith(m) : topic === m,
        );
    }

    /**
     * Filter `(recipient × channel)` by preference. Recipients left with no
     * accepted channel are dropped from the result.
     */
    async filter(
        recipients: string[],
        channels: string[],
        ctx: PreferenceContext,
    ): Promise<PreferenceTarget[]> {
        const all = (): PreferenceTarget[] => recipients.map((r) => ({ recipient: r, channels: [...channels] }));
        if (recipients.length === 0 || channels.length === 0) return [];
        if (this.isMandatory(ctx.topic)) return all();

        const data = this.opts.getData();
        if (!data) return all(); // fail-open

        let rows: Record<string, unknown>[];
        try {
            rows = await this.loadRows(data, ctx);
        } catch (err) {
            this.opts.logger.warn(
                `[preferences] lookup for topic '${ctx.topic}' failed (${msg(err)}); delivering all (fail-open)`,
            );
            return all();
        }

        const index = indexRows(rows, new Set(recipients));

        const nowMs = ctx.now ?? Date.now();
        const critical = ctx.severity === 'critical';
        const targets: PreferenceTarget[] = [];
        for (const recipient of recipients) {
            const accepted = channels.filter(
                (channel) => this.resolveRow(index, recipient, ctx.topic, channel)?.enabled ?? true,
            );
            if (accepted.length === 0) continue;
            // Deferral (per person; declared on a channel-wildcard row). Critical
            // events bypass both. A digest cadence takes precedence over
            // quiet-hours: batching already defers to a window boundary, and it
            // additionally tags the target so the dispatcher can collapse the
            // window's deliveries into one message.
            let notBefore: number | undefined;
            let digest: { window: string } | undefined;
            if (!critical) {
                const cadence = this.resolveDigest(index, recipient, ctx.topic)?.digest;
                const qh = windowOf(this.resolveQuietHours(index, recipient, ctx.topic));
                if (cadence === 'daily' || cadence === 'weekly') {
                    const d = digestDeferral(cadence, nowMs, this.resolveDigestZoneWindow(index, recipient, ctx.topic)?.tz);
                    notBefore = d.notBefore;
                    digest = { window: d.window };
                } else {
                    notBefore = qh ? quietHoursDeferral(qh, nowMs) : undefined;
                }
            }
            const target: PreferenceTarget = { recipient, channels: accepted };
            if (notBefore != null) target.notBefore = notBefore;
            if (digest) target.digest = digest;
            targets.push(target);
        }
        return targets;
    }

    /** Load the candidate rows (topic-specific + wildcard-topic), org-scoped. */
    private async loadRows(data: IDataEngine, ctx: PreferenceContext): Promise<Record<string, unknown>[]> {
        // Two equality queries (topic and the '*' wildcard) avoid relying on
        // driver-specific IN support; user filtering is done in memory.
        const base: Record<string, unknown> = {};
        if (ctx.organizationId) base.organization_id = ctx.organizationId;
        // The explicit system opt-in — see FAN_OUT_SYSTEM_CONTEXT: the rows are
        // the recipients' preferences, read on their behalf, not the emitter's.
        const [specific, wildcard] = await Promise.all([
            data.find(this.objectName, { where: { ...base, topic: ctx.topic }, limit: 10000 }, { context: FAN_OUT_SYSTEM_CONTEXT }),
            data.find(this.objectName, { where: { ...base, topic: WILDCARD }, limit: 10000 }, { context: FAN_OUT_SYSTEM_CONTEXT }),
        ]);
        return [...(specific ?? []), ...(wildcard ?? [])];
    }

    /**
     * Most-specific-wins lookup for (user, topic, channel). User-specific beats
     * the admin-global default; topic/channel specific beats their wildcards.
     */
    private resolveRow(index: Map<string, PrefRowLite>, user: string, topic: string, channel: string): PrefRowLite | undefined {
        for (const u of [user, GLOBAL_USER]) {
            for (const t of [topic, WILDCARD]) {
                for (const c of [channel, WILDCARD]) {
                    const hit = index.get(`${u}|${t}|${c}`);
                    if (hit !== undefined) return hit;
                }
            }
        }
        return undefined; // built-in default handled by callers (opted in)
    }

    /**
     * Resolve a recipient's quiet-hours window. Declared on a channel-wildcard
     * row (`(user, *, *)` or `(user, topic, *)`) — quiet hours are a per-person,
     * channel-agnostic setting. Most-specific user/topic wins.
     */
    private resolveQuietHours(index: Map<string, PrefRowLite>, user: string, topic: string): PrefRowLite | undefined {
        for (const u of [user, GLOBAL_USER]) {
            for (const t of [topic, WILDCARD]) {
                const hit = index.get(`${u}|${t}|${WILDCARD}`);
                // A row that leaves the field unset decides nothing for it
                // (ruling 7073270426): only a window or the explicit off stops.
                if (hit?.quietHours !== undefined) return hit;
            }
        }
        return undefined;
    }

    /**
     * The window whose `tz` a digest is batched in (ADR-0030: digest windows
     * use `quiet_hours.tz`, else UTC). The same walk as
     * {@link resolveQuietHours}, except that it stops only at a row that holds
     * a WINDOW: it walks past the explicit off as well as unset. So a member's
     * own "no quiet hours" turns quiet hours off for them and leaves their
     * digest at midnight in the time zone of the organization's window; with
     * no window on any row, the digest stays on UTC.
     */
    private resolveDigestZoneWindow(index: Map<string, PrefRowLite>, user: string, topic: string): QuietHours | undefined {
        for (const u of [user, GLOBAL_USER]) {
            for (const t of [topic, WILDCARD]) {
                const window = windowOf(index.get(`${u}|${t}|${WILDCARD}`));
                if (window) return window;
            }
        }
        return undefined;
    }

    /**
     * Resolve a recipient's digest cadence. Like quiet-hours, declared on a
     * channel-wildcard row (`(user, *, *)` or `(user, topic, *)`) — batching is a
     * per-person, channel-agnostic setting. Most-specific user/topic wins.
     */
    private resolveDigest(index: Map<string, PrefRowLite>, user: string, topic: string): PrefRowLite | undefined {
        for (const u of [user, GLOBAL_USER]) {
            for (const t of [topic, WILDCARD]) {
                const hit = index.get(`${u}|${t}|${WILDCARD}`);
                // Only a cadence or the explicit `none` stops; unset walks on.
                if (hit?.digest !== undefined) return hit;
            }
        }
        return undefined;
    }

    /**
     * [rulings 6968686390 and 6969143776] One person's EFFECTIVE preferences —
     * what `filter` would decide for them — for every `topic` × `channel`
     * named, with where each answer comes from. The caller-scoped door
     * `GET /api/v1/messaging/me/preferences` answers this, so the Account
     * page draws the same rules `emit` applies, from this one implementation.
     *
     * The topics and channels are the ones asked for, then any other the
     * person's own rows name. Per cell: a mandatory topic is on (`mandatory`); otherwise the
     * most-specific row wins exactly as in {@link filter} — the person's own
     * (`own`), the organization's default (`default`), or none and the
     * built-in default on (`builtin`). Digest and quiet hours are the
     * person's general ones: the channel-wildcard lookup {@link filter} runs,
     * for the `*` topic.
     *
     * ⚠️ The rows are read under the system opt-in, and only the rows the
     * answer needs: the person's own and the organization's default, each by
     * equality on `user_id` under the `organization_id` term (one read for
     * `userId`, one per stored spelling of the empty default reference — the
     * equality shape {@link loadRows} uses, so no driver needs IN). No other
     * person's row is read. What leaves is the computed answer for `userId`,
     * plus the ids of `userId`'s OWN rows (`ownRowId`, the rows the person
     * edits). A read that answers more than
     * {@link EFFECTIVE_PREFERENCES_READ_CAP} rows rejects (a fault, never a
     * partial answer). No organization ⇒ no row is read: every stored row
     * carries one (ADR-0131 D1), and a read without the term would cross
     * organizations.
     *
     * Unlike {@link filter} this does not fail open: a read that fails
     * rejects, and the door answers the fault — a page must never draw
     * "everything on" because a read failed.
     */
    async effectiveFor(
        userId: string,
        organizationId: string | undefined,
        topics: readonly string[],
        channels: readonly string[],
    ): Promise<EffectivePreferences> {
        const data = this.opts.getData();
        const rows: Record<string, unknown>[] = [];
        if (data && organizationId) {
            const reads = await Promise.all(
                [userId, ...GLOBAL_DEFAULT_USER_SPELLINGS].map((user) =>
                    data.find(
                        this.objectName,
                        { where: { organization_id: organizationId, user_id: user }, limit: EFFECTIVE_PREFERENCES_READ_CAP + 1 },
                        { context: EFFECTIVE_PREFERENCES_SYSTEM_CONTEXT },
                    ),
                ),
            );
            for (const read of reads) {
                const found = (read ?? []) as Record<string, unknown>[];
                if (found.length > EFFECTIVE_PREFERENCES_READ_CAP) {
                    throw new Error(
                        `${this.objectName} answered more than ${EFFECTIVE_PREFERENCES_READ_CAP} rows for one person or for the default; ` +
                            'refusing to compute a partial answer.',
                    );
                }
                rows.push(...found);
            }
        }
        const index = indexRows(rows, new Set([userId]));
        // The person's own rows name topics and channels too: a topic only
        // they ever muted, a channel id a plugin no longer registers. Each is
        // listed after the ones asked for, so their own row is never hidden.
        const ownKeys = [...index.values()].filter((row) => row.user === userId);
        const listed = (asked: readonly string[], ownValues: string[]): string[] => {
            const seen = new Set(asked);
            return [...asked, ...[...new Set(ownValues)].filter((v) => !seen.has(v)).sort()];
        };
        const allTopics = listed(topics, ownKeys.map((row) => row.topic));
        const allChannels = listed(channels, ownKeys.map((row) => row.channel).filter((c) => c !== WILDCARD));
        const own = (topic: string, channel: string): { ownRowId?: string } => {
            const id = index.get(`${userId}|${topic}|${channel}`)?.id;
            return id ? { ownRowId: id } : {};
        };
        const sourceOf = (hit: PrefRowLite | undefined): EffectiveSource =>
            !hit ? 'builtin' : hit.user === GLOBAL_USER ? 'default' : 'own';

        const effectiveTopics = allTopics.map((topic): EffectiveTopic => {
            const mandatory = this.isMandatory(topic);
            return {
                topic,
                wildcard: topic === WILDCARD,
                mandatory,
                channels: allChannels.map((channel): EffectiveCell => {
                    if (mandatory) return { channel, enabled: true, source: 'mandatory', ...own(topic, channel) };
                    const hit = this.resolveRow(index, userId, topic, channel);
                    return { channel, enabled: hit?.enabled ?? true, source: sourceOf(hit), ...own(topic, channel) };
                }),
            };
        });

        const general = this.resolveRow(index, userId, WILDCARD, WILDCARD);
        const digest = this.resolveDigest(index, userId, WILDCARD);
        const quietHours = this.resolveQuietHours(index, userId, WILDCARD);
        return {
            topics: effectiveTopics,
            channels: allChannels,
            general: {
                ...own(WILDCARD, WILDCARD),
                enabled: { value: general?.enabled ?? true, source: sourceOf(general) },
                digest: { value: digest?.digest ?? 'none', source: sourceOf(digest) },
                quietHours: { value: windowOf(quietHours) ?? null, source: sourceOf(quietHours) },
            },
        };
    }
}

/** Where an effective answer comes from (see {@link PreferenceResolver.effectiveFor}). */
export type EffectiveSource = 'own' | 'default' | 'builtin';

/** One channel of one topic, as {@link PreferenceResolver.effectiveFor} answers it. */
export interface EffectiveCell {
    channel: string;
    /** Whether a notification of this topic is delivered on this channel. */
    enabled: boolean;
    /** `mandatory` when the topic bypasses preferences; otherwise the row that decided. */
    source: EffectiveSource | 'mandatory';
    /** The person's own row for exactly this (topic, channel), when they have one. */
    ownRowId?: string;
}

/** One topic's row of the effective matrix. */
export interface EffectiveTopic {
    topic: string;
    /** `true` on the `*` (all topics) row alone. */
    wildcard: boolean;
    /** The topic bypasses preferences: every channel is on, and no row changes that. */
    mandatory: boolean;
    channels: EffectiveCell[];
}

/** An effective value and the row that decided it. */
export interface EffectiveSetting<T> {
    value: T;
    source: EffectiveSource;
}

/** One person's effective preferences (see {@link PreferenceResolver.effectiveFor}). */
export interface EffectivePreferences {
    /** The topics asked for, then any other topic the person's own rows name. */
    topics: EffectiveTopic[];
    /** The channels asked for, then any other channel the person's own rows name; the column order of every topic. */
    channels: string[];
    /**
     * The person's general settings, decided on the `(*, *)` lookup: whether
     * notifications reach them at all where nothing more specific says, their
     * digest cadence and their quiet hours. `ownRowId` is their own `(*, *)`
     * row, the one a digest or quiet-hours change is written to.
     */
    general: {
        ownRowId?: string;
        enabled: EffectiveSetting<boolean>;
        digest: EffectiveSetting<'none' | DigestCadence>;
        quietHours: EffectiveSetting<QuietHours | null>;
    };
}

interface PrefRowLite {
    /** The row's id, as stored. */
    id?: string;
    /** The index key's parts: a user id or {@link GLOBAL_USER}, the topic and the channel. */
    user: string;
    topic: string;
    channel: string;
    enabled: boolean;
    /** Absent ⇒ the row leaves quiet hours unset (see {@link parseQuietHours}). */
    quietHours?: QuietHoursAnswer;
    /** Absent ⇒ the row leaves the digest unset (see {@link parseDigest}). */
    digest?: DigestAnswer;
}

/** The window a row's quiet-hours answer holds — none for the explicit off, or for no row. */
function windowOf(row: PrefRowLite | undefined): QuietHours | undefined {
    const qh = row?.quietHours;
    return qh === undefined || qh === 'off' ? undefined : qh;
}

/**
 * Index rows by `${user}|${topic}|${channel}`. Rows of a user outside `users`
 * are dropped; the admin-global default's rows are always kept.
 */
function indexRows(rows: readonly Record<string, unknown>[], users: ReadonlySet<string>): Map<string, PrefRowLite> {
    const index = new Map<string, PrefRowLite>();
    for (const r of rows) {
        const user = isGlobalDefaultUser(r.user_id) ? GLOBAL_USER : String(r.user_id);
        if (user !== GLOBAL_USER && !users.has(user)) continue; // ignore unrelated users
        const topic = String(r.topic ?? WILDCARD);
        const channel = String(r.channel ?? WILDCARD);
        index.set(`${user}|${topic}|${channel}`, {
            ...(r.id != null ? { id: String(r.id) } : {}),
            user,
            topic,
            channel,
            enabled: asBool(r.enabled),
            quietHours: parseQuietHours(r.quiet_hours),
            digest: parseDigest(r.digest),
        });
    }
    return index;
}

function asBool(v: unknown): boolean {
    return v === true || v === 1 || v === '1' || v === 'true';
}

/**
 * [ruling 7073270426 on #35123] Each of a row's `digest` and `quiet_hours` is
 * one of THREE states, and the resolution rule is one sentence: the most
 * specific row that SETS the field decides it, and a row that leaves it unset
 * decides nothing for it, so the walk goes on (to the organization's default,
 * then the built-in default: no digest, no quiet hours).
 *
 *  - not set (empty, or a value that is not one of the two below) → `undefined`;
 *  - explicitly off: `{ off: true }` ({@link QUIET_HOURS_OFF}) → `'off'`. An
 *    `off: true` wins over any other key the object carries;
 *  - a window with both a `start` and an `end` → that window.
 *
 * So a member's own "no quiet hours" beats the organization's window, and an
 * organization default row that is explicitly off is the same as no default.
 */
function parseQuietHours(v: unknown): QuietHoursAnswer | undefined {
    let o: any = v;
    if (typeof o === 'string') {
        try { o = JSON.parse(o); } catch { return undefined; }
    }
    if (!o || typeof o !== 'object') return undefined;
    if (o.off === true) return 'off';
    if (o.start == null || o.end == null) return undefined;
    return { tz: o.tz, start: String(o.start), end: String(o.end) };
}

/**
 * Parse the `digest` preference column into its three states (see
 * {@link parseQuietHours} for the rule): `daily` / `weekly` batch; `none` is
 * the explicit "send each one right away" and stops the walk; empty (the field
 * declares no default) is not set and walks on.
 */
function parseDigest(v: unknown): DigestAnswer | undefined {
    return v === 'daily' || v === 'weekly' || v === 'none' ? v : undefined;
}

/**
 * Compute the digest dispatch target for `cadence` relative to `now`:
 *  - `notBefore` (epoch ms) — when the accumulating window is flushed:
 *      `daily` → next local midnight; `weekly` → next local Monday 00:00.
 *  - `window` — a stable label for the *current* accumulating window so all
 *    deliveries emitted within it collapse together: the local date for `daily`,
 *    the week-start (Monday) date for `weekly`.
 *
 * Wall-clock is read in `tz` (default UTC). Day length is treated as 1440 min;
 * a DST transition can shift the boundary by an hour — acceptable for a batch
 * window, and the dispatcher reconciles against the real `next_attempt_at`. The
 * `tz`→`sys_user` fallback is a separate follow-up (ADR-0030 §remaining).
 */
export function digestDeferral(
    cadence: DigestCadence,
    nowMs: number,
    tz?: string,
): { notBefore: number; window: string } {
    const zone = tz ?? 'UTC';
    const { minutesOfDay, isoWeekday, date } = wallClockInTz(nowMs, zone);
    if (cadence === 'daily') {
        const minsToMidnight = 1440 - minutesOfDay;
        return { notBefore: nowMs + minsToMidnight * 60_000, window: date };
    }
    // weekly: flush at the next Monday 00:00; window keyed by this week's Monday.
    const daysToNextMonday = ((8 - isoWeekday) % 7) || 7;
    const minsToTarget = daysToNextMonday * 1440 - minutesOfDay;
    const mondayMs = nowMs - (isoWeekday - 1) * 86_400_000;
    return { notBefore: nowMs + minsToTarget * 60_000, window: wallClockInTz(mondayMs, zone).date };
}

/**
 * Compute the deferral target (epoch ms) when `now` falls inside the quiet-hours
 * window, else `undefined`. Times are `HH:MM` in `quietHours.tz` (default UTC).
 * Supports overnight windows (start > end, e.g. 22:00–08:00). Uses `Intl` to read
 * the wall-clock minutes in the tz; returns `now + minutesUntilWindowEnd`.
 */
export function quietHoursDeferral(quietHours: QuietHours, nowMs: number): number | undefined {
    const start = parseHHMM(quietHours.start);
    const end = parseHHMM(quietHours.end);
    if (start == null || end == null || start === end) return undefined;

    const cur = minutesOfDayInTz(nowMs, quietHours.tz ?? 'UTC');
    let untilEnd: number | undefined;
    if (start < end) {
        if (cur >= start && cur < end) untilEnd = end - cur;
    } else {
        // Overnight window wrapping midnight.
        if (cur >= start) untilEnd = 1440 - cur + end;
        else if (cur < end) untilEnd = end - cur;
    }
    return untilEnd == null ? undefined : nowMs + untilEnd * 60_000;
}

function parseHHMM(s?: string): number | undefined {
    if (!s) return undefined;
    const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
    if (!m) return undefined;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return undefined;
    return h * 60 + min;
}

function minutesOfDayInTz(nowMs: number, tz: string): number {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            timeZone: tz,
        }).formatToParts(new Date(nowMs));
        const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24; // '24' → 0
        const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
        return hour * 60 + minute;
    } catch {
        // Unknown tz → treat as UTC.
        const d = new Date(nowMs);
        return d.getUTCHours() * 60 + d.getUTCMinutes();
    }
}

/**
 * Wall-clock view of `nowMs` in `tz`: minutes since local midnight, ISO weekday
 * (1=Mon … 7=Sun), and the local calendar date as `YYYY-MM-DD`. Falls back to
 * UTC for an unknown tz.
 */
function wallClockInTz(nowMs: number, tz: string): { minutesOfDay: number; isoWeekday: number; date: string } {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', timeZone: tz,
        }).formatToParts(new Date(nowMs));
        const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
        const y = Number(get('year'));
        const mo = Number(get('month'));
        const d = Number(get('day'));
        const hour = Number(get('hour')) % 24; // '24' → 0
        const minute = Number(get('minute'));
        const dow = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // 0=Sun
        return { minutesOfDay: hour * 60 + minute, isoWeekday: dow === 0 ? 7 : dow, date: `${y}-${pad(mo)}-${pad(d)}` };
    } catch {
        const dt = new Date(nowMs);
        const dow = dt.getUTCDay();
        return {
            minutesOfDay: dt.getUTCHours() * 60 + dt.getUTCMinutes(),
            isoWeekday: dow === 0 ? 7 : dow,
            date: dt.toISOString().slice(0, 10),
        };
    }
}

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

function msg(err: unknown): string {
    return (err as Error)?.message ?? String(err);
}
