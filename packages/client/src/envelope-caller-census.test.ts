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
 *  - **The ratchet in section 3 is only as live as turbo's cache — for the
 *    trees still undeclared.** This suite walks the whole workspace, while
 *    `@objectstack/client#test` declares as inputs its own package plus the
 *    named cross-package globs — NOT every tree it reads. [#15608] `scripts/**`
 *    is now one of those globs, declared in
 *    `scripts/cross-package-test-inputs.mjs` and mirrored into `turbo.json`, so
 *    a diff under that root both pulls this package into CI's PR-side affected
 *    set (Layer A, the `--union-into` step) and moves this task's cache hash
 *    (Layer B). ⛔ `packages/**` is still NOT declared: it would re-run the
 *    client suite on virtually every commit, so it stays a recorded bound
 *    rather than one bought at that price — a new call site added in another
 *    PACKAGE can still leave this suite cached-green until something else
 *    invalidates it. On a cold cache and in CI's full run the count is exact,
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
//
// [#13874] `scanSource` comes from the SAME pass. It is the function
// `maskComments` is built on, and it reports a per-character `literal` flag
// beside the `comment` flag the mask is made of. The census keeps masking
// comments ONLY — nothing below changes that — but the failure text now uses
// the literal flag to say when a counted site sits inside a quoted example.
// Borrowing the house scanner rather than writing a second, private one is
// the whole reason that answer can be trusted: a private literal scanner is
// the very defect the block above refuses.
import { maskComments, scanSource } from '../../../scripts/js-comment-mask.mjs';

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
    /**
     * [#13874] Byte offset of the METHOD NAME in the file, recorded during the
     * scan because it is already in hand there and cannot be recovered later
     * without re-running the matcher. Nothing reads it while counting — it
     * exists so the failure text can ask whether this site sits inside a
     * literal. The offset is true of the ORIGINAL file too: `maskComments`
     * blanks in place and moves nothing.
     */
    index: number;
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

/**
 * Every counted site in ONE source text, under the repo-relative name `file`.
 *
 * [#13874] Lifted out of `scanCallSites` unchanged — same mask, same patterns,
 * same fields — so that section 6 can drive THE MATCHER THAT COUNTS over a
 * fixture instead of a copy of it. A pin written against a second, hand-rolled
 * matcher measures the copy and stays green through any drift in the original,
 * which is the same class of mistake as a private comment stripper.
 */
function sitesInSource(source: string, file: string): Site[] {
    const code = maskComments(source);
    const rawLines = source.split('\n');
    const sites: Site[] = [];
    for (const [ns, method] of METHODS) {
        // `\s*` spans newlines because the match runs over the WHOLE file,
        // not line by line — that is what catches the split-call shape.
        const re = new RegExp(`([A-Za-z0-9_$.\\]\\)]{0,40}?)\\b${ns}\\s*\\.\\s*${method}\\s*\\(`, 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(code)) !== null) {
            const line = code.slice(0, m.index).split('\n').length;
            const onOneLine = new RegExp(`\\b${ns}\\s*\\.\\s*${method}\\s*\\(`).test(rawLines[line - 1] ?? '');
            sites.push({
                file,
                line,
                method: `${ns}.${method}`,
                receiver: /client\.$/.test(m[1] ?? '') ? 'sdk' : 'service',
                visibleToLineGrep: onOneLine,
                // The prefix group is what makes `client.` visible, so the
                // method name starts after it — that is the character whose
                // literal flag decides the question, not the prefix's.
                index: m.index + (m[1] ?? '').length,
            });
        }
    }
    return sites;
}

function scanCallSites(root: string): Census {
    const files = walk(root);
    const sites: Site[] = [];
    for (const abs of files) {
        let raw: string;
        try { raw = readFileSync(abs, 'utf8'); } catch { continue; }
        sites.push(...sitesInSource(raw, relative(root, abs).split('\\').join('/')));
    }
    sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    return { sites, filesScanned: files.length };
}

const CENSUS = scanCallSites(REPO_ROOT);

// ---------------------------------------------------------------------------
// [#13874] The literal-span note — what a bare count mismatch would not say
// ---------------------------------------------------------------------------

