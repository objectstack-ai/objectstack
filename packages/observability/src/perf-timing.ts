// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Per-request performance timing - a tiny, dependency-free collector that
 * accumulates named phase durations during a single request and serializes
 * them into the W3C `Server-Timing` response header.
 *
 *   @see <https://www.w3.org/TR/server-timing/>
 *   @see <https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server-Timing>
 *
 * Two ways to record:
 *
 *   1. **Explicit collector.** Hold a {@link PerfTiming} instance and call
 *      `start()` / `record()` / `measure()` directly. The HTTP adapter owns
 *      the instance for a request.
 *
 *   2. **Ambient collector.** Run a request inside {@link runWithPerfTiming}
 *      and any framework code on that async call chain records phases via the
 *      free functions ({@link measureServerTiming}, {@link startServerTiming},
 *      {@link recordServerTiming}, {@link countServerTiming}) without threading
 *      the request object through every layer. When no collector is active the
 *      free functions are cheap no-ops, so call sites pay nothing when the
 *      feature is off. High-frequency phases (per SQL query, per hook) use
 *      {@link countServerTiming} to fold into one aggregate mark carrying a
 *      total duration and an event count.
 *
 * `Server-Timing` exposes internal phase durations to any client, which is a
 * (mild) information-disclosure surface - it helps an attacker profile the
 * backend. Emission is therefore opt-in ("perf-tuning mode"); the collector
 * itself never decides whether to emit, it only measures.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * One recorded phase of a request's server-side processing, serialized as a
 * single member of the `Server-Timing` header.
 */
export interface ServerTimingMark {
    /** Metric name. Coerced to a Server-Timing token on record. */
    name: string;
    /** Duration in milliseconds. */
    dur: number;
    /** Optional human-readable description (rendered as the quoted `desc`). */
    desc?: string;
}

/**
 * Monotonic millisecond clock. Prefers `performance.now()` (monotonic, not
 * affected by wall-clock adjustments); falls back to `Date.now()` on the rare
 * runtime where `performance` is unavailable.
 */
export function perfNow(): number {
    try {
        return performance.now();
    } catch {
        return Date.now();
    }
}

/** Characters not allowed in a Server-Timing metric name (a token). */
const NAME_UNSAFE = /[^A-Za-z0-9_-]+/g;

const UNDERSCORE = 0x5f;

/**
 * Coerce an arbitrary string into a Server-Timing token: non-token runs become
 * a single underscore, then leading/trailing underscores are trimmed.
 *
 * The trim is a linear scan rather than a `/^_+|_+$/g` regex on purpose - the
 * anchored `_+$` quantifier backtracks polynomially on underscore-heavy input
 * (CodeQL js/polynomial-redos), and this name comes from a public-API argument.
 */
function sanitizeName(name: string): string {
    const collapsed = String(name).replace(NAME_UNSAFE, '_');
    let start = 0;
    let end = collapsed.length;
    while (start < end && collapsed.charCodeAt(start) === UNDERSCORE) start++;
    while (end > start && collapsed.charCodeAt(end - 1) === UNDERSCORE) end--;
    return collapsed.slice(start, end);
}

/**
 * Make a description safe to embed in a quoted-string. Backslashes and double
 * quotes would terminate the quoting; control chars (incl. CR/LF) could forge
 * headers. Collapse anything outside a conservative printable set to a space.
 */
function sanitizeDesc(desc: string): string {
    let out = '';
    for (const ch of String(desc)) {
        const code = ch.codePointAt(0)!;
        // Printable ASCII excluding `"` (0x22) and `\` (0x5C); drop the rest.
        if (code >= 0x20 && code < 0x7f && ch !== '"' && ch !== '\\') {
            out += ch;
        } else {
            out += ' ';
        }
    }
    return out.replace(/ +/g, ' ').trim();
}

/** Round to at most 2 decimals without trailing-zero noise (`12.3`, not `12.30`). */
function fmtDur(dur: number): string {
    if (!Number.isFinite(dur)) return '0';
    return String(Math.round(dur * 100) / 100);
}

/**
 * Serialize marks into a `Server-Timing` header value. Marks with an empty
 * name after sanitization are dropped (the grammar requires a token). Returns
 * `''` when there is nothing to emit so callers can skip the header.
 */
export function formatServerTiming(marks: readonly ServerTimingMark[]): string {
    const parts: string[] = [];
    for (const m of marks) {
        const name = sanitizeName(m.name);
        if (!name) continue;
        let part = `${name};dur=${fmtDur(m.dur)}`;
        if (m.desc) {
            const desc = sanitizeDesc(m.desc);
            if (desc) part += `;desc="${desc}"`;
        }
        parts.push(part);
    }
    return parts.join(', ');
}

/**
 * Collector for one request's timing phases. Not thread-safe by design - one
 * instance belongs to one request. All methods are allocation-light and never
 * throw on the hot path.
 */
export class PerfTiming {
    private readonly _marks: ServerTimingMark[] = [];
    /**
     * Live aggregate marks by name (see {@link count}). Lazily created so a
     * request that never aggregates pays nothing. Each entry points at a mark
     * already inserted into {@link _marks}, mutated in place as events arrive.
     */
    private _aggregates?: Map<string, { mark: ServerTimingMark; count: number; unit?: string }>;

    /** Record an already-measured phase. */
    record(name: string, dur: number, desc?: string): void {
        this._marks.push({ name, dur, desc });
    }

