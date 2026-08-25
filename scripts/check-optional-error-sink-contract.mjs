#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Optional-`error` sink-contract guard (#9754, ruled B by the lane PM).
 *
 * ## The rule it enforces, in one line
 *
 *   > An optional `error` with no declared alternative is a contract that
 *   > permits silence.
 *
 * A sink TYPE that declares `error` as optional must also declare `warn` as
 * NON-optional, so that every value of that type has somewhere to put a
 * durability report. Silence stops being representable at the point of
 * AUTHORING rather than being caught, case by case, one gate-run later.
 *
 * ## Why this is a producer defect and not per-site vigilance
 *
 * PR #9750 tightened `check-durability-degradation-log-level` so an optional
 * CALL (`logger.error?.(…)`) no longer counts as a loud report — because
 * against a sink with no `error`, that spelling emits nothing. It turned up six
 * real seams, and every one was on a sink whose `error` is declared optional.
 * The sharpest instance was `AuthEventAuditLogger`, which declared `error?` and
 * `debug?` and NO `warn` at all: at that call site there was no fallback
 * channel to reach for, and `tsc` said so when the dev tried to write the
 * correct shape. The call site COULD NOT have been written correctly against
 * the contract it was given.
 *
 * AGENTS.md → Prime Directive #12 says to fix that in the producer. This gate
 * is the producer-side constraint; the call-site rule (`check:durability-log-level`)
 * is unchanged and still judges spellings. The two share no vocabulary and no
 * ledger: a type red here is untouched there, and the reverse.
 *
 * ## WHY `warn` SPECIFICALLY, and not any of {warn, info, log}
 *
 * The alternative channel exists to carry a DURABILITY DEGRADATION — a write
 * the system claims to have made and did not. AGENTS.md → "Degradation log
 * levels" (#4632) rules that such a report must be `error`; the repaired seams
 * of #9657 and #9748 degrade it to `warn` and no further, because `warn` is the
 * lowest level a reader still reads as a failure. `info`/`log` is precisely the
 * level that rule calls the reassuring half-truth: a lost row reported at
 * `info` reads as normal operation. Accepting `info` here would satisfy the
 * letter of "something prints" while defeating the reason to print. So:
 * `warn`, non-optional, or the type is red.
 *
 * ⛔ What this gate does NOT ask, deliberately (option C, falsified by the
 * #9657 dev before this card was filed): it never asks for `error` to be made
 * REQUIRED. Hosts do inject reduced sinks — `SqlDriver`'s `error?` exists for
 * exactly that — so requiring `error` forecloses the legitimate `{ warn }`-only
 * host the drivers were written for, and breaks three exported plugin types.
 * `error` stays optional; what changes is that its ABSENCE now has a declared,
 * guaranteed destination.
 *
 * ## The population, measured before the rule was written
 *
 * Drawn STRUCTURALLY, not by name. A name convention (`*Logger`) silently
 * misses a type someone names differently, and this repo has `LoggerLike`,
 * `MinimalLogger`, `OptionalLogger`, `FakeLogSink` and eight anonymous inline
 * literals — a name rule would have missed most of the population. Structural
 * costs false positives instead, so every narrowing below is measured and
 * its cost is printed on every run rather than argued in prose.
 *
 * A SINK is: an interface, a type alias to a type literal, or an inline type
 * literal, all of whose members are function-typed and named from
 * {error, warn, info, debug, log, fatal, trace, verbose, silly}, and which
 * declares `error`. "Function-typed" means a method signature, a function type,
 * or bare `Function` (#11069 — see `isFunctionTyped`). Measured over
 * `packages/**` immediately BEFORE the two repairs that landed with this file
 * (`SweepLogger`, `ProjectionLogger`):
 *
 *   | population                                                | count |
 *   |-----------------------------------------------------------|------:|
 *   | sinks declaring `error` (non-test source)                  |    36 |
 *   | ...with `error` REQUIRED — nothing to guarantee            |    11 |
 *   | ...with `error` optional and `warn` REQUIRED — clean       |     8 |
 *   | ...with `error` optional and `warn` OPTIONAL — red         |    16 |
 *   | ...with `error` optional and NO `warn` at all — red        |     1 |
 *   | skipped: shape narrowed by an `as` CAST                    |     2 |
 *   | skipped: not a pure sink (a member outside the vocabulary) |     2 |
 *   | pure sinks declaring no `error` — out of the population    |    56 |
 *
 * The eight already-clean ones are why this rule is not an invention: the
 * reduced sinks written with care in this repo — `sql-driver.ts`,
 * `service-datasource/logger.ts`, `db-job-adapter.ts`, `email-service.ts`,
 * `lifecycle-service.ts`, `service-queue/common.ts` and both triggers — ALREADY
 * declare `warn` required beside an optional `error`. The 17 red ones are the
 * drift from a convention the repo half-holds — two repaired in the PR that
 * added this gate, fifteen recorded in the shrink-only ledger below.
 *
 * ### Narrowing 1: a shape narrowed by an `as` CAST is not a contract
 *
 *   (globalThis as { console?: { error?: (m: string) => void } }).console?.error?.(m)
 *
 * That literal describes a FOREIGN object the module does not own — it is a
 * reader narrowing something it cannot change, not a contract it publishes. The
 * rule cannot apply: nobody can add `warn` to the host's `console` by decree,
 * and demanding it would redden two correct sites (the measured cost, printed
 * as `cast-narrowing` in the census — `degraded-boot.ts`'s deliberate
 * stderr → console → silence chain, and `knowledge-service-plugin.ts`'s
 * forwarding cast of `ctx.logger`).
 *
 * ### Narrowing 2: purity — every member from the log vocabulary
 *
 * Without it, any options bag carrying an `error` callback is swept in
 * (`DomainHandlerDeps` carries seventeen members, one of them `error`). Its
 * measured cost today is ZERO missed sinks: of the two impure shapes with an
 * `error` member — `DomainHandlerDeps` and the kernel's own
 * `spec/contracts/logger.ts` `Logger`, which carries `child`/`withTrace`/
 * `destroy` beside the levels — BOTH declare `error` REQUIRED, so neither could
 * have been red under this rule.
 * That number is printed as `impure` on every run — a narrowing whose cost is
 * only argued is a narrowing nobody re-measures.
 *
 * ### Narrowing 3: a member type this SYNTACTIC matcher cannot resolve
 *
 * Added by #11069 as the reject side of reading bare `Function` as a channel.
 * `isFunctionTyped` reads syntax; there is no type checker here, deliberately
 * (a detector with no program to build cannot fail to build one in CI). So
 * `warn?: Logger['warn']` and `error?: SomeAliasedCallable` are opaque to it.
 * Rather than let such a shape vanish — the exact defect #11069 was filed over —
 * a shape whose members are ALL channel names but which carries one of those
 * types is counted as `unreadable` and listed under `--list`.
 *
 * Its measured cost today is ZERO missed reds: of the three, two are
 * `import-coerce.ts`'s `{ error: FieldCoerceError }` result envelopes with
 * `error` REQUIRED (nothing to guarantee), and one is `suspended-run-store.ts`'s
 * `MinimalLogger` = `{ warn?: Logger['warn']; debug?: Logger['debug'] }`, which
 * declares no `error` at all. Keyword types (`string`, `unknown`, `boolean`) are
 * deliberately NOT counted here: those are result fields, unambiguously not
 * callable, and sweeping them in would drown the number that matters.
 *
 * ### The two blind spots #11069 measured, and what closed them
 *
 * Both were narrowings NOT in the list above — neither argued nor counted, which
 * is what made them blind spots rather than trade-offs:
 *
 *   1. A sink spelled with bare `Function` set `fn = false`, which BOTH hid its
 *      `error` from the population lookup AND made the shape impure — so it
 *      landed in no bucket at all. Three live `plugin-sharing` sinks were
 *      invisible that way, every one of them red. Closed by reading `Function`
 *      as a channel: population 38 → 41, red 2 → 5. The three are recorded in
 *      the shrink-only ledger rather than flipped — their options types are
 *      PUBLICLY EXPORTED, so tightening `warn` is #10556's contract call.
 *   2. The file prefilter matched on `error` alone. Sound for the enforced
 *      population, unsound for the `noErrorMember` census line, which counts
 *      sinks declaring NO `error` and so counts exactly the files with no reason
 *      to spell the token. Closed by deriving the prefilter from the whole
 *      vocabulary (see `CHANNEL_PREFILTER`): the tally moved 57 → 95 on an
 *      UNCHANGED tree, so 40% of it had never been counted, and membership had
 *      come to depend on whether the file mentioned `error` for unrelated
 *      reasons.
 *
 * The two fixes are independent and additive — 57 + 38 (prefilter) + 1 (the
 * bare-`Function` sink in `record-orphan-cleanup.ts`) = 96, the tally today.
 *
 * ⭐ Both blind spots shared one signature worth recognising again: a number
 * this file PRINTS was bounded by a filter applied for a different number's
 * sake. When adding a bucket, check what the prefilter is sound FOR — not that
 * it is sound.
 *
 * ### Scope: `packages/**` only
 *
 * These are the contracts plugins and services PUBLISH. `examples/**` holds one
 * further red sink (`app-showcase/src/system/server/recalc-endpoint.ts`) — a
 * consumer's local shape, not a contract anyone implements. Stated with its
 * number rather than left to silence, so widening the scan is a decision
 * someone can make with the count in hand.
 *
 * ## The baseline is a shrink-only ledger, and it is NOT an exemption list
 *
 * The 17 red sinks measured above are recorded in
 * `scripts/optional-error-sink-contract.baseline.json`, each with the reason it
 * was not repaired in the PR that added this gate. Two properties, both
 * deliberate:
 *
 *   - **Shrink-only.** A baselined entry that is no longer red FAILS the gate
 *     ("delete the entry"), so repairs cannot leave stale ledger rows behind
 *     and the file can only get shorter.
 *   - **Never a place to add new work.** A new red sink is a violation, not a
 *     ledger row. The ledger's own header carries the same sentence.
 *
 * One edge that sentence does NOT cover, spelled out because #11069 hit it: a
 * sink this checker previously could not SEE is not new work. Widening the
 * population necessarily surfaces shapes that were already red, and if
 * recording those were forbidden, the cheapest way to keep the gate green would
 * be to leave the blind spot in place. What the ⛔ forbids is appending a
 * newly WRITTEN violation. Rows added for a population widening say so, name
 * the widening, and stay shrink-only like every other row.
 *
 * ## Verdicts
 *
 *   no-fallback        — optional `error`, no `warn` declared at all. The
 *                        sharpest form: the call site cannot be written
 *                        correctly, and `tsc` will say so.
 *   optional-fallback  — optional `error`, `warn` declared but also optional.
 *                        There is something to reach for, and still no
 *                        guarantee anything prints.
 *   (clean)            — `error` required, or `warn` required.
 *
 * Both red verdicts are reported with the whole member list, because "which
 * members does this type actually declare" is the one fact the author needs and
 * the one a line number does not carry.
 *
 * ## Wiring
 *
 * ⚠️ This section described the gate as UNWIRED until #11069 found it stale.
 * It was not wired by the PR that introduced it — #9754's own body forbids more
 * merge-blocking ("⛔ Not a new required context; this argues for a
 * producer-side constraint, not more merge-blocking"), and #9747's family
 * ruling was visibility-only — but it has since been wired, and the paragraph
 * that said wiring "is a lane-PM decision, recorded on #9754 rather than taken
 * here" outlived that decision being taken.
 *
 * As of today it RUNS ON EVERY PULL REQUEST, from
 * `.github/workflows/lint.yml` ("Optional-`error` sink contract"), with no
 * `paths:` filter — deliberately, since a filter on `packages/**` would go
 * dormant on the PR that edits the baseline. So a red here BLOCKS, and the
 * exit code on a clean tree is a load-bearing fact rather than a report.
 *
 * Run it locally the same way CI does:
 *
 *   pnpm check:optional-error-sink          # --self-test, then the scan
 *   node scripts/check-optional-error-sink-contract.mjs --list   # census only, always exit 0
 *
 * ⭐ Note what the drift was: a paragraph stating a fact about the WORLD that
 * nothing re-checks. It is the same species as the two blind spots below — a
 * claim nobody re-measures — one level up from the counts, and it is why the
 * numbers in this header are stated with the tree they were measured on.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireDefaultExport } from './import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);

import { parseSourceFile } from './ts-parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const BASELINE_PATH = join(HERE, 'optional-error-sink-contract.baseline.json');

/** Where the PUBLISHED contracts live. See "Scope" in the header. */
const SCAN_ROOTS = ['packages'];

const SKIP_DIRS = new Set([
    'node_modules', 'dist', 'build', 'coverage', '.turbo', '.next', '.cache', 'json-schema', '.git',
]);

/**
 * The log-channel vocabulary. Purity is judged against THIS set (narrowing 2),
 * so a shape with a member outside it is not a sink.
 */
const LOG_CHANNELS = new Set([
    'error', 'warn', 'info', 'debug', 'log', 'fatal', 'trace', 'verbose', 'silly',
]);

/** The one channel that may carry a degraded durability report. See the header. */
const FALLBACK_CHANNEL = 'warn';

/**
 * The file prefilter, DERIVED from `LOG_CHANNELS` rather than written out.
 *
 * ## What it must be sound for, and what the previous one was sound for
 *
 * The prefilter decides which files are parsed at all, so it silently bounds
 * EVERY number this gate prints. Its previous spelling was `/\berror\s*\??\s*
 * [:(]/` — sound for the enforced population, because a sink declaring `error`
 * necessarily spells the token, and UNSOUND for the `noErrorMember` census
 * line, which counts sinks declaring NO `error` and therefore counts exactly
 * the files that have no reason to contain it. A file whose only sink is a pure
 * `{ info?, warn? }` was skipped before the parser saw it, and membership in
 * that tally came to depend on unrelated text elsewhere in the file (#11069).
 *
 * ## Why deriving it from the vocabulary makes it sound for ALL of them
 *
 * Every shape this gate records in ANY bucket — `sinks`, `impure`,
 * `castNarrowed`, `unreadable`, `noErrorMember` — has at least one member whose
 * name is in `LOG_CHANNELS` and whose name is an IDENTIFIER (`readShape` sends
 * anything else down the `<non-property>` path, and `noErrorMember` further
 * requires `read.length > 0`). A member of that kind is spelled `name:`,
 * `name?:`, `name(` or `name?(` — all four covered below. So a file this
 * prefilter skips cannot contribute to any bucket, and the tally is a COUNT
 * again rather than a lower bound of unknown slack.
 *
 * Verified by MEASUREMENT, not only by the argument above — the argument is the
 * kind of thing this card exists to distrust. Removing the prefilter entirely
 * and parsing all 1914 files produces a BYTE-IDENTICAL 146-line `--list`
 * census, so nothing is lost; and the prefilter still skips 1337 of those 1914
 * files (69.9%), costing 2.8s against 3.7s unfiltered. The old error-only
 * prefilter parsed 460 files (24.0%); this one parses 577 (30.1%).
 *
 * ⭐ DERIVED, so it cannot drift: adding a channel to `LOG_CHANNELS` widens this
 * automatically. A hand-written second copy of the vocabulary is how the
 * previous narrowing outlived the reason for it. The self-test pins every
 * channel in all four spellings.
 */
const CHANNEL_PREFILTER = new RegExp(`\\b(?:${[...LOG_CHANNELS].join('|')})\\s*\\??\\s*[:(]`);

// ── AST helpers ─────────────────────────────────────────────────────────────

function collectSourceFiles(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        let st;
        try {
            st = statSync(full);
        } catch {
            continue;
        }
        if (st.isDirectory()) {
            collectSourceFiles(full, out);
        } else if (
            entry.endsWith('.ts') &&
            !entry.endsWith('.d.ts') &&
            !entry.endsWith('.test.ts') &&
            !entry.endsWith('.spec.ts')
        ) {
            out.push(full);
        }
    }
    return out;
}

/**
 * The catch-all callable spelling: bare `Function`.
 *
 * `Function` is a TYPE REFERENCE, not a `FunctionTypeNode`, so the structural
 * matcher below has to name it explicitly. Everything else the "catch-all
 * callable" phrase covers — `(...args: any[]) => any`, `(...args: any[]) =>
 * unknown` — already IS a `FunctionTypeNode` and needs no special case.
 *
 * Measured over `packages/**` when this limb was added: `Function` is the ONLY
 * catch-all spelling live in the tree (14 members across 4 files, all in
 * `plugin-sharing`). No `CallableFunction`, no `Object`-typed channel.
 */
const CATCH_ALL_CALLABLE = 'Function';

/**
 * Is this member's type a function?
 *
 * A method signature (`error?(m: string): void`) counts, and so does a property
 * whose type is a function (`error?: (m: string) => void`). Both spellings are
 * live in this repo and the two audit sinks — the very types this card was
 * filed over — use the METHOD form: a matcher that only knew the property form
 * reported a clean tree while missing the sharpest instance in it. Measured,
 * while drawing this population.
 *
 * ⭐ Bare `Function` counts too (#11069). It is a WORSE contract than a real
 * signature, not a better one — it documents nothing and catches no arity
 * mistake — so a rule about what a sink guarantees must read it as a channel.
 * Before this limb existed, `error?: Function` set `fn = false`, which made the
 * whole shape impure AND hid the `error` member from the population lookup, so
 * such a sink landed in NO bucket at all: not the population, not `impure`, not
 * `noErrorMember`. Three live `plugin-sharing` sinks were invisible that way,
 * every one of them red. Being invisible is the defect; the shapes themselves
 * are unchanged by this PR and are recorded in the shrink-only ledger.
 */
function isFunctionTyped(member) {
    if (ts.isMethodSignature(member)) return true;
    if (!ts.isPropertySignature(member)) return false;
    const seen = (t) => {
        if (!t) return false;
        if (ts.isFunctionTypeNode(t)) return true;
        if (ts.isParenthesizedTypeNode(t)) return seen(t.type);
        if (ts.isUnionTypeNode(t)) return t.types.some(seen);
        if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName)) {
            return t.typeName.text === CATCH_ALL_CALLABLE;
        }
        return false;
    };
    return seen(member.type);
}

