// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13079] HOW MANY EXISTING CALL SITES WOULD BREAK if the four
 * envelope-returning SDK methods started unwrapping? The per-site census.
 *
 * ⛔ This is a MEASUREMENT file. It converts nothing, repairs nothing and
 * proposes nothing. The convergence #13079 contemplates is a RUNTIME BREAKING
 * CHANGE to four published methods and a decision reserved for the maintainer;
 * this file exists only to put a number under it.
 *
 * ## The four, and the one that must not join them
 *
 * `unwrapResponse` strips the dispatcher's `{ success, data }` envelope;
 * `res.json()` strips nothing. Four methods take the second path against a
 * DISPATCHER-served route, so their callers receive the envelope:
 * `analytics.query`, `analytics.meta`, `analytics.explain`,
 * `automation.trigger`.
 *
 * ⚠️ `analytics.queryDataset` also ends `res.json()` and is NOT one of them.
 * Its route is mounted by `@objectstack/rest` and ends `res.json(result)` with
 * no envelope to strip, so it is correct as it stands. It is deliberately
 * absent from `METHODS` below and section 4 asserts that absence, because
 * folding it in is the one thing a mechanical sweep gets wrong.
 *
 * ## Why `tsc` and a type search cannot answer this
 *
 * All five were erased to `Promise< any >` until #12104 (no annotation, and
 * `lib.dom` declares `Response.json(): Promise< any >`). Under `any` BOTH
 * spellings compiled: `(await client.analytics.query(q)).rows` and
 * `.data.rows` were equally legal, and nothing in the type system
 * distinguished them. So the population cannot be recovered from types — it
 * has to come from reading call sites, which is what this file enumerates.
 *
 * ## ⭐ The method, and the false negative it was built to catch
 *
 * A "0 hits" from a grep is worthless without a positive control proving the
 * grep finds real ones. Two failure modes are measured here rather than
 * assumed, both in section 2:
 *
 *  1. **Comments dominate the raw signal.** A plain `git grep` for these four
 *     spellings returns 30 hits in this repo, and 10 of them are docblocks and
 *     inline comments naming the method — not call sites. `scanCallSites`
 *     blanks comments before matching.
 *  2. **A line-based matcher UNDER-REPORTS.** `git grep` is line-oriented, so
 *     it cannot see a call split across lines — and this repo contains exactly
 *     that shape:
 *
 *         const err: any = await client.automation
 *             .trigger('my_flow', { amount: 0 })
 *
 *     Two real `automation.trigger` call sites are spelled that way in
 *     `client.test.ts` and a line-oriented sweep misses BOTH. A short list
 *     reads as compliance, which is why section 2 pins the gap as a number
 *     instead of trusting the matcher.
 *
 * ## The receiver split — a false POSITIVE, measured the same way
 *
 * The bare spelling `analytics.query(...)` also occurs on the real
 * `AnalyticsService` in `analytics-automation-json-erasure.test.ts`, where
 * `analytics` is the SERVICE, not the client. That is a producer call and no
 * part of the SDK caller population, so every row carries its receiver and the
 * ledger classifies it `NOT_SDK`.
 *
 * ## The verdicts
 *
 *  - `ENVELOPE_DEPENDENT` — the site reads `.data`, reads the envelope's
 *    `success`, compares the whole envelope, or pins the envelope TYPE. These
 *    break if the methods start unwrapping. Every one is loud: an assertion
 *    failure or a compile error, never a silent wrong value.
 *  - `RESULT_INSENSITIVE` — the site discards the resolved value (it asserts
 *    the URL the SDK dialled) or takes the REJECTION path and reads
 *    `err.code` / `err.httpStatus`. Unwrapping cannot reach it.
 *  - `NOT_SDK` — a call on the producer service, not on the client.
 *
 * ## ⚠️ What this file does NOT measure, stated so a green run cannot be read
 * ## as a clean bill
 *
 *  - **`objectstack-ai/cloud` — NOT MEASURED.** It is not reachable from the
 *    session class that produced this census. `CLOUD_CENSUS_COMMAND` below is
 *    the ready-to-run sweep for whoever has access. An unreachable repo is not
 *    a clean one.
 *  - **Published npm consumers outside these repos — UNMEASURABLE.** The SDK
 *    ships to consumers no repo sweep can see. This census bounds the
 *    first-party population only.
 *  - **`objectui` is a RECORDED constant, not a live scan.** A test in this
 *    repo cannot read that checkout. `OBJECTUI_CENSUS` carries the revision it
 *    was measured at and the command that reproduces it.
 *  - **The ratchet in section 3 is only as live as turbo's cache.** This suite
 *    walks the whole workspace, but `@objectstack/client#test` declares as
 *    inputs its own package plus the named cross-package files — NOT every
 *    tree it reads. So a new call site added in ANOTHER package can leave this
 *    suite cached-green until something else invalidates it. Declaring
 *    `packages/**` here would re-run the client suite on virtually every
 *    commit, which is why it is recorded as a known bound rather than bought
 *    at that price: on a cold cache and in CI's full run the count is exact,
 *    and a call site added inside `packages/client` — where every site lives
 *    today — invalidates normally.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// The `.mjs` specifier is deliberate; `scripts/js-comment-mask.d.mts` beside it
