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
import type { ExecutionContext } from '@objectstack/spec/kernel';

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
 * One recorded sub-event when DETAIL capture is on (see
 * {@link PerfTiming.enableDetail}). Unlike the aggregate `db` mark — which folds
 * every query into a single count+duration — a detail sample keeps the
 * individual event so an admin can see *which* queries ran and which was
 * slowest. `label` is a description of the event (for SQL: the PARAMETRIZED
 * statement, bindings stripped — the query shape, never literal row values).
 */
export interface ServerTimingDetail {
    /** Event label — e.g. a parametrized SQL statement (no bindings). */
    label: string;
    /** Duration in milliseconds. */
    dur: number;
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
    /**
     * Per-event detail samples by category, populated only while detail capture
     * is on (see {@link enableDetail}). Lazily created so a request that never
     * enables detail pays nothing.
     */
    private _detail?: Map<string, ServerTimingDetail[]>;
    private _detailOn = false;
    /**
     * Hard cap on stored detail samples per category — detail is only ever on
     * for a deliberate debug request, but a pathological request must not pin
     * unbounded memory. The aggregate {@link count} still reflects the true
     * total; only the retained per-event list is bounded.
     */
    private static readonly DETAIL_CAP = 1000;

    /** Record an already-measured phase. */
    record(name: string, dur: number, desc?: string): void {
        this._marks.push({ name, dur, desc });
    }

    /**
     * Turn on per-event DETAIL capture for this request. Off by default so the
     * hot path never allocates a per-event list; the HTTP middleware enables it
     * only for an admin-gated `X-OS-Debug-Timing: json` request. Idempotent.
     */
    enableDetail(): void {
        this._detailOn = true;
    }

    /** Whether per-event detail capture is on. */
    get detailEnabled(): boolean {
        return this._detailOn;
    }

    /**
     * Record one per-event detail sample under `category` (e.g. `'db'`). A no-op
     * unless {@link enableDetail} was called, so the hot-path call site (the SQL
     * driver's query listener) pays only a boolean check when detail is off.
     * Bounded by {@link DETAIL_CAP}; excess events still count toward the
     * aggregate via {@link count} but are not retained individually.
     */
    recordDetail(category: string, label: string, dur: number): void {
        if (!this._detailOn) return;
        const detail = (this._detail ??= new Map());
        let list = detail.get(category);
        if (!list) {
            list = [];
            detail.set(category, list);
        }
        if (list.length >= PerfTiming.DETAIL_CAP) return;
        list.push({ label: String(label), dur: Number.isFinite(dur) && dur > 0 ? dur : 0 });
    }