/**
 * Is this member's type a NAMED type this syntactic matcher cannot resolve?
 *
 * The reject side of the limb above, and the reason it is counted rather than
 * argued. `isFunctionTyped` reads syntax, not types: it can see `(m: string) =>
 * void` and it can see `Function`, but `warn?: Logger['warn']` — an indexed
 * access — and `error?: SomeAliasedCallable` are opaque to it. Whether those
 * are channels is a question only a type CHECKER answers, and this gate
 * deliberately has none (a detector with no program to build cannot fail to
 * build one in CI).
 *
 * So the residual blind spot is real, and per this file's own standing rule —
 * "a narrowing whose cost is only argued is a narrowing nobody re-measures" —
 * it gets a printed number instead of a paragraph. Keyword types (`string`,
 * `unknown`, `boolean`) are NOT counted: those are result fields, unambiguously
 * not callable, and sweeping them in would drown the signal that matters.
 */
function isUnresolvedNamedType(member) {
    if (!ts.isPropertySignature(member)) return false;
    const seen = (t) => {
        if (!t) return false;
        if (ts.isParenthesizedTypeNode(t)) return seen(t.type);
        if (ts.isUnionTypeNode(t)) return t.types.some(seen);
        if (ts.isTypeReferenceNode(t)) return true;
        if (ts.isIndexedAccessTypeNode(t)) return true;
        if (ts.isTypeQueryNode(t)) return true;
        return false;
    };
    return seen(member.type);
}