// is a hand-written declaration, so this resolves with types.
//
// ⛔ NOT a private `stripComments` regex. This tree has ONE code/prose
// separator and `check:comment-mask-adoption` enforces it — a naive regex opens
// a phantom comment on any `/*` inside a string literal and then reports clean
// over code it never read, which for THIS file would silently shrink the
// census. `maskComments` blanks comment spans in place, so every byte offset
// and line number below stays true to the original file.
import { maskComments } from '../../../scripts/js-comment-mask.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `packages/client/src` → the workspace root. */
const REPO_ROOT = resolve(HERE, '../../..');

/**
 * The four DISPATCHER-served `res.json()` methods. ⛔ `queryDataset` is
 * deliberately NOT here — see the header and section 4.
 */
const METHODS: ReadonlyArray<readonly [namespace: string, method: string]> = [
    ['analytics', 'query'],
    ['analytics', 'meta'],
    ['analytics', 'explain'],
    ['automation', 'trigger'],
];

const SKIP_DIRS = new Set([
    'node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.turbo', 'out',
]);
const CODE_EXT = /\.(ts|tsx|js|mjs|cjs)$/;

type Receiver = 'sdk' | 'service';
interface Site {
    file: string;
    line: number;
    method: string;
    receiver: Receiver;
    /** Whether a LINE-oriented matcher (a plain `git grep`) would also find it. */
    visibleToLineGrep: boolean;
}

function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const p = join(dir, entry);
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) walk(p, acc);
        else if (CODE_EXT.test(entry)) acc.push(p);
    }
    return acc;
}

interface Census { sites: Site[]; filesScanned: number }

function scanCallSites(root: string): Census {
    const files = walk(root);
    const sites: Site[] = [];
    for (const abs of files) {
        let raw: string;
        try { raw = readFileSync(abs, 'utf8'); } catch { continue; }
        const code = maskComments(raw);
        const rawLines = raw.split('\n');
        for (const [ns, method] of METHODS) {
            // `\s*` spans newlines because the match runs over the WHOLE file,
            // not line by line — that is what catches the split-call shape.
            const re = new RegExp(`([A-Za-z0-9_$.\\]\\)]{0,40}?)\\b${ns}\\s*\\.\\s*${method}\\s*\\(`, 'g');
            let m: RegExpExecArray | null;
            while ((m = re.exec(code)) !== null) {
                const line = code.slice(0, m.index).split('\n').length;
                const onOneLine = new RegExp(`\\b${ns}\\s*\\.\\s*${method}\\s*\\(`).test(rawLines[line - 1] ?? '');
                sites.push({
                    file: relative(root, abs).split('\\').join('/'),
                    line,
                    method: `${ns}.${method}`,
                    receiver: /client\.$/.test(m[1] ?? '') ? 'sdk' : 'service',
                    visibleToLineGrep: onOneLine,
                });
            }
        }
    }
    sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    return { sites, filesScanned: files.length };
}

const CENSUS = scanCallSites(REPO_ROOT);

// ---------------------------------------------------------------------------
// The classification ledger — reviewed by hand, cross-checked mechanically
// ---------------------------------------------------------------------------

type Verdict = 'ENVELOPE_DEPENDENT' | 'RESULT_INSENSITIVE' | 'NOT_SDK';

interface LedgerRow {
    file: string;
    method: string;
    receiver: Receiver;
    count: number;
    verdict: Verdict;
    why: string;
}

