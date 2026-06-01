// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IDataEngine } from '@objectstack/spec/contracts';

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
     * Earliest dispatch time (epoch ms) when the recipient is inside their
     * quiet-hours window; absent ⇒ send now. Applies to all of this recipient's
     * channels (quiet hours are a per-person setting). Honored only on the
     * durable outbox path; inline best-effort fan-out ignores it.
     */
    notBefore?: number;
}

/** Quiet-hours window declared on a preference row. */
export interface QuietHours {
    tz?: string;
    start?: string; // 'HH:MM'
    end?: string; // 'HH:MM'
}

const WILDCARD = '*';

/**
 * PreferenceResolver — the ADR-0030 Layer-3 preference filter (P2).
 *
 * Given the resolved recipients and the requested channels, returns, per
 * recipient, the channels they actually accept for `topic`. Resolution is
 * most-specific-wins over `sys_notification_preference` rows with `*` wildcards
 * for user / topic / channel; a real-user row overrides the `user_id='*'`
 * admin-global default; the built-in default is **on**.
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

        // Index rows by `${user}|${topic}|${channel}` → { enabled, quietHours }.
        const recipientSet = new Set(recipients);
        const index = new Map<string, PrefRowLite>();
        for (const r of rows) {
            const user = String(r.user_id ?? '');
            if (user !== WILDCARD && !recipientSet.has(user)) continue; // ignore unrelated users
            const topic = String(r.topic ?? WILDCARD);
            const channel = String(r.channel ?? WILDCARD);
            index.set(`${user}|${topic}|${channel}`, {
                enabled: asBool(r.enabled),
                quietHours: parseQuietHours(r.quiet_hours),
            });
        }

        const nowMs = ctx.now ?? Date.now();
        const critical = ctx.severity === 'critical';
        const targets: PreferenceTarget[] = [];
        for (const recipient of recipients) {
            const accepted = channels.filter(
                (channel) => this.resolveRow(index, recipient, ctx.topic, channel)?.enabled ?? true,
            );
            if (accepted.length === 0) continue;
            // Quiet-hours deferral (per person; declared on a channel-wildcard
            // row). Critical events bypass it.
            let notBefore: number | undefined;
            if (!critical) {
                const qh = this.resolveQuietHours(index, recipient, ctx.topic);
                notBefore = qh ? quietHoursDeferral(qh, nowMs) : undefined;
            }
            targets.push(notBefore != null ? { recipient, channels: accepted, notBefore } : { recipient, channels: accepted });
        }
        return targets;
    }

    /** Load the candidate rows (topic-specific + wildcard-topic), org-scoped. */
    private async loadRows(data: IDataEngine, ctx: PreferenceContext): Promise<Record<string, unknown>[]> {
        // Two equality queries (topic and the '*' wildcard) avoid relying on
        // driver-specific IN support; user filtering is done in memory.
        const base: Record<string, unknown> = {};
        if (ctx.organizationId) base.organization_id = ctx.organizationId;
        const [specific, wildcard] = await Promise.all([
            data.find(this.objectName, { where: { ...base, topic: ctx.topic }, limit: 10000 }),
            data.find(this.objectName, { where: { ...base, topic: WILDCARD }, limit: 10000 }),
        ]);
        return [...(specific ?? []), ...(wildcard ?? [])];
    }

    /**
     * Most-specific-wins lookup for (user, topic, channel). User-specific beats
     * the `*` user; topic/channel specific beats their wildcards.
     */
    private resolveRow(index: Map<string, PrefRowLite>, user: string, topic: string, channel: string): PrefRowLite | undefined {
        for (const u of [user, WILDCARD]) {
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
    private resolveQuietHours(index: Map<string, PrefRowLite>, user: string, topic: string): QuietHours | undefined {
        for (const u of [user, WILDCARD]) {
            for (const t of [topic, WILDCARD]) {
                const hit = index.get(`${u}|${t}|${WILDCARD}`);
                if (hit?.quietHours) return hit.quietHours;
            }
        }
        return undefined;
    }
}

interface PrefRowLite {
    enabled: boolean;
    quietHours?: QuietHours;
}

function asBool(v: unknown): boolean {
    return v === true || v === 1 || v === '1' || v === 'true';
}

function parseQuietHours(v: unknown): QuietHours | undefined {
    let o: any = v;
    if (typeof o === 'string') {
        try { o = JSON.parse(o); } catch { return undefined; }
    }
    if (!o || typeof o !== 'object') return undefined;
    if (o.start == null || o.end == null) return undefined;
    return { tz: o.tz, start: String(o.start), end: String(o.end) };
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

function msg(err: unknown): string {
    return (err as Error)?.message ?? String(err);
}