/**
 * [#13874] ⭐ WHY THE COUNT IS RIGHT AND THE MESSAGE WAS NOT.
 *
 * `sitesInSource` blanks COMMENTS and leaves string, template and regex
 * literals intact, deliberately: a scanner that also blanked literals opens a
 * phantom comment on any block-comment opener inside a string and shrinks this
 * census in silence. ⛔ That decision is NOT revisited here. Teaching the
 * census a literal/context distinction is a separate design and a separate
 * measurement, weighed against the reason above; #13874 ruled it ⏸️ suspended
 * and ruled THIS change strictly additive.
 *
 * The price of keeping the decision is that example code quoted INSIDE a
 * literal is counted as a real call site — a refusal message showing an author
 * what to write instead, a usage banner, a fixture embedded in a gate script.
 * That is not hypothetical: a gate script's fixture pushed this census red and
 * the merge queue ejected the PR.
 *
 * What made that expensive was never the count. It was the FAILURE TEXT. It
 * read `expected 21 to be 19` and said nothing about strings, masking or gate
 * scripts — in a package the author had not edited, naming a ledger the author
 * had never read, and at the most expensive point in the pipeline. So the
 * count stands exactly as it was, and the message explains itself.
 *
 * [#15608] ⭐ The LAST clause of that sentence used to read "and invisible to
 * every local gate a `scripts/**` edit derives", and it is no longer true: this
 * package now declares `scripts/**` as a cross-package test input, so such a
 * diff selects this suite on the PR-side run instead of first reporting from
 * the merge queue. That is the WHEN-it-runs axis only — what the census COUNTS
 * is untouched, and #13874's suspension of the literal/context distinction
 * stands exactly as written above.
 *
 * ## Three properties this note must have, and what buys each
 *
 *  1. **It must not move the count.** It classifies nothing during the walk
 *     and decides nothing afterwards: `sitesInSource` gained one recorded
 *     offset it already had in hand, and every line below reads that offset
 *     only while a MESSAGE is being built. Section 6 pins the count against
 *     the same matcher to keep that honest.
 *  2. **It must not be a second, private literal scanner.** This tree has ONE
 *     code/prose separator. `scanSource` is the pass `maskComments` is built
 *     on, and it already reports the `literal` flag beside the `comment` flag
 *     — so this note cannot disagree with the census about what a literal is,
 *     and it inherits a scanner that was measured against an independent
 *     parser over the whole tree (`check-comment-mask-corpus.mjs`) rather than
 *     one written here this afternoon.
 *  3. **It must never throw.** A helper that crashes converts a legible count
 *     mismatch into a stack trace — strictly worse than the failure it was
 *     added to explain. An unreadable file, a stale offset and a garbage site
 *     all degrade to "not in a literal"; section 6 pins that. ⚠️ Because it
 *     runs only to EXPLAIN, a wrong answer here degrades a message and can
 *     never degrade the census — the counts above are computed without it.
 */
interface LiteralHit {
    site: Site;
    /** The delimiter that OPENED the literal the site sits in. */
    quote: string;
    /** 1-based line of that opening delimiter — often far above the site. */
    openedAtLine: number;
}

/**
 * Which of `sites` — whose `index` are offsets into `source` — sit inside a
 * literal span.
 *
 * Pure, and takes the source TEXT rather than a path, so section 6 can pin it
 * on a fixture built in memory. `scanSource().literal` flags a literal's
 * CONTENT and not its delimiters, which is what makes the walk back exact: the
 * first unflagged character before a run of flagged ones IS the opening quote.
 */
function literalEmbeddedSites(source: string, sites: readonly Site[]): LiteralHit[] {
    const { literal } = scanSource(source);
    const hits: LiteralHit[] = [];
    for (const site of sites) {
        // An out-of-range offset indexes `undefined`, which is not 1 — a stale
        // or garbage site is "not in a literal", never an exception.
        if (literal[site.index] !== 1) continue;
        let open = site.index;
        while (open > 0 && literal[open - 1] === 1) open -= 1;
        hits.push({
            site,
            quote: source[open - 1] ?? '?',
            openedAtLine: source.slice(0, open).split('\n').length,
        });
    }
    return hits;
}

/**
 * The negative reading, spelled out rather than left as silence. ⭐ A note that
 * only ever speaks up is a note that says "it is the literal trap" about every
 * failure; saying so when it is NOT the cause is what keeps the positive
 * reading worth acting on, and it stops the next author chasing a lead that
 * does not exist.
 */