/**
 * Every call site this repo contains, classified. Keyed by
 * (file, method, receiver) rather than by line so an unrelated edit that
 * shifts a line does not turn this red — while a NEW call site anywhere in
 * the workspace still does, which is the point: the number cannot drift in
 * silence.
 */
const LEDGER: readonly LedgerRow[] = [
    // ── the #12104 wire measurement: reads `.data` and `success` throughout ──
    {
        file: 'packages/client/src/analytics-automation-json-erasure.test.ts',
        method: 'analytics.query', receiver: 'sdk', count: 1, verdict: 'ENVELOPE_DEPENDENT',
        why: 'asserts Object.keys(body) === [data, meta, success], body.success and body.data.rows',
    },
    {
        file: 'packages/client/src/analytics-automation-json-erasure.test.ts',
        method: 'analytics.query', receiver: 'service', count: 1, verdict: 'NOT_SDK',
        why: 'the real AnalyticsService, called to assert body.data equals what the producer returned',
    },
    {
        file: 'packages/client/src/analytics-automation-json-erasure.test.ts',
        method: 'analytics.meta', receiver: 'sdk', count: 2, verdict: 'ENVELOPE_DEPENDENT',
        why: 'body.success / body.data, and a whole-envelope toEqual against the dispatcher body',
    },
    {
        file: 'packages/client/src/analytics-automation-json-erasure.test.ts',
        method: 'analytics.explain', receiver: 'sdk', count: 1, verdict: 'ENVELOPE_DEPENDENT',
        why: 'body.success and Object.keys(body.data) === [params, sql]',
    },
    {
        file: 'packages/client/src/analytics-automation-json-erasure.test.ts',
        method: 'automation.trigger', receiver: 'sdk', count: 1, verdict: 'ENVELOPE_DEPENDENT',
        why: 'body.success and body.data.status / runId / screen',
    },
    // ── the #12104 type pins: bind the envelope, and refuse the payload read ──
    {
        file: 'packages/client/src/return-type-precision.test.ts',
        method: 'analytics.query', receiver: 'sdk', count: 2, verdict: 'ENVELOPE_DEPENDENT',
        why: 'expectTypeOf === BaseResponse & { data: AnalyticsResult }, plus a @ts-expect-error on .rows',
    },
    {
        file: 'packages/client/src/return-type-precision.test.ts',
        method: 'analytics.meta', receiver: 'sdk', count: 2, verdict: 'ENVELOPE_DEPENDENT',
        why: 'expectTypeOf === AnalyticsMetadataResponse, plus a @ts-expect-error on .length',
    },
    {
        file: 'packages/client/src/return-type-precision.test.ts',
        method: 'analytics.explain', receiver: 'sdk', count: 2, verdict: 'ENVELOPE_DEPENDENT',
        why: 'expectTypeOf === AnalyticsSqlResponse, plus a @ts-expect-error on .sql',
    },
    {
        file: 'packages/client/src/return-type-precision.test.ts',
        method: 'automation.trigger', receiver: 'sdk', count: 2, verdict: 'ENVELOPE_DEPENDENT',
        why: 'expectTypeOf === BaseResponse & { data: AutomationResult }, plus a @ts-expect-error on .runId',
    },
    // ── URL and rejection pins: the resolved value is never read ─────────────
    {
        file: 'packages/client/src/client.test.ts',
        method: 'automation.trigger', receiver: 'sdk', count: 3, verdict: 'RESULT_INSENSITIVE',
        why: 'one asserts the dialled URL only; two take the rejection path and read err.code / err.httpStatus',
    },
    {
        file: 'packages/client/src/client.test.ts',
        method: 'analytics.meta', receiver: 'sdk', count: 2, verdict: 'RESULT_INSENSITIVE',
        why: 'asserts the dialled URL (bare, and the ?cube= filter); the resolved value is discarded',
    },
    {
        file: 'packages/client/src/client.test.ts',
        method: 'analytics.explain', receiver: 'sdk', count: 1, verdict: 'RESULT_INSENSITIVE',
        why: 'asserts POST /analytics/sql and the body; the resolved value is discarded',
    },
];