    /** Retained detail samples for `category`, in record order (empty when none). */
    details(category: string): readonly ServerTimingDetail[] {
        return this._detail?.get(category) ?? [];
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

/**
 * Record a per-event DETAIL sample (e.g. one parametrized SQL statement) onto
 * the ambient collector — see {@link PerfTiming.recordDetail}. A no-op when no
 * collector is active OR detail capture is off, so the hot-path call site pays
 * only an `AsyncLocalStorage` lookup + a boolean check when not debugging.
 */
export function recordServerTimingDetail(category: string, label: string, dur: number): void {
    store.getStore()?.recordDetail(category, label, dur);
}

// --- Disclosure gate (WHO may see the timing) -------------------------

/**
 * Per-request disclosure gate — the policy counterpart to the collector.
 *
 * The {@link PerfTiming} collector only MEASURES; whether the measured
 * `Server-Timing` header is returned to the client is a separate decision. When
 * perf-tuning is turned on GLOBALLY (env flag / plugin option) the operator has
 * opted the whole environment in, so the gate opens up front and every response
 * carries the header. When it is turned on PER-REQUEST — the caller sends an
 * `X-OS-Debug-Timing` header — the header must stay withheld until the request
 * proves an admin/service identity: phase durations are a mild
 * backend-fingerprinting surface, so an ordinary user must never be able to pull
 * them just by sending a header. The request path flips the gate open with
 * {@link allowPerfDisclosure} once it has resolved a privileged principal.
 *
 * Keeping this out of {@link PerfTiming} preserves the collector's invariant
 * ("it only measures, it never decides whether to emit").
 *
 * Two levels, because global mode discloses the basic header to everyone but the
 * richer per-query detail must stay admin-only:
 *  - `allowed`    — the basic `Server-Timing` header may be disclosed (opened by
 *                   global mode for everyone, or by a proven admin per-request).
 *  - `privileged` — the principal is a proven admin/service. Gates the richer,
 *                   SQL-shape-bearing detail payload, which must NEVER reach an
 *                   ordinary caller even when global mode is on.
 */
export interface PerfDisclosureGate {
    /** Whether the basic collected timing may be disclosed to the client. */
    allowed: boolean;
    /**
     * Whether the principal is a proven admin/service — gates the richer detail
     * payload independently of `allowed`. Absent = not privileged.
     */
    privileged?: boolean;
}

/**
 * The disclosure gate lives in its OWN global-registry-pinned
 * `AsyncLocalStorage`, for the same cross-module-copy reason as the collector
 * store above: the middleware seeds the gate and the dispatcher (a different
 * package, possibly a different module copy) flips it open — both must see the
 * one store.
 */
const GATE_KEY = Symbol.for('@objectstack/observability:perf-disclosure-gate');
const globalGate = globalThis as unknown as Record<symbol, AsyncLocalStorage<PerfDisclosureGate> | undefined>;
const gateStore: AsyncLocalStorage<PerfDisclosureGate> =
    globalGate[GATE_KEY] ?? (globalGate[GATE_KEY] = new AsyncLocalStorage<PerfDisclosureGate>());

/**
 * Run `fn` with `gate` as the ambient disclosure gate for the async call chain.
 * The caller keeps its reference to `gate` and reads `gate.allowed` after `fn`
 * settles to decide whether to emit the header.
 */
export function runWithPerfDisclosure<T>(gate: PerfDisclosureGate, fn: () => T): T {
    return gateStore.run(gate, fn);
}

/**
 * Open the ambient disclosure gate — the request has proven an admin/service
 * identity, so it may see its own `Server-Timing` header AND the richer detail
 * payload. Sets both {@link PerfDisclosureGate.allowed} and `privileged`. A
 * no-op when no gate is active (perf-tuning off), so the call site stays
 * branch-free.
 */
export function allowPerfDisclosure(): void {
    const g = gateStore.getStore();
    if (g) {
        g.allowed = true;
        g.privileged = true;
    }
}

/** Whether the ambient disclosure gate is open. `false` when none is active. */
export function isPerfDisclosureAllowed(): boolean {
    return gateStore.getStore()?.allowed ?? false;
}

/**
 * Whether the ambient principal is a proven admin/service — gates the richer
 * detail payload. `false` when no gate is active or only global-mode disclosure
 * (not a proven admin) opened it.
 */
export function isPerfDisclosurePrivileged(): boolean {
    return gateStore.getStore()?.privileged ?? false;
}

/**
 * Whether a resolved principal may see a PER-REQUEST `Server-Timing` header
 * (#2408 perf-tuning gating). The header exposes internal phase durations — a
 * mild backend-fingerprinting surface — so when timing is opened per-request via
 * `X-OS-Debug-Timing` it is disclosed only to an admin/service identity:
 *
 *  - `isSystem` — internal/engine self-calls,
 *  - `principalKind` `service` / `system` — service tokens & the system seed,
 *  - `posture` `PLATFORM_ADMIN` / `TENANT_ADMIN` — the derived admin rungs.
 *
 * Ordinary human/guest/agent callers get `false`, so sending the debug header
 * yields no header for them. Global (env/option) perf mode bypasses this — it
 * opened the disclosure gate up front for the whole environment.
 *
 * This is the ONE definition of "who may pull per-request timings", shared by
 * every HTTP entry point that resolves a principal — the runtime dispatcher
 * (`timedResolveExecutionContext`), the REST server, and the standalone Hono
 * CRUD surface — so a new admin-serving path can never silently under- or
 * over-disclose by hand-rolling its own rule (#3361).
 */
export function isPerfDisclosurePrincipal(ec: ExecutionContext | undefined): boolean {
    if (!ec) return false;
    if (ec.isSystem === true) return true;
    if (ec.principalKind === 'service' || ec.principalKind === 'system') return true;
    return ec.posture === 'PLATFORM_ADMIN' || ec.posture === 'TENANT_ADMIN';
}