/** Is `node` inside an `as`/`<T>`/`satisfies` type assertion? (Narrowing 1.) */
function insideTypeAssertion(node) {
    for (let n = node.parent; n; n = n.parent) {
        if (ts.isAsExpression(n)) return true;
        if (n.kind === ts.SyntaxKind.TypeAssertionExpression) return true;
        if (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n)) return true;
        if (ts.isSourceFile(n)) return false;
    }
    return false;
}

/**
 * A stable identity for an ANONYMOUS inline sink, used as its ledger key.
 *
 * Line numbers move with every edit above them, so the key is built from the
 * names around the literal instead: the property/parameter it annotates, and
 * the nearest named declaration enclosing that. `logger@SweepStrandedOutboxOptions`
 * survives a hundred lines landing above it and changes only when the thing it
 * names is actually renamed — at which point a stale ledger row is the correct
 * outcome, not a false one.
 */
function anonymousSinkName(node, sf) {
    let owner;
    let scope;
    for (let n = node.parent; n; n = n.parent) {
        const named =
            (ts.isPropertySignature(n) || ts.isPropertyDeclaration(n) || ts.isParameter(n) ||
                ts.isVariableDeclaration(n)) && n.name && ts.isIdentifier(n.name)
                ? n.name.text
                : undefined;
        if (named && !owner) owner = named;
        const scoped =
            (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isClassDeclaration(n) ||
                ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && ts.isIdentifier(n.name)
                ? n.name.text
                : undefined;
        if (scoped && !scope) scope = scoped;
        if (ts.isSourceFile(n)) break;
    }
    return `${owner ?? '<anonymous>'}@${scope ?? '<module>'}`;
}

// ── The rule ────────────────────────────────────────────────────────────────

/**
 * Read one shape's members WITHOUT judging it yet.
 *
 * Purity is returned rather than used to bail out, because the count of shapes
 * this gate declines to judge is itself a reported number (see the census). A
 * narrowing that only ever produced silence would be indistinguishable from a
 * matcher that stopped matching.
 */
function readShape(members) {
    const named = [];
    let pure = true;
    // Does this shape LOOK like a sink whose members are all channels, with the
    // only obstacle being a member type the matcher cannot resolve? Tracked
    // separately from `pure` because the two answer different questions:
    // `pure` is "this rule may judge it", this is "this rule cannot TELL".
    let allChannelNames = members.length > 0;
    let unresolved = 0;
    for (const m of members) {
        if ((ts.isPropertySignature(m) || ts.isMethodSignature(m)) && m.name && ts.isIdentifier(m.name)) {
            const name = m.name.text;
            const fn = isFunctionTyped(m);
            named.push({ name, optional: !!m.questionToken, fn });
            if (!LOG_CHANNELS.has(name)) allChannelNames = false;
            if (!LOG_CHANNELS.has(name) || !fn) pure = false;
            if (!fn && isUnresolvedNamedType(m)) unresolved++;
        } else {
            // An index signature, a call signature, a computed key: a shape that
            // can carry arbitrary members is not a contract this rule reads.
            pure = false;
            allChannelNames = false;
            named.push({ name: '<non-property>', optional: false, fn: false });
        }
    }
    return { pure, members: named, unreadable: allChannelNames && unresolved > 0 };
}

/** `info? warn? error?` — the whole declared surface, for the report. */
function describeMembers(members) {
    return members.map((m) => `${m.name}${m.optional ? '?' : ''}`).join(' ');
}

/**
 * Judge one shape. Returns a record for the census; `verdict` is one of
 * `error-required` / `fallback-guaranteed` (both clean), `optional-fallback`,
 * `no-fallback` (both red).
 */
function judgeSink(members) {
    const error = members.find((m) => m.name === 'error');
    const fallback = members.find((m) => m.name === FALLBACK_CHANNEL);
    if (!error.optional) return 'error-required';
    if (fallback && !fallback.optional) return 'fallback-guaranteed';
    return fallback ? 'optional-fallback' : 'no-fallback';
}

const RED_VERDICTS = new Set(['optional-fallback', 'no-fallback']);

/**
 * Walk one file, appending to `census`.
 *
 * `census.sinks` holds every judged sink (clean and red alike) — a gate that
 * only recorded its findings could not tell "nothing is wrong" from "nothing
 * was read".
 */
function analyzeSourceFile(sf, relPath, census) {
    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

    const consider = (node, members, name, kind) => {
        const { pure, members: read, unreadable } = readShape(members);
        if (unreadable) {
            // The residual blind spot, counted rather than argued: every member
            // is named from the log vocabulary, and at least one carries a type
            // this SYNTACTIC matcher cannot resolve to a callable
            // (`warn?: Logger['warn']`). Recorded BEFORE the population lookup
            // because that lookup asks `m.fn`, which is precisely the question
            // that has no syntactic answer here.
            const errorMember = read.find((m) => m.name === 'error');
            census.unreadable.push({
                file: relPath, line: lineOf(node), name: name ?? anonymousSinkName(node, sf),
                errorOptional: !!errorMember?.optional, declaresError: !!errorMember,
                members: describeMembers(read),
            });
            return;
        }
        const error = read.find((m) => m.name === 'error' && m.fn);
        if (!error) {
            // Not in the population at all. A `{ info?, warn? }` sink declares no
            // `error` for anyone to reach for optionally, so there is nothing here
            // for this rule to guarantee.
            if (pure && read.length > 0) census.noErrorMember.push({ file: relPath, line: lineOf(node) });
            return;
        }
        if (!pure) {
            // Narrowing 2, counted rather than argued: an options bag that happens
            // to carry an `error` callback. The cost that matters is how many of
            // these declare it OPTIONAL — those are the sinks this narrowing could
            // be hiding.
            census.impure.push({
                file: relPath, line: lineOf(node), name: name ?? anonymousSinkName(node, sf),
                errorOptional: error.optional,
            });
            return;
        }
        if (insideTypeAssertion(node)) {
            // Narrowing 1: a foreign shape narrowed by a cast is not a contract
            // this module can change. Counted for the same reason.
            census.castNarrowed.push({
                file: relPath, line: lineOf(node), name: name ?? anonymousSinkName(node, sf),
                errorOptional: error.optional, members: describeMembers(read),
            });
            return;
        }
        census.sinks.push({
            file: relPath,
            line: lineOf(node),
            sink: name ?? anonymousSinkName(node, sf),
            kind,
            verdict: judgeSink(read),
            members: describeMembers(read),
        });
    };

    const visit = (n) => {
        if (ts.isInterfaceDeclaration(n)) {
            consider(n, n.members, n.name.text, 'interface');
        } else if (ts.isTypeAliasDeclaration(n) && ts.isTypeLiteralNode(n.type)) {
            consider(n.type, n.type.members, n.name.text, 'type alias');
        } else if (ts.isTypeLiteralNode(n) && !(n.parent && ts.isTypeAliasDeclaration(n.parent))) {
            consider(n, n.members, undefined, 'inline type');
        }
        n.forEachChild(visit);
    };
    sf.forEachChild(visit);
}

function emptyCensus() {
    return { sinks: [], impure: [], castNarrowed: [], noErrorMember: [], unreadable: [] };
}

// ── The ledger ──────────────────────────────────────────────────────────────

function loadBaseline() {
    if (!existsSync(BASELINE_PATH)) return { entries: [] };
    try {
        return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    } catch (e) {
        console.error(`✗ could not read ${relative(ROOT, BASELINE_PATH)}: ${e.message}`);
        process.exit(1);
    }
}

const baselineKey = (x) => `${x.file}::${x.sink}`;

// ── Reporting ───────────────────────────────────────────────────────────────

function remedy(v) {
    if (v.verdict === 'no-fallback') {
        return (
            '    fix     : declare the fallback channel this sink does not have, NON-optional:\n' +
            `                  ${FALLBACK_CHANNEL}: (msg: string, meta?: Record<string, any>) => void;\n` +
            '              then the call site can be written correctly at all:\n' +
            '                  if (logger?.error) logger.error(msg); else logger?.warn(msg);\n' +
            '    ⛔ NOT   : making `error` REQUIRED instead. Hosts do inject reduced sinks, and\n' +
            '              that change breaks every one of them (#9754 option C, falsified).\n'
        );
    }
    return (
        `    fix     : drop the \`?\` from \`${FALLBACK_CHANNEL}\` on this sink — it is the channel a\n` +
        '              durability report degrades to, so it must be there in every value of\n' +
        '              the type. `error` stays optional; only its fallback becomes certain:\n' +
        '                  info?: (msg: string) => void;\n' +
        '                  warn:  (msg: string) => void;      // ← guaranteed\n' +
        '                  error?: (msg: string) => void;\n' +
        '    ⛔ NOT   : making `error` REQUIRED (#9754 option C, falsified — hosts inject\n' +
        '              reduced sinks), and ⛔ NOT satisfying this with a required `info`:\n' +
        '              a lost write reported at `info` is the reassuring half-truth\n' +
        '              AGENTS.md → "Degradation log levels" exists to remove.\n'
    );
}

function printCensus(census) {
    const byVerdict = (v) => census.sinks.filter((s) => s.verdict === v);
    const red = census.sinks.filter((s) => RED_VERDICTS.has(s.verdict));
    console.log(
        `SINK CENSUS [optional-error-sink-contract] (#9754): ${census.sinks.length} sink type(s) declaring ` +
            `\`error\` in ${SCAN_ROOTS.join(', ')}/** — ${byVerdict('error-required').length} declare it REQUIRED ` +
            `(nothing to guarantee), ${byVerdict('fallback-guaranteed').length} declare it optional beside a ` +
            `REQUIRED \`${FALLBACK_CHANNEL}\`, ${red.length} permit silence ` +
            `(${byVerdict('optional-fallback').length} optional-fallback, ${byVerdict('no-fallback').length} no-fallback).`,
    );
    // ⭐ The REJECT sides, stated as positive numbers. A narrowing that quietly
    // stopped matching prints zero findings and zero skips; only these can tell
    // "correctly narrowed" from "silently broken", and the self-test pins them.
    console.log(
        `  narrowings: ${census.castNarrowed.length} shape(s) skipped as \`as\`-cast narrowings of a foreign ` +
            `object (${census.castNarrowed.filter((c) => c.errorOptional).length} of them with an optional \`error\`); ` +
            `${census.impure.length} skipped as not-a-pure-sink ` +
            `(${census.impure.filter((c) => c.errorOptional).length} of them with an optional \`error\` — that ` +
            'number is what the purity narrowing costs in coverage); ' +
            `${census.unreadable.length} skipped as UNREADABLE — every member is a channel name but a member type ` +
            `is a named type this syntactic matcher cannot resolve to a callable ` +
            `(${census.unreadable.filter((c) => c.errorOptional).length} of them with an optional \`error\` — that ` +
            'is what having no type checker costs in coverage); ' +
            `${census.noErrorMember.length} pure sink(s) declare no \`error\` at all and are out of the population.`,
    );
    // ⭐ The tally above is a COUNT, not a lower bound: the file prefilter is
    // derived from the whole channel vocabulary, so a sink declaring no `error`
    // is parsed and counted like any other (#11069). It read as a count before
    // that fix too, while silently omitting every such sink whose file happened
    // not to mention `error` elsewhere.
}

function printSinkList(census) {
    for (const s of census.sinks) {
        console.log(`  ${s.verdict.padEnd(19)} ${s.file}:${s.line}  ${s.kind} ${s.sink}  { ${s.members} }`);
    }
    for (const c of census.castNarrowed) {
        console.log(`  ${'skipped: cast'.padEnd(19)} ${c.file}:${c.line}  ${c.name}  { ${c.members} }`);
    }
    for (const c of census.impure) {
        console.log(
            `  ${'skipped: impure'.padEnd(19)} ${c.file}:${c.line}  ${c.name}` +
                `  (error ${c.errorOptional ? 'OPTIONAL' : 'required'})`,
        );
    }
    for (const c of census.unreadable) {
        console.log(
            `  ${'skipped: unreadable'.padEnd(19)} ${c.file}:${c.line}  ${c.name}  { ${c.members} }` +
                `  (error ${c.declaresError ? (c.errorOptional ? 'OPTIONAL' : 'required') : 'not declared'})`,
        );
    }
    // The `noErrorMember` tally is listed, not only totalled (#11069). It is the
    // one census line whose members are otherwise unnameable — every other
    // bucket prints its shapes — and an unlistable count is exactly what let a
    // 40% undercount sit in this output unnoticed. `--list` now shows which
    // sinks it is, so the number can be audited instead of believed.
    for (const c of census.noErrorMember) {
        console.log(`  ${'out: no `error`'.padEnd(19)} ${c.file}:${c.line}`);
    }
}

// ── Entry point ─────────────────────────────────────────────────────────────

function run({ list = false } = {}) {
    const census = emptyCensus();
    for (const root of SCAN_ROOTS) {
        for (const file of collectSourceFiles(join(ROOT, root))) {
            const text = readFileSync(file, 'utf8');
            // Cheap prefilter, sound for every bucket because it is derived from
            // the whole channel vocabulary rather than from `error` alone — see
            // CHANNEL_PREFILTER. `name?(` is the METHOD spelling; leaving it out
            // is exactly how the first draft of this population read a clean tree
            // while missing both audit sinks.
            if (!CHANNEL_PREFILTER.test(text)) continue;
            // `parseSourceFile` rather than the raw call: ts.createSourceFile never
            // throws, so a `.ts` file with a syntax error would be walked as a
            // recovered partial tree, contribute nothing to the census, and be
            // scored as a file with no sinks to report. scriptKind is OMITTED —
            // `collectSourceFiles` yields `.ts` only, so the file name infers
            // exactly what the forced `ScriptKind.TS` used to say, and forcing
            // one is its own blind spot (see scripts/ts-parse.mjs).
            const sf = parseSourceFile(file, text);
            analyzeSourceFile(sf, relative(ROOT, file).split(sep).join('/'), census);
        }
    }
    census.sinks.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

    printCensus(census);
    if (list) {
        printSinkList(census);
        return 0;
    }

    const baseline = loadBaseline();
    const allowed = new Map((baseline.entries ?? []).map((e) => [baselineKey(e), e]));
    const used = new Set();
    const violations = [];
    for (const s of census.sinks) {
        if (!RED_VERDICTS.has(s.verdict)) continue;
        const key = baselineKey(s);
        if (allowed.has(key)) {
            used.add(key);
            continue;
        }
        violations.push(s);
    }

    let failed = false;

    if (violations.length > 0) {
        failed = true;
        console.error(
            `\n✗ ${violations.length} sink type(s) declare an optional \`error\` with no guaranteed ` +
                'fallback channel — a contract that permits silence (#9754, AGENTS.md → "Degradation log levels"):\n',
        );
        for (const v of violations) {
            console.error(`  ${v.file}:${v.line}`);
            console.error(`    sink    : ${v.kind} ${v.sink}  { ${v.members} }`);
            console.error(
                `    found   : ${
                    v.verdict === 'no-fallback'
                        ? '`error` is optional and NO `warn` is declared — a call site here CANNOT be written correctly'
                        : '`error` is optional and `warn` is optional too — every value of this type may print nothing'
                }`,
            );
            console.error(remedy(v));
        }
    }

    const stale = [...allowed.keys()].filter((k) => !used.has(k));
    if (stale.length > 0) {
        failed = true;
        console.error(
            `\n✗ ${stale.length} stale entry(ies) in ${relative(ROOT, BASELINE_PATH)} — the sink is no longer ` +
                'red (repaired, renamed or moved). The ledger is shrink-only: delete the entry in the same PR.\n',
        );
        for (const k of stale) console.error(`  ${k}`);
    }

    if (!failed) {
        console.log(
            `✓ optional-error sink contract: every sink declaring an optional \`error\` guarantees a ` +
                `\`${FALLBACK_CHANNEL}\` channel` +
                (allowed.size > 0 ? ` (${allowed.size} baselined, shrink-only)` : '') +
                '.',
        );
    }
    return failed ? 1 : 0;
}

// ── Self-test ───────────────────────────────────────────────────────────────

/**
 * Every limb observed FAILING and observed SILENT, plus the narrowings
 * pinned as positive counts.
 *
 * The reject side is pinned deliberately: a matcher that stopped matching
 * reports zero violations, which is also what a clean tree reports. Only
 * `expectSinks` / `expectCast` / `expectImpure` / `expectNoError` can tell the
 * two apart, so each case states all of them.
 */
function selfTest() {
    const cases = [
        {
            name: 'no-fallback: an optional `error` alone — nothing to reach for',
            code: 'interface L { error?: (m: string) => void; }',
            expectVerdicts: ['no-fallback'],
        },
        {
            name: 'no-fallback: the METHOD spelling, with a debug beside it (the audit-sink shape)',
            code: 'interface L { error?(m: string, e?: Error): void; debug?(m: string): void; }',
            expectVerdicts: ['no-fallback'],
        },
        {
            name: 'optional-fallback: `warn` is declared but optional — silence is still representable',
            code: 'interface L { info?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void; }',
            expectVerdicts: ['optional-fallback'],
        },
        {
            name: 'clean: an optional `error` beside a REQUIRED `warn` (the repaired shape)',
            code: 'interface L { warn: (m: string) => void; info?: (m: string) => void; error?: (m: string) => void; }',
            expectVerdicts: ['fallback-guaranteed'],
        },
        {
            name: 'clean: the METHOD spelling of the repaired shape',
            code: 'interface L { warn(m: string): void; error?(m: string): void; }',
            expectVerdicts: ['fallback-guaranteed'],
        },
        {
            name: 'clean: a REQUIRED `error` is never judged — option C is not what this gate asks for',
            code: 'interface L { error: (m: string) => void; debug?: (m: string) => void; }',
            expectVerdicts: ['error-required'],
        },
        {
            name: 'the population includes ANONYMOUS inline sinks, not only named ones',
            code: 'interface Opts { logger?: { info?: (m: string) => void; warn?: (m: string) => void; error?: (m: string) => void }; }',
            expectVerdicts: ['optional-fallback'],
            expectSinkNames: ['logger@Opts'],
        },
        {
            name: 'the population includes a type ALIAS to a literal',
            code: 'type LoggerLike = { warn?: (m: string) => void; error?: (m: string) => void };',
            expectVerdicts: ['optional-fallback'],
            expectSinkNames: ['LoggerLike'],
        },
        {
            // ⭐ Narrowing 1, pinned as a positive number. `console` is not a
            // contract this repo publishes, and no decree adds `warn` to it.
            name: 'narrowing 1: a shape narrowed by an `as` cast is skipped, and COUNTED',
            code: 'const f = (m: string) => (globalThis as { console?: { error?: (m: string) => void } }).console?.error?.(m);',
            expectVerdicts: [],
            expectCast: 1,
        },
        {
            // ⭐ Narrowing 2, same. An options bag is not a sink.
            name: 'narrowing 2: an impure shape (a member outside the vocabulary) is skipped, and COUNTED',
            code: 'interface Deps { error?: (m: string) => void; resolveService: (n: string) => unknown; }',
            expectVerdicts: [],
            expectImpure: 1,
            expectImpureOptionalError: 1,
        },
        {
            // A shape whose `error` is a STRING is not a reduced logger at all —
            // it is a result envelope. It leaves the population entirely rather
            // than being counted as a narrowing, and the zero is pinned here so
            // that "not a sink" and "skipped as impure" stay distinguishable.
            name: 'out of population: a NON-function `error` is a result field, not a channel',
            code: 'interface Result { error?: string; warn?: string; }',
            expectVerdicts: [],
            expectImpure: 0,
        },
        {
            name: 'out of population: a sink that declares no `error` has nothing to guarantee',
            code: 'interface L { info?: (m: string) => void; warn?: (m: string) => void; }',
            expectVerdicts: [],
            expectNoError: 1,
        },
        {
            name: 'an index signature makes the shape unreadable to this rule, and it says so by counting',
            code: 'interface L { [k: string]: unknown; error?: (m: string) => void; }',
            expectVerdicts: [],
            expectImpure: 1,
            expectImpureOptionalError: 1,
        },
        {
            // ⭐ #11069 limb 1, the RED direction. Before this limb, bare
            // `Function` set `fn = false`, which hid the `error` member from the
            // population lookup AND made the shape impure — so the whole sink
            // landed in no bucket at all. Three live `plugin-sharing` shapes were
            // invisible exactly this way. `expectImpure: 0` is half the pin: it
            // says the shape is JUDGED, not merely re-routed into a skip bucket.
            name: 'limb: a sink spelled with bare `Function` is in the population, and RED',
            code: 'interface L { info?: Function; warn?: Function; error?: Function; debug?: Function }',
            expectVerdicts: ['optional-fallback'],
            expectImpure: 0,
            expectNoError: 0,
        },
        {
            name: 'limb: bare `Function` beside a REQUIRED `warn` is clean — the limb widens, it does not redden',
            code: 'interface L { warn: Function; error?: Function }',
            expectVerdicts: ['fallback-guaranteed'],
        },
        {
            // The other half of limb 1: a bare-`Function` sink with no `error` is
            // out of the population, and now COUNTED there instead of vanishing.
            // `record-orphan-cleanup.ts`'s `MinimalLogger` is this shape.
            name: 'limb: a bare-`Function` sink declaring no `error` joins the census tally',
            code: 'interface L { info?: Function; warn?: Function }',
            expectVerdicts: [],
            expectNoError: 1,
        },
        {
            // ⭐ #11069 limb 1's REJECT side, pinned as a positive number. An
            // indexed access is a callable only a type CHECKER can confirm, and
            // this gate has none. `suspended-run-store.ts`'s `MinimalLogger` is
            // this shape. Counted, never silently dropped.
            name: 'reject side: a member typed by an INDEXED ACCESS is unreadable, and COUNTED',
            code: "interface L { warn?: Logger['warn']; debug?: Logger['debug'] }",
            expectVerdicts: [],
            expectUnreadable: 1,
            expectImpure: 0,
            expectNoError: 0,
        },
        {
            name: 'reject side: a member typed by an unresolvable ALIAS is unreadable, and COUNTED',
            code: 'interface L { warn?: AnyCallable; error?: AnyCallable }',
            expectVerdicts: [],
            expectUnreadable: 1,
            expectUnreadableOptionalError: 1,
        },
        {
            // The boundary that keeps the reject side meaningful. A KEYWORD type
            // is unambiguously not callable, so `{ error?: string; warn?: string }`
            // stays out of every bucket rather than inflating `unreadable`. The
            // `Result` case above pins the same tree from the other side.
            name: 'reject side does NOT swallow keyword types — a `string` `error` is a result field, not unreadable',
            code: 'interface Result { error?: string; warn?: string; }',
            expectVerdicts: [],
            expectUnreadable: 0,
            expectImpure: 0,
        },
    ];

    let failures = 0;
    for (const c of cases) {
        const sf = parseSourceFile('t.ts', c.code);
        const census = emptyCensus();
        analyzeSourceFile(sf, 't.ts', census);
        const verdicts = census.sinks.map((s) => s.verdict);
        const names = census.sinks.map((s) => s.sink);
        const problems = [];
        if (JSON.stringify(verdicts) !== JSON.stringify(c.expectVerdicts)) {
            problems.push(`verdicts ${JSON.stringify(verdicts)} != ${JSON.stringify(c.expectVerdicts)}`);
        }
        if (c.expectSinkNames && JSON.stringify(names) !== JSON.stringify(c.expectSinkNames)) {
            problems.push(`sink names ${JSON.stringify(names)} != ${JSON.stringify(c.expectSinkNames)}`);
        }
        if (census.castNarrowed.length !== (c.expectCast ?? 0)) {
            problems.push(`cast-narrowed ${census.castNarrowed.length} != ${c.expectCast ?? 0}`);
        }
        if (census.impure.length !== (c.expectImpure ?? 0)) {
            problems.push(`impure ${census.impure.length} != ${c.expectImpure ?? 0}`);
        }
        if (
            c.expectImpureOptionalError !== undefined &&
            census.impure.filter((x) => x.errorOptional).length !== c.expectImpureOptionalError
        ) {
            problems.push('impure-with-optional-error count mismatch');
        }
        if (census.noErrorMember.length !== (c.expectNoError ?? 0)) {
            problems.push(`no-error-member ${census.noErrorMember.length} != ${c.expectNoError ?? 0}`);
        }
        if (census.unreadable.length !== (c.expectUnreadable ?? 0)) {
            problems.push(`unreadable ${census.unreadable.length} != ${c.expectUnreadable ?? 0}`);
        }
        if (
            c.expectUnreadableOptionalError !== undefined &&
            census.unreadable.filter((x) => x.errorOptional).length !== c.expectUnreadableOptionalError
        ) {
            problems.push('unreadable-with-optional-error count mismatch');
        }
        if (problems.length > 0) {
            failures++;
            console.error(`  ✗ ${c.name}\n      ${problems.join('\n      ')}`);
        }
    }

    // ⭐ The file PREFILTER, pinned separately because the cases above call
    // `analyzeSourceFile` directly and so never reach it — which is exactly how
    // an unsound prefilter survived a self-test that pinned both narrowings as
    // counts (#11069). Every channel, in all four spellings a member of that
    // name can take, must reach the parser.
    for (const channel of LOG_CHANNELS) {
        const spellings = [
            `interface L { ${channel}: (m: string) => void }`, // property
            `interface L { ${channel}?: (m: string) => void }`, // optional property
            `interface L { ${channel}(m: string): void }`, // method
            `interface L { ${channel}?(m: string): void }`, // optional method
        ];
        for (const code of spellings) {
            if (!CHANNEL_PREFILTER.test(code)) {
                failures++;
                console.error(`  ✗ prefilter skips a file declaring \`${channel}\`: ${code}`);
            }
        }
    }
    // The reject side of the prefilter, so "always true" is distinguishable from
    // "correctly derived". A module with no channel member is skipped, and that
    // is what keeps the scan cheap.
    if (CHANNEL_PREFILTER.test('export const answer: number = 42;')) {
        failures++;
        console.error('  ✗ prefilter matches a file with no log-channel member — it is not filtering at all');
    }
    // The derivation itself: a channel added to the vocabulary must widen the
    // prefilter automatically. A hand-written second copy of the vocabulary is
    // how the previous narrowing outlived its own reason.
    for (const channel of LOG_CHANNELS) {
        if (!CHANNEL_PREFILTER.source.includes(channel)) {
            failures++;
            console.error(`  ✗ prefilter is not derived from LOG_CHANNELS — \`${channel}\` is missing from it`);
        }
    }
    // ⭐ And that `run` actually GOES THROUGH it. Found by ablation while
    // writing this: replacing the call site with a literal `/\berror…/` — the
    // exact regression #11069 repaired — restored the undercount (tally 96 → 58)
    // while every pin above stayed green, because they all test the constant and
    // none of them tests the scan. A pin that cannot observe the revert it
    // exists to prevent is the same defect this card is about, one level up.
    //
    // This reads `run`'s source rather than its behaviour, which is a real
    // limit: it proves the scan REFERENCES the derived prefilter, not that it
    // uses the result correctly. That is precisely the half no other assertion
    // here covers — the cases above already pin the semantics — and it is the
    // half a second, hand-written copy of the vocabulary would break.
    //
    // ⚠️ COMMENTS ARE STRIPPED FIRST, and that is not tidiness. The first
    // version of this pin tested `run.toString()` directly and stayed GREEN
    // under the very ablation it was written for — because the comment above
    // the call site names `CHANNEL_PREFILTER` in prose, and `toString()`
    // returns comments verbatim. A pin satisfied by a SENTENCE DESCRIBING the
    // code is satisfied by deleting the code and keeping the sentence.
    const runBody = run
        .toString()
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    if (!runBody.includes('CHANNEL_PREFILTER.test(')) {
        failures++;
        console.error(
            '  ✗ `run` does not reference CHANNEL_PREFILTER — the scan is filtering files through some other\n' +
                '      test. Every count this gate prints is bounded by that decision; route it through the\n' +
                '      derived prefilter, or the `noErrorMember` tally silently stops being a count (#11069).',
        );
    }

    // The ledger's own shape is part of the contract: a hand-edited entry that
    // cannot key against a finding would silently excuse nothing (or, worse,
    // everything).
    const baseline = loadBaseline();
    for (const e of baseline.entries ?? []) {
        for (const field of ['file', 'sink', 'verdict', 'note']) {
            if (typeof e[field] !== 'string' || e[field].length === 0) {
                failures++;
                console.error(`  ✗ baseline entry ${JSON.stringify(e)} is missing a \`${field}\``);
            }
        }
        if (e.verdict && !RED_VERDICTS.has(e.verdict)) {
            failures++;
            console.error(`  ✗ baseline entry ${baselineKey(e)} carries a non-red verdict \`${e.verdict}\``);
        }
    }

    if (failures > 0) {
        console.error(`✗ optional-error-sink-contract self-test: ${failures} case(s) failed`);
        return 1;
    }
    console.log(
        `✓ optional-error-sink-contract self-test: ${cases.length} case(s), both directions, ` +
            `all three narrowings pinned as counts, prefilter pinned over ${LOG_CHANNELS.size} channel(s) ` +
            '× 4 spellings plus its reject side.',
    );
    return 0;
}

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) {
    process.exit(selfTest());
}
process.exit(run({ list: argv.includes('--list') }));