/**
 * `objectui` @ b84dc1854922c266850d6e573daf3ad59cbd0623 (origin/main,
 * 2026-08-31). Recorded, not live-scanned — a test here cannot read that
 * checkout. Reproduce with `OBJECTUI_CENSUS_COMMAND`.
 *
 * ⭐ The single production call site in either reachable repo, and it SURVIVES
 * convergence untouched. `aggregate()` feeds the resolved value through a
 * tolerant chain that already accepts both spellings:
 *
 *     const rawRows = Array.isArray(data) ? data
 *       : data?.rows        && Array.isArray(data.rows)        ? data.rows        // post-unwrap
 *       : data?.data        && Array.isArray(data.data)        ? data.data
 *       : data?.data?.rows  && Array.isArray(data.data.rows)   ? data.data.rows   // envelope, today
 *       : data?.results     && Array.isArray(data.results)     ? data.results
 *       : [];
 *
 * Today branch 4 matches; after convergence branch 2 matches. ⚠️ It survives
 * by DEFENSIVE CODING, not by a designed migration path — the adapter was
 * written tolerant because the producer was ambiguous, which is the shape a
 * contract-first fix is supposed to remove rather than rely on.
 */
const OBJECTUI_CENSUS = {
    revision: 'b84dc1854922c266850d6e573daf3ad59cbd0623',
    filesScanned: 4024,
    sdkCallSites: 1,
    productionCallSites: 1,
    wouldBreak: 0,
    site: 'packages/data-objectstack/src/index.ts:4846 (analytics.query, via this.client)',
} as const;

const OBJECTUI_CENSUS_COMMAND =
    "git -C <objectui> grep -nE 'analytics\\s*\\.\\s*(query|meta|explain)\\s*\\(|automation\\s*\\.\\s*trigger\\s*\\(' origin/main -- '*.ts' '*.tsx' '*.js'";

/** ⛔ `objectstack-ai/cloud` is NOT MEASURED — see the header. */
const CLOUD_CENSUS_COMMAND =
    "git -C <cloud> fetch origin main && git -C <cloud> grep -nE 'analytics\\s*\\.\\s*(query|meta|explain)\\s*\\(|automation\\s*\\.\\s*trigger\\s*\\(' origin/main -- '*.ts' '*.tsx' '*.js'"
    + " # then re-check for SPLIT calls, which a line-oriented grep misses:"
    + " git -C <cloud> grep -nE '\\.(analytics|automation)\\s*$' origin/main -- '*.ts' '*.tsx' '*.js'";

const CLOUD_CENSUS = { status: 'NOT_MEASURED', reason: 'repo not reachable from this session class' } as const;

const sdkSites = CENSUS.sites.filter((s) => s.receiver === 'sdk');
const ledgerTotal = LEDGER.reduce((n, r) => n + r.count, 0);
const verdictTotal = (v: Verdict) =>
    LEDGER.filter((r) => r.verdict === v).reduce((n, r) => n + r.count, 0);

// ---------------------------------------------------------------------------

describe('#13079 §1 — the population actually swept', () => {
    it('sweeps the whole workspace, not just the client package', () => {
        // A census that silently scanned an empty tree would report zero call
        // sites and read as "nothing to migrate". This is the floor that makes
        // a low count meaningful.
        expect(CENSUS.filesScanned).toBeGreaterThan(4000);
    });

    it('reaches the example and app trees, where a consumer would most likely live', () => {
        const tops = new Set(walk(REPO_ROOT).map((p) => relative(REPO_ROOT, p).split(/[\\/]/)[0]));
        expect(tops.has('packages')).toBe(true);
        expect(tops.has('examples')).toBe(true);
        expect(tops.has('apps')).toBe(true);
    });
});

