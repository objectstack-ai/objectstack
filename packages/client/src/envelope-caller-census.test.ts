// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13079] THE CALL-SITE CENSUS of the four SDK methods the 2026-08-31 ruling
 * converged on `unwrapResponse` — regenerated to describe the POST-convergence
 * world, and kept as the ratchet that stops the envelope read from returning.
 *
 * ⛔ This is a MEASUREMENT file. It converts nothing and repairs nothing. PR
 * #13647 wrote it to put a number under the decision the card carried ("how
 * many callers break if the four start unwrapping?" — 13 loud in-repo pins,
 * zero production sites); the ruling took option A on that number; and this
 * revision re-measures the same population after the conversion, so a green
 * run now means: zero call sites in this repo still read the envelope off
 * these four, and the four really end in `unwrapResponse`.
 *
 * ## The four, and the one that must not join them
 *
 * `unwrapResponse` strips the dispatcher's `{ success, data }` envelope;
 * `res.json()` strips nothing. Four DISPATCHER-served methods used to take the
 * second path and hand their callers the envelope: `analytics.query`,
 * `analytics.meta`, `analytics.explain`, `automation.trigger`. Since #13079
 * all four end `unwrapResponse` — section 4 reads that off the SDK source.
 *
 * ⚠️ `analytics.queryDataset` also ends `res.json()` and is NOT one of them.
 * Its route is mounted by `@objectstack/rest` and ends `res.json(result)` with
 * no envelope to strip, so `res.json()` there IS the payload read. It is
 * deliberately absent from `METHODS` below, section 4 asserts that absence
 * AND that its source still reads `res.json()`, because folding it in is the
 * one thing a mechanical sweep gets wrong (ruling item 1: protected).
 *
 * ## Why `tsc` and a type search could not answer the original question
 *
 * All five were erased to `Promise< any >` until #12104 (no annotation, and
 * `lib.dom` declares `Response.json(): Promise< any >`). Under `any` BOTH
 * spellings compiled: `(await client.analytics.query(q)).rows` and
 * `.data.rows` were equally legal, and nothing in the type system
 * distinguished them. So the population could not be recovered from types —
 * it had to come from reading call sites, which is what this file enumerates.
 * After #13079 the type system DOES refuse the envelope read (the reversed
 * `@ts-expect-error` pins in `return-type-precision.test.ts`) — for
 * TypeScript callers. A JavaScript caller, or a call reached through a
 * runtime alias, is still only visible to a source scan, which is why the
 * scan stays.
 *
 * ## ⭐ The method, and the false negative it was built to catch
 *
 * A "0 hits" from a grep is worthless without a positive control proving the
 * grep finds real ones. Two failure modes are measured here rather than
 * assumed, both in section 2:
 *
 *  1. **Comments dominate the raw signal.** A plain `git grep` for these four
 *     spellings returns dozens of hits in this repo, and many are docblocks
 *     and inline comments naming the method — not call sites. `scanCallSites`
 *     blanks comments before matching.
 *  2. **A line-based matcher UNDER-REPORTS.** `git grep` is line-oriented, so
 *     it cannot see a call split across lines — and this repo contains exactly
 *     that shape:
 *
 *         const err: any = await client.automation
 *             .trigger('my_flow', { amount: 0 })
 *
 *     Five SDK call sites are spelled that way today (two in `client.test.ts`,
 *     three in `envelope-convergence.test.ts`) and a line-oriented sweep misses
 *     ALL of them. A short list reads as compliance, which is why section 2
 *     pins the gap as a number instead of trusting the matcher.
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
 *  - `ENVELOPE_DEPENDENT` — the site reads `.data` off the resolved value,
 *    reads the envelope's `success`, compares the whole envelope, or pins the
 *    envelope TYPE. After #13079 such a site is a BUG (a runtime `undefined`
 *    or a type error), and section 3 ratchets the count at ZERO.
 *  - `PAYLOAD_DEPENDENT` — the site reads the post-unwrap payload (`.rows`,
 *    `[0].name`, `.sql`, `.status` …), asserts the envelope keys are absent,
 *    or pins the payload TYPE. These are the convergence's own pins: every one
 *    goes red if a method slides back to `res.json()`.
 *  - `RESULT_INSENSITIVE` — the site discards the resolved value (it asserts
 *    the URL the SDK dialled), takes the REJECTION path and reads
 *    `err.code` / `err.httpStatus`, or reads a body BOTH readers hand back
 *    unchanged (a 2xx with no `data` key). The reader cannot reach it.
 *  - `NOT_SDK` — a call on the producer service, not on the client.
 *
 * ## ⚠️ What this file does NOT measure, stated so a green run cannot be read
 * ## as a clean bill
 *
 *  - **`objectstack-ai/cloud` — NOT MEASURED, and RULED so.** It is not
 *    reachable from the session class that produced this census, and the
 *    maintainer ruled the convergence with that cell recorded as unmeasured
 *    (2026-08-31, 「A,cloud 未测量照裁」). ⚠️ Since #13079 a `.data` read on any of
 *    these four methods in cloud is a RUNTIME BREAK, not a style difference:
 *    the value is the payload, so `.data` is `undefined`. `CLOUD_CENSUS_COMMAND`
 *    below is the ready-to-run sweep; any seat with access should run it
 *    inside the migration wave and record a non-zero result on #13079.
 *  - **Published npm consumers outside these repos — UNMEASURABLE.** The SDK
 *    ships to consumers no repo sweep can see; the changeset carries their
 *    migration. This census bounds the first-party population only.
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
 * The four DISPATCHER-served methods the ruling converged. ⛔ `queryDataset`
 * is deliberately NOT here — see the header and section 4.
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