const NO_LITERAL_SITES =
    'Literal check: no counted site sits inside a string, template or regex literal, so a '
    + 'quoted example is NOT what moved this number — every site the census counted is code '
    + 'it read as code, and the delta is a real call site to classify.';

const LITERAL_NOTE_UNAVAILABLE =
    'Literal check: UNAVAILABLE — the diagnostic itself could not run. That says nothing '
    + 'either way about the count above; read the sites by hand.';

function formatLiteralHits(hits: readonly LiteralHit[]): string {
    if (hits.length === 0) return NO_LITERAL_SITES;
    return [
        `Literal check: ${hits.length} counted site(s) sit INSIDE A LITERAL. This census blanks`,
        'COMMENTS ONLY and leaves literals intact on purpose, so example code quoted in an',
        'author-facing message — a refusal string showing what to write instead, a usage',
        'banner, a fixture embedded in a gate script — is counted as a real SDK call site:',
        ...hits.map((h) =>
            `    ${h.site.file}:${h.site.line}  ${h.site.method}  (receiver: ${h.site.receiver})`
            + `  — inside the ${h.quote} literal opened at line ${h.openedAtLine}`),
        'Those sites are very likely this whole delta, and the repair belongs in the file that',
        'quotes them, not here. The census matches a CALL SHAPE, so an example that names the',
        'method without its argument list is not counted; the ejected PR was fixed instead by',
        'making its fixture demonstrate the symbol the fixture itself names.',
        '⛔ Do NOT weaken, skip or exempt this census, and ⛔ do NOT add the quoted prose to',
        'LEDGER — a ledger is worth having only while every row in it is a real call site.',
    ].join('\n');
}

/**
 * The note every census-derived assertion below carries.
 *
 * Built at most once per run and only over the sites the census already
 * counted — 29 files today, never the 5,000+ the walk visits — so it is
 * invisible next to the scan it explains. ⛔ Guarded whole: property 3.
 */
