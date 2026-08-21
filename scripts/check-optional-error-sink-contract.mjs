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
 * costs false positives instead, so both narrowings below are measured and
 * their cost is printed on every run rather than argued in prose.
 *
 * A SINK is: an interface, a type alias to a type literal, or an inline type
 * literal, all of whose members are function-typed and named from
 * {error, warn, info, debug, log, fatal, trace, verbose, silly}, and which
 * declares `error`. Measured over `packages/**` immediately BEFORE the two
 * repairs that landed with this file (`SweepLogger`, `ProjectionLogger`):
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
 * ⚠️ NOT wired into `.github/workflows/lint.yml` by the PR that introduced it.
 * #9754's own body forbids more merge-blocking ("⛔ Not a new required context;
 * this argues for a producer-side constraint, not more merge-blocking"), and
 * #9747's family ruling — carried forward by the lane PM when this card was
 * re-graded — was visibility-only. Run it on demand:
 *
 *   pnpm check:optional-error-sink          # --self-test, then the scan
 *   node scripts/check-optional-error-sink-contract.mjs --list   # census only, always exit 0
 *
 * Wiring it into the required `Lint & Repo Gates` job is a lane-PM decision,
 * recorded on #9754 rather than taken here.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

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
 * Is this member's type a function?
 *
 * A method signature (`error?(m: string): void`) counts, and so does a property
 * whose type is a function (`error?: (m: string) => void`). Both spellings are
 * live in this repo and the two audit sinks — the very types this card was
 * filed over — use the METHOD form: a matcher that only knew the property form
 * reported a clean tree while missing the sharpest instance in it. Measured,
 * while drawing this population.
 */
function isFunctionTyped(member) {
    if (ts.isMethodSignature(member)) return true;
    if (!ts.isPropertySignature(member)) return false;
    const seen = (t) => {
        if (!t) return false;
        if (ts.isFunctionTypeNode(t)) return true;
        if (ts.isParenthesizedTypeNode(t)) return seen(t.type);
        if (ts.isUnionTypeNode(t)) return t.types.some(seen);
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
    for (const m of members) {
        if ((ts.isPropertySignature(m) || ts.isMethodSignature(m)) && m.name && ts.isIdentifier(m.name)) {
            const name = m.name.text;
            const fn = isFunctionTyped(m);
            named.push({ name, optional: !!m.questionToken, fn });
            if (!LOG_CHANNELS.has(name) || !fn) pure = false;
        } else {
            // An index signature, a call signature, a computed key: a shape that
            // can carry arbitrary members is not a contract this rule reads.
            pure = false;
            named.push({ name: '<non-property>', optional: false, fn: false });
        }
    }
    return { pure, members: named };
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
        const { pure, members: read } = readShape(members);
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
    return { sinks: [], impure: [], castNarrowed: [], noErrorMember: [] };
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
            `${census.noErrorMember.length} pure sink(s) declare no \`error\` at all and are out of the population.`,
    );
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
}

// ── Entry point ─────────────────────────────────────────────────────────────

function run({ list = false } = {}) {
    const census = emptyCensus();
    for (const root of SCAN_ROOTS) {
        for (const file of collectSourceFiles(join(ROOT, root))) {
            const text = readFileSync(file, 'utf8');
            // Cheap prefilter. `error?(` is the METHOD spelling — leaving it out of
            // this regex is exactly how the first draft of this population read a
            // clean tree while missing both audit sinks.
            if (!/\berror\s*\??\s*[:(]/.test(text)) continue;
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
 * Every limb observed FAILING and observed SILENT, plus the two narrowings
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
        if (problems.length > 0) {
            failures++;
            console.error(`  ✗ ${c.name}\n      ${problems.join('\n      ')}`);
        }
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
            'both narrowings pinned as counts.',
    );
    return 0;
}

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) {
    process.exit(selfTest());
}
process.exit(run({ list: argv.includes('--list') }));