type Verdict = 'ENVELOPE_DEPENDENT' | 'PAYLOAD_DEPENDENT' | 'RESULT_INSENSITIVE' | 'NOT_SDK';

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
 * silence. A key may carry MORE than one row when its sites split across
 * verdicts (a payload pin beside a rejection-path pin in one file); section 3
 * sums a key's rows before comparing.
 */
const LEDGER: readonly LedgerRow[] = [
    // ── the mocked-transport convergence pins (`envelope-convergence.test.ts`) ──
    {
        file: 'packages/client/src/envelope-convergence.test.ts',
        method: 'analytics.query', receiver: 'sdk', count: 1, verdict: 'PAYLOAD_DEPENDENT',
        why: 'asserts the value equals the `data` member and that success/data/meta are absent',
    },
    {
        file: 'packages/client/src/envelope-convergence.test.ts',
        method: 'analytics.query', receiver: 'sdk', count: 1, verdict: 'RESULT_INSENSITIVE',
        why: 'takes the rejection path of a 400 envelope and reads err.code / err.httpStatus',
    },
    {
        file: 'packages/client/src/envelope-convergence.test.ts',
        method: 'analytics.meta', receiver: 'sdk', count: 1, verdict: 'PAYLOAD_DEPENDENT',
        why: 'asserts a bare array equal to `data`, reads [0].name and [0].measures',
    },
    {
        file: 'packages/client/src/envelope-convergence.test.ts',
        method: 'analytics.explain', receiver: 'sdk', count: 1, verdict: 'PAYLOAD_DEPENDENT',
        why: 'asserts Object.keys(value) === [params, sql] and reads .sql / .params',
    },
    {
        file: 'packages/client/src/envelope-convergence.test.ts',
        method: 'automation.trigger', receiver: 'sdk', count: 2, verdict: 'PAYLOAD_DEPENDENT',
        why: 'the run itself (status / runId / screen, no `data`), and the exactly-once strip on a payload carrying its own `success`',
    },
    {
        file: 'packages/client/src/envelope-convergence.test.ts',
        method: 'automation.trigger', receiver: 'sdk', count: 3, verdict: 'RESULT_INSENSITIVE',
        why: 'two rejection-path reads (400 FLOW_FAILED, 409 FLOW_DISABLED) and the 2xx no-`data` pass-through, which both readers hand back unchanged',
    },
    // ── the producer-backed wire measurement: reads the payload throughout ──
    {
        file: 'packages/client/src/analytics-automation-json-erasure.test.ts',
        method: 'analytics.query', receiver: 'sdk', count: 1, verdict: 'PAYLOAD_DEPENDENT',
        why: 'asserts success/data absent and the value equals what the producer returned, reads .rows',
    },
    {
        file: 'packages/client/src/analytics-automation-json-erasure.test.ts',
        method: 'analytics.query', receiver: 'service', count: 1, verdict: 'NOT_SDK',
        why: 'the real AnalyticsService, called to assert the SDK value equals what the producer returned',
    },
    {
        file: 'packages/client/src/analytics-automation-json-erasure.test.ts',
        method: 'analytics.meta', receiver: 'sdk', count: 2, verdict: 'PAYLOAD_DEPENDENT',
        why: 'a bare array equal to getMeta(), and a whole-value toEqual against the dispatcher body\'s `data`',
    },
    {
        file: 'packages/client/src/analytics-automation-json-erasure.test.ts',
        method: 'analytics.explain', receiver: 'sdk', count: 1, verdict: 'PAYLOAD_DEPENDENT',
        why: 'Object.keys(value) === [params, sql]',
    },
    {
        file: 'packages/client/src/analytics-automation-json-erasure.test.ts',
        method: 'automation.trigger', receiver: 'sdk', count: 1, verdict: 'PAYLOAD_DEPENDENT',
        why: 'reads .status / .runId / .screen at the top level, asserts no `data`, equals execute()\'s value',
    },
    // ── the type pins: bind the payload, and refuse the envelope read ─────────
    {
        file: 'packages/client/src/return-type-precision.test.ts',
        method: 'analytics.query', receiver: 'sdk', count: 2, verdict: 'PAYLOAD_DEPENDENT',
        why: 'expectTypeOf === AnalyticsResult, plus a @ts-expect-error on .data',
    },
    {
        file: 'packages/client/src/return-type-precision.test.ts',
        method: 'analytics.meta', receiver: 'sdk', count: 2, verdict: 'PAYLOAD_DEPENDENT',
        why: 'expectTypeOf === AnalyticsMetadataResponse[data], plus a @ts-expect-error on .data',
    },
    {
        file: 'packages/client/src/return-type-precision.test.ts',
        method: 'analytics.explain', receiver: 'sdk', count: 2, verdict: 'PAYLOAD_DEPENDENT',
        why: 'expectTypeOf === AnalyticsSqlResponse[data], plus a @ts-expect-error on .data',
    },
    {
        file: 'packages/client/src/return-type-precision.test.ts',
        method: 'automation.trigger', receiver: 'sdk', count: 2, verdict: 'PAYLOAD_DEPENDENT',
        why: 'expectTypeOf === AutomationResult, plus a @ts-expect-error on .data',
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
 * the convergence untouched. `aggregate()` feeds the resolved value through a
 * tolerant chain that accepts both spellings:
 *
 *     const rawRows = Array.isArray(data) ? data
 *       : data?.rows        && Array.isArray(data.rows)        ? data.rows        // post-#13079: this branch
 *       : data?.data        && Array.isArray(data.data)        ? data.data
 *       : data?.data?.rows  && Array.isArray(data.data.rows)   ? data.data.rows   // pre-#13079: this branch
 *       : data?.results     && Array.isArray(data.results)     ? data.results
 *       : [];
 *
 * Before #13079 branch 4 matched; after it branch 2 matches. ⚠️ It survives
 * by DEFENSIVE CODING, not by a designed migration path — the adapter was
 * written tolerant because the producer was ambiguous, which is the shape a
 * contract-first fix removes rather than relies on. Ruling item 3: objectui#7028
 * tightens the chain to the single post-unwrap spelling, time-gated behind
 * this convergence landing and objectui taking the SDK version — the chain is
 * load-bearing until then, so it is deliberately NOT part of this change.
 */
const OBJECTUI_CENSUS = {
    revision: 'b84dc1854922c266850d6e573daf3ad59cbd0623',
    filesScanned: 4024,
    sdkCallSites: 1,
    productionCallSites: 1,
    wouldBreak: 0,
    site: 'packages/data-objectstack/src/index.ts:4846 (analytics.query, via this.client)',
    tighteningOwner: 'objectui#7028',
} as const;

const OBJECTUI_CENSUS_COMMAND =
    "git -C <objectui> grep -nE 'analytics\\s*\\.\\s*(query|meta|explain)\\s*\\(|automation\\s*\\.\\s*trigger\\s*\\(' origin/main -- '*.ts' '*.tsx' '*.js'";

/**
 * ⛔ `objectstack-ai/cloud` is NOT MEASURED — see the header. Post-#13079
 * semantics for whoever runs it: every hit is a call that now resolves to the
 * PAYLOAD, so a `.data` read on the resolved value at that site is a runtime
 * break (`undefined`), and a read of the envelope's `success` is one too.
 * Classify each hit the way `LEDGER` does; record non-zero results on #13079.
 */
const CLOUD_CENSUS_COMMAND =
    "git -C <cloud> fetch origin main && git -C <cloud> grep -nE 'analytics\\s*\\.\\s*(query|meta|explain)\\s*\\(|automation\\s*\\.\\s*trigger\\s*\\(' origin/main -- '*.ts' '*.tsx' '*.js'"
    + " # then re-check for SPLIT calls, which a line-oriented grep misses:"
    + " git -C <cloud> grep -nE '\\.(analytics|automation)\\s*$' origin/main -- '*.ts' '*.tsx' '*.js'"
    + " # post-#13079: a `.data` read on any hit is a RUNTIME BREAK (the value is the payload now); record non-zero on #13079";

const CLOUD_CENSUS = {
    status: 'NOT_MEASURED',
    reason: 'repo not reachable from this session class; ruled as such on 2026-08-31 (「A,cloud 未测量照裁」)',
} as const;

const sdkSites = CENSUS.sites.filter((s) => s.receiver === 'sdk');
const ledgerTotal = LEDGER.reduce((n, r) => n + r.count, 0);
const verdictTotal = (v: Verdict) =>
    LEDGER.filter((r) => r.verdict === v).reduce((n, r) => n + r.count, 0);

/**
 * The SDK source of one namespace's method, from `NAME: async` to the closing
 * `},` at the same indentation — so section 4 reads what each method ENDS with
 * off the source rather than restating it. Anchored to the NAMESPACE first
 * (`analytics = {` … `};` is a class field at two-space indentation) because
 * `query: async` and `explain: async` are spelled in other namespaces too, and
 * the first match in the file is not the analytics one.
 */
function methodSource(src: string, ns: string, name: string): string {
    const block = new RegExp(`\\n  ${ns} = \\{[\\s\\S]*?\\n  \\};`).exec(src);
    if (!block) throw new Error(`namespace \`${ns}\` not found in index.ts`);
    const m = new RegExp(`\\n(\\s+)${name}: async[\\s\\S]*?\\n\\1\\},`).exec(block[0]);
    if (!m) throw new Error(`method \`${ns}.${name}\` not found in index.ts`);
    return m[0];
}

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
        expect(files.has('packages/client/src/envelope-convergence.test.ts')).toBe(true);
        expect(files.has('packages/client/src/analytics-automation-json-erasure.test.ts')).toBe(true);
        expect(files.has('packages/client/src/return-type-precision.test.ts')).toBe(true);
        expect(files.has('packages/client/src/client.test.ts')).toBe(true);
    });

    it('⭐ catches the SPLIT calls a line-oriented grep misses, and reports the gap', () => {
        const missedByLineGrep = CENSUS.sites.filter((s) => !s.visibleToLineGrep);
        // `await client.automation` / newline / `.trigger(...)` twice in
        // `client.test.ts`; the same shape twice for `trigger` and once for
        // `analytics.query` in `envelope-convergence.test.ts`.
        expect(missedByLineGrep.length).toBe(5);
        const byFile = new Map<string, string[]>();
        for (const s of missedByLineGrep) byFile.set(s.file, [...(byFile.get(s.file) ?? []), s.method]);
        expect(Object.fromEntries([...byFile].map(([f, ms]) => [f, ms.sort()]))).toEqual({
            'packages/client/src/client.test.ts': ['automation.trigger', 'automation.trigger'],
            'packages/client/src/envelope-convergence.test.ts': ['analytics.query', 'automation.trigger', 'automation.trigger'],
        });
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
        for (const r of LEDGER) {
            const k = `${r.file}|${r.method}|${r.receiver}`;
            ledgered.set(k, (ledgered.get(k) ?? 0) + r.count);
        }

        // An UNCLASSIFIED site is the failure this ratchet exists to produce:
        // whoever adds a call site to these four methods must say what it reads.
        expect(Object.fromEntries([...enumerated].sort())).toEqual(
            Object.fromEntries([...ledgered].sort()),
        );
        expect(ledgerTotal).toBe(CENSUS.sites.length);
    });

    it('⭐ THE NUMBER, post-convergence: ZERO call sites still read the envelope, and none is production code', () => {
        // The ratchet the convergence leaves behind. A site that reads `.data`
        // or the envelope's `success` off these four now reads `undefined`
        // (or fails to compile); the only legal way to add one is to classify
        // it here — and this line refuses the classification.
        expect(verdictTotal('ENVELOPE_DEPENDENT')).toBe(0);
        // Every site is a test pin. There is still no production call site in
        // this repo, so the migration in-repo was exactly this change's diff.
        const production = sdkSites.filter((s) => !/\.test\.tsx?$/.test(s.file));
        expect(production).toEqual([]);
    });

    it('records the split: 18 payload pins, 10 result-insensitive, 1 not-SDK', () => {
        expect(verdictTotal('PAYLOAD_DEPENDENT')).toBe(18);
        expect(verdictTotal('RESULT_INSENSITIVE')).toBe(10);
        expect(verdictTotal('NOT_SDK')).toBe(1);
        expect(sdkSites.length).toBe(28);
    });
});