const literalNote = (() => {
    let memo: string | undefined;
    return (sites: readonly Site[] = CENSUS.sites): string => {
        if (sites === CENSUS.sites && memo !== undefined) return memo;
        let answer: string;
        try {
            const byFile = new Map<string, Site[]>();
            for (const s of sites) byFile.set(s.file, [...(byFile.get(s.file) ?? []), s]);
            const hits: LiteralHit[] = [];
            for (const [file, fileSites] of byFile) {
                let src: string;
                try { src = readFileSync(join(REPO_ROOT, file), 'utf8'); } catch { continue; }
                hits.push(...literalEmbeddedSites(src, fileSites));
            }
            answer = formatLiteralHits(hits);
        } catch {
            answer = LITERAL_NOTE_UNAVAILABLE;
        }
        if (sites === CENSUS.sites) memo = answer;
        return answer;
    };
})();

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
 * The SDK source of one namespace's method — so section 4 reads what each
 * method ENDS with off the source rather than restating it.
 *
 * Three anchoring decisions, each paid for by a wrong slice:
 *  - comments are MASKED first (the tree's own `maskComments`), so a docblock
 *    naming `res.json()` or `unwrapResponse` can neither satisfy nor fail a
 *    CODE assertion;
 *  - the NAMESPACE is located first (`analytics = {` … `};` is a class field
 *    at two-space indentation) because `query: async` and `explain: async`
 *    are spelled in other namespaces too, and the first match in the file is
 *    not the analytics one;
 *  - the slice runs from `NAME: async` to the next sibling property at the
 *    same indentation or the namespace's closing `};` — a method's own closing
 *    `}` is not a safe anchor: `queryDataset`'s parameter type literal closes
 *    with one at that indentation, and the last property closes without a
 *    comma.
 */
function methodSource(src: string, ns: string, name: string): string {
    const masked = maskComments(src);
    const block = new RegExp(`\\n  ${ns} = \\{[\\s\\S]*?\\n  \\};`).exec(masked);
    if (!block) throw new Error(`namespace \`${ns}\` not found in index.ts`);
    // `[ \t]+`, not `\s+`: the indentation capture must not absorb a newline.
    const m = new RegExp(`\\n([ \\t]+)${name}: async[\\s\\S]*?(?=\\n\\1[A-Za-z_$][\\w$]*: |\\n  \\};)`).exec(block[0]);
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
        // [#13874] A quoted example rarely spells `client.` in front of the
        // method, so a literal-embedded site lands HERE first, as a phantom
        // producer call. That makes this the assertion most likely to break
        // for a reason that has nothing to do with receivers.
        expect(service.length, literalNote()).toBe(1);
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
        // [#13874] …and if the "call site" is example code inside a quoted
        // message, the note says so, names it, and says where to repair it.
        expect(Object.fromEntries([...enumerated].sort()), literalNote()).toEqual(
            Object.fromEntries([...ledgered].sort()),
        );
        // ⭐ THE bare count mismatch — `expected 21 to be 19` is the shape that
        // ejected a PR from the merge queue while explaining nothing.
        expect(ledgerTotal, literalNote()).toBe(CENSUS.sites.length);
    });

    it('⭐ THE NUMBER, post-convergence: ZERO call sites still read the envelope, and none is production code', () => {
        // The ratchet the convergence leaves behind. A site that reads `.data`
        // or the envelope's `success` off these four now reads `undefined`
        // (or fails to compile); the only legal way to add one is to classify
        // it here — and this line refuses the classification.
        expect(verdictTotal('ENVELOPE_DEPENDENT')).toBe(0);
        // Every site is a test pin. There is still no production call site in
        // this repo, so the migration in-repo was exactly this change's diff.
        // [#13874] A refusal string that quotes `client.` + the method inside a
        // `.mjs` gate script reads as a PRODUCTION SDK call site and breaks
        // exactly here — the loudest possible wrong conclusion this file can
        // reach, so the note travels with it.
        const production = sdkSites.filter((s) => !/\.test\.tsx?$/.test(s.file));
        expect(production, literalNote()).toEqual([]);
    });

    it('records the split: 18 payload pins, 10 result-insensitive, 1 not-SDK', () => {
        expect(verdictTotal('PAYLOAD_DEPENDENT')).toBe(18);
        expect(verdictTotal('RESULT_INSENSITIVE')).toBe(10);
        expect(verdictTotal('NOT_SDK')).toBe(1);
        // The three above are LEDGER sums and cannot move on a census reading;
        // this one is census-derived, so it carries the note. [#13874]
        expect(sdkSites.length, literalNote()).toBe(28);
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
        // The CODE spelling: the prefix comes from `getRoute('analytics')`, the
        // literal `analytics/dataset/query` only ever lived in the docblock.
        expect(body).toMatch(/getRoute\('analytics'\)/);
        expect(body).toMatch(/\$\{route\}\/dataset\/query`/);
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

describe('#13874 §6 — the failure text names the string-literal trap, and only when it applies', () => {
    // ⚠️ EVERY fixture here is assembled from parts, and that is not style.
    // This file sits inside the tree the census walks, so a fixture spelled as
    // one literal would BE a counted site — this section would arm the very
    // trap it exists to explain, and move the numbers section 3 ratchets. The
    // interpolation splits the spelling in the SOURCE while restoring it in
    // the VALUE, which is what the matcher below is handed. The last test in
    // this section is the control that pins the whole file at zero sites.
    const NS = 'analytics';

    /** A gate script's refusal message, beside the real call it teaches. */
    const QUOTED = [
        `const refusal = 'read the payload: ${NS}.query(q).rows, not q.data.rows';`,
        `const rows = (await client.${NS}.query({ cube: 'orders' })).rows;`,
    ].join('\n');

    /** A usage banner in a template — not line-bounded, and the `//` inside it
     *  is template CONTENT, not a comment, which is the case a naive stripper
     *  gets wrong in the opposite direction. */
    const BANNER = [
        'const usage = `',
        `  ${NS}.query(q)   // shown to the author; this file calls nothing`,
        '`;',
    ].join('\n');

    /** The same spelling in a real comment — masked, so never a site at all. */
    const COMMENTED = [
        `// call ${NS}.query(q) and read .rows off the result`,
        'const x = 1;',
    ].join('\n');

    it('⭐ says so when a counted site sits inside a literal, and names file, line and the quote', () => {
        const sites = sitesInSource(QUOTED, 'scripts/example-gate.mjs');
        // ⛔ BOTH are still counted. The ruling is that the count does not move
        // and the message explains itself; a fixture that showed one site here
        // would be pinning option 3, which is suspended.
        expect(sites.length).toBe(2);

        const hits = literalEmbeddedSites(QUOTED, sites);
        expect(hits.length).toBe(1);
        expect(hits[0]?.site.line).toBe(1);
        expect(hits[0]?.quote).toBe("'");
        expect(hits[0]?.openedAtLine).toBe(1);

        const text = formatLiteralHits(hits);
        expect(text).toContain('INSIDE A LITERAL');
        expect(text).toContain('COMMENTS ONLY');
        expect(text).toContain('scripts/example-gate.mjs:1');
        expect(text).toContain('analytics.query');
        // The four properties the card measured, each answered in the text:
        // where it is, why it counted, where to repair it, and what NOT to do.
        expect(text).toContain('the repair belongs in the file that');
        expect(text).toContain('do NOT add the quoted prose to');
    });

    it('⛔ and stays silent about literals when a real call site is the cause — the negative half', () => {
        // Without this, a helper that answered "inside a literal" about every
        // site would satisfy the assertion above and mislead every reader of a
        // genuine count change.
        const real = sitesInSource(QUOTED, 'scripts/example-gate.mjs').filter((s) => s.line === 2);
        expect(real.length).toBe(1);
        expect(real[0]?.receiver).toBe('sdk');
        expect(literalEmbeddedSites(QUOTED, real)).toEqual([]);
        expect(formatLiteralHits([])).toBe(NO_LITERAL_SITES);
        expect(formatLiteralHits([])).not.toContain('INSIDE A LITERAL');
    });

    it('reads a template banner as a literal, and a real comment as no site at all', () => {
        const banner = sitesInSource(BANNER, 'scripts/usage-banner.mjs');
        expect(banner.length).toBe(1);
        const hits = literalEmbeddedSites(BANNER, banner);
        expect(hits.length).toBe(1);
        expect(hits[0]?.quote).toBe('`');
        // ⭐ The template OPENS a line above the site — the number a reader
        // needs, and the one a per-line check could not produce.
        expect(hits[0]?.openedAtLine).toBe(1);
        expect(hits[0]?.site.line).toBe(2);

        // The control on the other side: comments are masked by the census, so
        // a commented mention never reaches this diagnostic in the first place.
        expect(sitesInSource(COMMENTED, 'scripts/commented.mjs')).toEqual([]);
    });

    it('⛔ never throws — a crashing diagnostic would turn a legible count mismatch into a stack trace', () => {
        const ghost: Site = {
            file: 'no/such/file/anywhere.ts', line: 1, method: 'analytics.query',
            receiver: 'service', visibleToLineGrep: true, index: 999_999,
        };
        // An unreadable file is skipped, so the answer is the negative note.
        expect(() => literalNote([ghost])).not.toThrow();
        expect(literalNote([ghost])).toBe(NO_LITERAL_SITES);
        // An offset past the end of a real source is "not in a literal".
        expect(() => literalEmbeddedSites(QUOTED, [ghost])).not.toThrow();
        expect(literalEmbeddedSites(QUOTED, [ghost])).toEqual([]);
        expect(() => literalNote([])).not.toThrow();
    });

    it('runs end to end over the real tree, and records the reading at this revision', () => {
        // Proves the disk path works — the pins above are in-memory, and a
        // helper green on fixtures while throwing on the workspace would be
        // exactly the false comfort this file exists to refuse.
        const note = literalNote();
        expect(note).not.toBe(LITERAL_NOTE_UNAVAILABLE);
        // ⭐ TODAY'S READING: no counted site anywhere in this workspace sits
        // inside a literal. A red here is the trap firing, and the message it
        // prints is the whole point of #13874 — read it, do not silence it.
        expect(note, note).toBe(NO_LITERAL_SITES);
    });

    it('⭐ and this file — which quotes all four spellings throughout — contributes ZERO counted sites', () => {
        // The self-control. Every paragraph and message above names the four
        // methods; if any of them had been written as a call shape inside a
        // literal, this section would have added sites to the census it
        // documents. That is not a hypothetical failure mode: it is the card.
        expect(CENSUS.sites.filter((s) => s.file.endsWith('envelope-caller-census.test.ts'))).toEqual([]);
    });
});