    /**
     * Begin timing a phase. Returns an idempotent `end()` - the first call
     * records the elapsed duration; later calls are ignored, so it is safe to
     * call from both a success and an error path.
     */
    start(name: string, desc?: string): () => void {
        const t0 = perfNow();
        let done = false;
        return () => {
            if (done) return;
            done = true;
            this.record(name, perfNow() - t0, desc);
        };
    }

    /** Time an async (or sync) function, recording its elapsed duration. */
    async measure<T>(name: string, fn: () => T | Promise<T>, desc?: string): Promise<T> {
        const end = this.start(name, desc);
        try {
            return await fn();
        } finally {
            end();
        }
    }

    /**
     * Accumulate a repeated sub-phase into a SINGLE aggregate mark. Each call
     * adds `dur` to the running total for `name` and increments a counter; the
     * mark serializes as `name;dur=<sum>;desc="<count> <unit>"` (or just the
     * bare count when no `unit` is given).
     *
     * Use this for high-frequency phases — one SQL query, one hook execution —
     * where recording a distinct mark per event would blow the header out to
     * hundreds of entries. The single `db;dur=210;desc="6 queries"` member is
     * both the total DB time and the query count, which is the number most
     * useful for spotting N sequential round-trips.
     *
     * The aggregate mark is inserted into the record stream the first time its
     * name is seen, so it keeps its natural position relative to explicit marks
     * (e.g. before the outer `total`, which is recorded last).
     */
    count(name: string, dur: number, unit?: string): void {
        const add = Number.isFinite(dur) && dur > 0 ? dur : 0;
        const aggregates = (this._aggregates ??= new Map());
        let entry = aggregates.get(name);
        if (!entry) {
            const mark: ServerTimingMark = { name, dur: 0 };
            entry = { mark, count: 0, unit };
            aggregates.set(name, entry);
            this._marks.push(mark);
        }
        entry.count += 1;
        entry.mark.dur += add;
        if (unit) entry.unit = unit;
        entry.mark.desc = entry.unit ? `${entry.count} ${entry.unit}` : String(entry.count);
    }

    /** Snapshot of recorded marks, in record order. */
    marks(): readonly ServerTimingMark[] {
        return this._marks;
    }

    /** Serialize to a `Server-Timing` header value (`''` when empty). */
    toHeader(): string {
        return formatServerTiming(this._marks);
    }
}

// --- Ambient (request-scoped) collector -------------------------------

/**
 * The ambient collector lives in ONE process-wide `AsyncLocalStorage`, pinned
 * to a global-registry symbol rather than a plain module-level `const`.
 *
 * Why: this module is consumed from many packages and can legitimately be
 * loaded more than once in a single process — the ESM build (`dist/index.js`)
 * and the CJS build (`dist/index.cjs`) are distinct module instances, and a
 * bundler may inline yet another copy. A plain `const store` would give each
 * copy its OWN store, so a request scope opened through one copy (the HTTP
 * server's `runWithPerfTiming`) would be invisible to code reading the ambient
 * collector through another copy (the SQL driver, the ObjectQL engine) — the
 * cross-layer `db` / `auth` / `hooks` spans would silently never record.
 * `Symbol.for` resolves to the same symbol across every copy, so they all share
 * the one store.
 */
const STORE_KEY = Symbol.for('@objectstack/observability:perf-timing-store');
const globalStore = globalThis as unknown as Record<symbol, AsyncLocalStorage<PerfTiming> | undefined>;
const store: AsyncLocalStorage<PerfTiming> =
    globalStore[STORE_KEY] ?? (globalStore[STORE_KEY] = new AsyncLocalStorage<PerfTiming>());

/** Run `fn` with `timing` as the ambient collector for the async call chain. */
export function runWithPerfTiming<T>(timing: PerfTiming, fn: () => T): T {
    return store.run(timing, fn);
}

/** The collector for the current request, or `undefined` outside a request. */
export function currentPerfTiming(): PerfTiming | undefined {
    return store.getStore();
}

/** Record a phase on the ambient collector. No-op when none is active. */
export function recordServerTiming(name: string, dur: number, desc?: string): void {
    store.getStore()?.record(name, dur, desc);
}

/**
 * Begin timing a phase on the ambient collector. Returns an `end()` callback;
 * when no collector is active the returned callback is a no-op so call sites
 * stay branch-free.
 */
export function startServerTiming(name: string, desc?: string): () => void {
    const t = store.getStore();
    if (!t) return () => {};
    return t.start(name, desc);
}

/**
 * Time an async function on the ambient collector. When no collector is active
 * the function is awaited with zero timing overhead.
 */
export async function measureServerTiming<T>(
    name: string,
    fn: () => T | Promise<T>,
    desc?: string,
): Promise<T> {
    const t = store.getStore();
    if (!t) return fn();
    return t.measure(name, fn, desc);
}

/**
 * Accumulate a repeated sub-phase (one SQL query, one hook execution) onto the
 * ambient collector — see {@link PerfTiming.count}. A no-op when no collector is
 * active, so the hot-path call sites (the SQL driver's query listener, the hook
 * runner) pay only a single `AsyncLocalStorage` lookup when perf-tuning is off.
 */
export function countServerTiming(name: string, dur: number, unit?: string): void {
    store.getStore()?.count(name, dur, unit);
}