describe('#13079 §4 — the four end in `unwrapResponse`; `analytics.queryDataset` is the protected counter-example', () => {
    // Read from the SDK source rather than restated, so a change to a method
    // cannot leave these claims behind.
    const src = readFileSync(join(HERE, 'index.ts'), 'utf8');

    it('each of the four methods ends `return this.unwrapResponse(...)` and no longer reads `res.json()`', () => {
        for (const [ns, method] of METHODS) {
            const body = methodSource(src, ns, method);
            expect(body, `${ns}.${method} must unwrap`).toMatch(/return this\.unwrapResponse</);
            expect(body, `${ns}.${method} must not read res.json()`).not.toMatch(/res\.json\(\)/);
        }
    });

    it('is not in the affected set', () => {
        expect(METHODS.some(([, m]) => m === 'queryDataset')).toBe(false);
        expect(CENSUS.sites.some((s) => s.method.includes('queryDataset'))).toBe(false);
    });

    it('is served BARE by @objectstack/rest and still reads `res.json()` — there is no envelope to strip', () => {
        const body = methodSource(src, 'analytics', 'queryDataset');
        expect(body).toMatch(/analytics\/dataset\/query/);
        expect(body).toMatch(/return res\.json\(\);/);
        expect(body).not.toMatch(/unwrapResponse/);
        // Its sibling `query` dials the dispatcher route; these are two dialects.
        expect(methodSource(src, 'analytics', 'query')).toMatch(/\$\{route\}\/query`/);
    });
});

describe('#13079 §5 — what was NOT measured', () => {
    it('objectui is recorded with its revision, its one production site survives, and its tightening has an owner', () => {
        expect(OBJECTUI_CENSUS.productionCallSites).toBe(1);
        expect(OBJECTUI_CENSUS.wouldBreak).toBe(0);
        expect(OBJECTUI_CENSUS.revision).toMatch(/^[0-9a-f]{40}$/);
        expect(OBJECTUI_CENSUS.tighteningOwner).toBe('objectui#7028');
        expect(OBJECTUI_CENSUS_COMMAND).toContain('origin/main');
    });

    it('⛔ cloud is NOT MEASURED, ruled so, and must not be read as clean', () => {
        expect(CLOUD_CENSUS.status).toBe('NOT_MEASURED');
        // The ready-to-run sweep includes the split-call second pass, because
        // the single-line form alone under-reported by 2 in THIS repo before
        // #13079 (and by 5 after it), and states the post-#13079 reading.
        expect(CLOUD_CENSUS_COMMAND).toContain('fetch origin main');
        expect(CLOUD_CENSUS_COMMAND).toContain('(analytics|automation)');
        expect(CLOUD_CENSUS_COMMAND).toContain('RUNTIME BREAK');
    });
});