describe('#13079 §2 — positive controls on the matcher itself', () => {
    it('finds real call sites (a zero here would invalidate every count below)', () => {
        expect(sdkSites.length).toBeGreaterThan(0);
        const files = new Set(sdkSites.map((s) => s.file));
        expect(files.has('packages/client/src/analytics-automation-json-erasure.test.ts')).toBe(true);
        expect(files.has('packages/client/src/return-type-precision.test.ts')).toBe(true);
        expect(files.has('packages/client/src/client.test.ts')).toBe(true);
    });

    it('⭐ catches the SPLIT calls a line-oriented grep misses, and reports the gap', () => {
        const missedByLineGrep = CENSUS.sites.filter((s) => !s.visibleToLineGrep);
        // Both are `await client.automation` / newline / `.trigger(...)`.
        expect(missedByLineGrep.length).toBe(2);
        expect(missedByLineGrep.every((s) => s.method === 'automation.trigger')).toBe(true);
        expect(missedByLineGrep.every((s) => s.file === 'packages/client/src/client.test.ts')).toBe(true);
    });

    it('does not count comment mentions as call sites', () => {
        // `domains/automation.ts` names `client.automation.trigger()` in four
        // docblocks and calls it nowhere; a raw grep reports those as hits.
        const runtimeDomain = CENSUS.sites.filter((s) => s.file.startsWith('packages/runtime/'));
        expect(runtimeDomain).toEqual([]);
    });

    it('separates the producer-service receiver from the SDK receiver', () => {
        const service = CENSUS.sites.filter((s) => s.receiver === 'service');
        expect(service.length).toBe(1);
        expect(service[0]?.file).toBe('packages/client/src/analytics-automation-json-erasure.test.ts');
    });
});

describe('#13079 §3 — every call site is classified', () => {
    it('the mechanical enumeration and the hand ledger agree, site for site', () => {
        const enumerated = new Map<string, number>();
        for (const s of CENSUS.sites) {
            const k = `${s.file}|${s.method}|${s.receiver}`;
            enumerated.set(k, (enumerated.get(k) ?? 0) + 1);
        }
        const ledgered = new Map<string, number>();
        for (const r of LEDGER) ledgered.set(`${r.file}|${r.method}|${r.receiver}`, r.count);

        // An UNCLASSIFIED site is the failure this ratchet exists to produce:
        // whoever adds a call site to these four methods must say what it reads.
        expect(Object.fromEntries([...enumerated].sort())).toEqual(
            Object.fromEntries([...ledgered].sort()),
        );
        expect(ledgerTotal).toBe(CENSUS.sites.length);
    });

    it('⭐ THE NUMBER: zero call sites in this repo would break SILENTLY', () => {
        // Every envelope-dependent site is a test assertion or a type pin —
        // loud by construction. There is no production call site in this repo.
        const production = sdkSites.filter((s) => !/\.test\.tsx?$/.test(s.file));
        expect(production).toEqual([]);
    });

    it('records the split: 13 loud pin sites, 6 result-insensitive, 1 not-SDK', () => {
        expect(verdictTotal('ENVELOPE_DEPENDENT')).toBe(13);
        expect(verdictTotal('RESULT_INSENSITIVE')).toBe(6);
        expect(verdictTotal('NOT_SDK')).toBe(1);
        expect(sdkSites.length).toBe(19);
    });
});

describe('#13079 §4 — `analytics.queryDataset` is a protected counter-example', () => {
    it('is not in the affected set', () => {
        expect(METHODS.some(([, m]) => m === 'queryDataset')).toBe(false);
        expect(CENSUS.sites.some((s) => s.method.includes('queryDataset'))).toBe(false);
    });

    it('is served BARE by @objectstack/rest — there is no envelope to strip', () => {
        // Read from the SDK source rather than restated, so a change to the
        // method cannot leave this claim behind.
        const src = readFileSync(join(HERE, 'index.ts'), 'utf8');
        expect(src).toMatch(/queryDataset:\s*async/);
        expect(src).toMatch(/analytics\/dataset\/query/);
        // Its sibling `query` dials the dispatcher route; these are two dialects.
        expect(src).toMatch(/\$\{route\}\/query/);
    });
});

describe('#13079 §5 — what was NOT measured', () => {
    it('objectui is recorded with its revision, and its one production site survives', () => {
        expect(OBJECTUI_CENSUS.productionCallSites).toBe(1);
        expect(OBJECTUI_CENSUS.wouldBreak).toBe(0);
        expect(OBJECTUI_CENSUS.revision).toMatch(/^[0-9a-f]{40}$/);
        expect(OBJECTUI_CENSUS_COMMAND).toContain('origin/main');
    });

    it('⛔ cloud is NOT MEASURED and must not be read as clean', () => {
        expect(CLOUD_CENSUS.status).toBe('NOT_MEASURED');
        // The ready-to-run sweep includes the split-call second pass, because
        // the single-line form alone under-reported by 2 in THIS repo.
        expect(CLOUD_CENSUS_COMMAND).toContain('fetch origin main');
        expect(CLOUD_CENSUS_COMMAND).toContain('(analytics|automation)');
    });
});
