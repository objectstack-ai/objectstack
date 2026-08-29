#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-logger-receiver-detach -- a log channel read off a RECEIVER-SENSITIVE
 * sink must keep its receiver (#12820, from #12773 / #12792).
 *
 *   node scripts/check-logger-receiver-detach.mjs              # the gate
 *   node scripts/check-logger-receiver-detach.mjs --census     # measure, never fail
 *   node scripts/check-logger-receiver-detach.mjs --self-test  # verify the checker
 *
 * ## The defect class
 *
 * `a.b(...)` passes `a` as the receiver. Every spelling that evaluates the
 * property to a bare FUNCTION and calls it afterwards does not:
 *
 *     (logger.error ?? logger.warn)(msg);      // parenthesized callee
 *     const fn = logger.error; fn(msg);        // two-step local
 *     const { error } = logger; error(msg);    // destructured channel
 *     run(logger.warn);                        // handed on as a callback
 *     configure({ warn: logger.warn });        // handed on in an options bag
 *
 * `@objectstack/core`'s `ObjectLogger` is a class with prototype methods and no
 * constructor binding -- `error`/`fatal` reach for `this.writeErrorLike`,
 * `debug`/`info`/`warn` for `this.write` -- so a host that injects one turns
 * every such line into a `TypeError`, on the channel whose whole purpose is to
 * be loud when something is already wrong.
 *
 * The class was closed three times, one package at a time (#12773 ->
 * `plugin-auth`, 3 sites; #12792 -> `driver-sql`, 9 sites), each round finding
 * the next round's population by hand. Nothing watched the class. This is that
 * watch.
 *
 * ## ⭐ The whole question is the FALSE-POSITIVE surface, and it is measured
 *
 * #12820 declined to propose a gate precisely because the false-positive
 * surface had not been measured, and named the two legitimate populations a
 * naive instrument flags. Both were re-measured on this tree before this gate
 * was written (`--census` reproduces every number):
 *
 *   - **`console`** -- `(this.opts.log ?? console.log)(line)` in
 *     `packages/cli/src/utils/dev-restart.ts`, and
 *     `((globalThis as any).console?.warn ?? ...console?.error)?.(...)` in
 *     `packages/rest/src/log.ts`. `console`'s methods are BOUND in Node and in
 *     browsers, so detaching them is correct code.
 *   - **the options-callback shape** -- `opts.warn` / `options.info` / a
 *     `console` default, in `objectql/registry.ts`, `spec/data/object.zod.ts`,
 *     `runtime/artifact-reference.ts`, `cli/utils/console.ts`,
 *     `cli/utils/artifact-boot-migration.ts`,
 *     `service-datasource/sqlite-driver-fallback.ts`,
 *     `driver-mongodb/src/test-mongod.ts`, `cli/commands/serve.ts`,
 *     `core/src/logger.ts`. These are caller-supplied PLAIN FUNCTIONS in a bag,
 *     never a method lifted off a receiver-sensitive class.
 *
 * A gate that reds those is a gate people turn off, which is worse than no gate
 * because it also reports success. So the criterion below is written to leave
 * every one of them green, and the self-test holds it to that with the real
 * spellings rather than with paraphrases.
 *
 * ## ⛔ Why the criterion CANNOT be the channel name
 *
 * `error` / `warn` / `info` / `log` appear in both populations, so a name
 * matcher false-positives by construction. Measured on this tree, over the
 * property reads whose NAME is a log channel and which sit in call position in
 * non-test source:
 *
 *     deps.error(...)     117 sites -- an error-ENVELOPE constructor
 *     this.error(...)      91 sites -- oclif `Command.error`, which THROWS
 *     Math.log(...)         2 sites -- arithmetic
 *
 * 210 sites that are not logging at all, before any question of detachment is
 * asked. The name says nothing; the RECEIVER says everything.
 *
 * ## The criterion: an anchored receiver vocabulary
 *
 * `RECEIVER_SENSITIVE_SINKS` below declares the receiver spellings whose
 * channels dispatch through `this`, each entry naming WHY -- the same bargain
 * `DURABILITY_CRITICAL_CALLEES` makes in
 * `check-durability-degradation-log-level.mjs`, and for the same reason: "is
 * this object receiver-sensitive?" is a TYPE question, a heuristic that guesses
 * it produces false positives at a rate that gets the gate disabled, so the
 * vocabulary is EXPLICIT and small and adding an entry is a deliberate,
 * reviewable act.
 *
 * A receiver is matched on the FINAL NAME SEGMENT of its expression, so
 * `logger`, `this.logger`, `ctx.logger`, `opts.logger`, `deps.logger`,
 * `kernel.logger` and `(driver as any).logger` are one entry, while `opts` and
 * `options` -- the options-bag receivers -- are not in the vocabulary at all
 * and are never flagged.
 *
 * ## Three honest limitations, stated up front rather than discovered later
 *
 *   1. It cannot FIND a sink whose receiver is spelled a way the vocabulary
 *      does not have. `check-durability-degradation-log-level.mjs`'s own
 *      `LOGGER_RECEIVERS` decision records the measurement behind this: receiver
 *      PROVENANCE is not syntactically available, and declaring receiver names
 *      only postpones the miss, because the next binding gets a name the list
 *      does not have. This is a RATCHET, not a proof -- it guarantees the
 *      spellings already paid for cannot regress, and gives one place to extend.
 *      The direction of the error is the safe one: a real sink may go
 *      unwatched, and nothing legitimate is ever accused.
 *   2. It reads NON-TEST source only, and that is measured rather than
 *      stylistic. Lifted over test files the bare-argument shape alone produces
 *      351 findings, 329 of them `expect(logger.warn).toHaveBeenCalled()` and 6
 *      `vi.mocked(logger.info)` -- handing a channel to an assertion helper that
 *      never calls it. Worse, the two pin tests that DOCUMENT this defect class
 *      (`logger-receiver-detach.test.ts` in `driver-sql` and `plugin-auth`)
 *      detach a channel on purpose, as their control sample. A gate that reds
 *      the tests proving the defect exists is the gate that gets deleted.
 *   3. It judges SPELLING, not reachability. `logger.error?.bind(logger)`,
 *      `(logger.error ?? logger.warn).call(logger, msg)` and
 *      `if (logger.error) logger.error(msg)` are all correct and all green; a
 *      site that restores the receiver by some route this file does not know is
 *      a false positive, and the remedy is to write one of the known-correct
 *      spellings rather than to widen the gate.
 *
 * ## ⛔ Why an empty sweep REFUSES instead of reporting clean
 *
 * This gate's success condition ("no detach anywhere") and its total-failure
 * condition ("the walk found nothing / the matcher matches nothing") print the
 * same green. So every run -- not only `--self-test` -- scans a built-in
 * CONTROL corpus with two halves and refuses unless both agree: the MUST-FIRE
 * half (one instance of each shape, including a fallback split across lines and
 * a docblock quoting the shape in prose that must NOT be counted) produces
 * exactly its expected findings, and the MUST-NOT-FIRE half (the real `console`
 * and options-bag spellings from this tree, plus the correct `.bind` / `.call` /
 * guarded forms) produces none. A zero over the repo is a reading only because
 * something in the same run proved the instrument returns non-zero -- and the
 * dual, that it does not return non-zero for everything.
 *
 * ## ⛔ Not in scope here, deliberately
 *
 * `check-durability-degradation-log-level.mjs` has a KNOWN matcher blind spot
 * -- it cannot see a call on a parenthesized expression (the ADR-0120 D4 note
 * at `driver-sql/src/sql-driver.ts`). Both halves of that fact have to be said
 * together or neither: the blind spot is real and still unfiled as fixed, AND
 * #12792 measured that it costs ZERO findings today -- none of its nine sites
 * sat inside a `catch` guarding a `DURABILITY_CRITICAL_CALLEES` operation, and
 * the audit output was byte-identical before and after. That file is untouched
 * by this PR; four open cards plus a `needs-user-decision` sit on it.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireDefaultExport } from './import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);
import { parseSourceFile } from './ts-parse.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(HERE, '..');

/**
 * ## The dispatch-gates declaration -- the `ROOT_DIR_WATCH_HINTS` idiom (#12322)
 *
 * `scripts/pm/dispatch-gates.mjs` derives which gates a card must run by matching
 * PATH LITERALS in each gate's source text against the card's changed files, so this
 * must stay a literal array in the declaration statement itself
 * (`check:watch-hint-literal` holds it there). The roots below are the three walked
 * by `sourceFilesUnder`; the `.ts` tail is the extension it admits.
 *
 * ⛔ Never computed from `SCAN_ROOTS` -- the runtime value would be identical, every
 * local assertion would stay green, and the gate would silently drop out of every
 * dispatch brief.
 */
const ROOT_DIR_WATCH_HINTS = [
    'packages/**/*.ts', 'packages/**/*.tsx', 'packages/**/*.mts',
    'examples/**/*.ts',
    'apps/**/*.ts', 'apps/**/*.tsx',
];

/**
 * The three roots that hold shipped runtime code. Measured cost of stopping
 * there: SEVEN tracked `.ts` files live outside them -- `tsup.config.ts` and
 * six under `scripts/analytics-reconcile/` -- and every log-channel read in all
 * seven is a `console.*` in CALL position. So the narrowing costs zero findings
 * today, and `scripts/` is `.mjs` besides.
 */
const SCAN_ROOTS = ['packages', 'examples', 'apps'];

/**
 * Directory names never walked. `node_modules`/`dist`/`.cache`/`.turbo`/`.source`
 * are GENERATED (`.source` is `fumadocs-mdx`'s postinstall output under
 * `apps/docs`, untracked, so walking it makes the file count depend on whether
 * `pnpm install` has run); `__tests__` is limitation 2's population.
 */
const SKIP_DIRS = new Set([
    'node_modules', 'dist', '.git', '.cache', '.turbo', '.source', '__tests__',
]);

/** Filename tails that mark a file as test-layer -- limitation 2. */
const TEST_TAIL = /\.(test|spec|e2e|bench)\.[cm]?tsx?$/;

/**
 * The channel names a log sink may expose. This list NARROWS -- it never
 * decides. A read is a candidate only when its receiver is also in the
 * vocabulary below; see "Why the criterion cannot be the channel name".
 */
const LOG_CHANNELS = new Set(['debug', 'info', 'warn', 'error', 'fatal', 'log']);

/**
 * Receiver spellings whose log channels DISPATCH THROUGH `this`, so detaching
 * one is a defect. Matched on the FINAL NAME SEGMENT of the receiver
 * expression, lowercased -- `logger`, `this.logger`, `ctx.logger`,
 * `opts.logger` and `(driver as any).logger` are all this one entry.
 *
 * Each entry names why. Adding one is a deliberate, reviewable act; the
 * direction of a MISSING entry is a sink that goes unwatched, never a
 * legitimate site accused.
 */
const RECEIVER_SENSITIVE_SINKS = new Map([
    [
        'logger',
        "@objectstack/core's `ObjectLogger` is a class whose channels reach for `this.write` / `this.writeErrorLike`; every injected-logger seam in the tree (`ctx.logger`, `opts.logger`, `deps.logger`, `kernel.logger`, `this.logger`) can hold one.",
    ],
    [
        'loggerref',
        'A held reference to the same injected logger (`runtime/src/app-plugin.ts`); the reference does not bind the method.',
    ],
    [
        'sink',
        "`packages/observability`'s log sink is a class (`this.sink.error(line)`), and `core/src/security/authz-cache-posture.ts` reports through one.",
    ],
    [
        'port',
        "The injected reporting receiver of the dangling-reference audit (`objectql/src/integrity/dangling-reference-audit.ts`, `port.warn?.(...)`) -- the live injected-receiver seam #8897 records.",
    ],
    [
        'telemetry',
        'The injected reporting receiver of `metadata-core/src/object-schema-fls.ts` (`telemetry?.warn?.(...)`).',
    ],
]);

/**
 * Receiver spellings CONSIDERED and DECLINED, with the reason. This map is not
 * consulted by the matcher -- the vocabulary above is an allowlist, so anything
 * absent is already unflagged. It is here because the next author's first
 * instinct will be to add one of these, and the measurement that says not to
 * belongs next to the temptation. `--self-test` holds the two maps disjoint.
 */
const DECLINED_RECEIVERS = new Map([
    [
        'console',
        "`console`'s methods are BOUND in Node and in browsers, so `(console.warn ?? console.error)(...)` is correct code. Adding it reds `packages/rest/src/log.ts` and `packages/cli/src/utils/dev-restart.ts` on day one.",
    ],
    [
        'opts',
        'An options BAG. `opts.warn` is a caller-supplied plain function (`warn?: (msg: string) => void`), not a method lifted off a class. Adding it reds the 9-file options-callback population #12820 measured.',
    ],
    ['options', 'Same as `opts` -- the other spelling of the same options bag.'],
    [
        'deps',
        'Not a log sink at all: `deps.error(...)` is an error-ENVELOPE constructor, 117 call sites in `packages/runtime/src/domains/**`. Only `deps.logger` is a sink, and that final segment is `logger`.',
    ],
    [
        'this',
        "Not a log sink: `this.error(...)` is oclif's `Command.error`, which THROWS. 91 call sites under `packages/cli/src/commands/**`. Only `this.logger` is a sink.",
    ],
    ['math', '`Math.log` is arithmetic. The clearest proof that the channel NAME decides nothing.'],
    [
        'consoleref',
        'A held reference to `console` (`packages/types/src/env.ts`). Bound for the same reason `console` is.',
    ],
]);

// ---------------------------------------------------------------------------
// The matcher
// ---------------------------------------------------------------------------

/**
 * The `ScriptKind` a file must be parsed as. ⛔ Never a constant: in TSX a `<`
 * opens a JSX element, so forcing `ScriptKind.TS` on a `.tsx` file makes the
 * rest of it wreckage -- and forcing TSX on a `.ts` file breaks every generic
 * arrow. `parseSourceFile` REFUSES either wreck rather than scoring it clean,
 * which turns a mis-kinded walk into a loud stop instead of a quiet green.
 */
function scriptKindOf(fileName) {
    return /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** Peel the wrappers that do not change what an expression evaluates to. */
function unwrap(node) {
    let cur = node;
    while (
        ts.isParenthesizedExpression(cur)
        || ts.isAsExpression(cur)
        || ts.isNonNullExpression(cur)
        || ts.isSatisfiesExpression?.(cur)
    ) cur = cur.expression;
    return cur;
}

/**
 * The FINAL NAME SEGMENT of a receiver expression, lowercased -- the token the
 * vocabulary is matched against. Returns `undefined` when the receiver has no
 * readable name (a call, an element access with a computed key, `this` alone).
 *
 * `this` deliberately answers `this`, which is in DECLINED_RECEIVERS: a bare
 * `this.error(...)` is oclif's throwing `Command.error`, never a channel.
 */
function receiverSegment(expr) {
    const n = unwrap(expr);
    if (ts.isIdentifier(n)) return n.text.toLowerCase();
    if (n.kind === ts.SyntaxKind.ThisKeyword) return 'this';
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.name)) return n.name.text.toLowerCase();
    if (ts.isElementAccessExpression(n) && n.argumentExpression
        && ts.isStringLiteralLike(n.argumentExpression)) {
        return n.argumentExpression.text.toLowerCase();
    }
    return undefined;
}

/** Is this property read a log channel off a RECEIVER-SENSITIVE sink? */
function sensitiveChannelRead(node) {
    if (!ts.isPropertyAccessExpression(node)) return undefined;
    if (!ts.isIdentifier(node.name) || !LOG_CHANNELS.has(node.name.text)) return undefined;
    const seg = receiverSegment(node.expression);
    if (seg === undefined || !RECEIVER_SENSITIVE_SINKS.has(seg)) return undefined;
    return { segment: seg, channel: node.name.text, node };
}

/**
 * Every sensitive channel read a `??` / `||` / `?:` chain can RESOLVE TO.
 *
 * A leg that is a CALL -- `logger.error?.bind(logger)`, `logger.warn.bind(logger)`
 * -- resolves to a bound function and contributes nothing, which is why the
 * repo's five `.bind` sites stay green.
 */
function resolvedChannelReads(node) {
    const n = unwrap(node);
    if (ts.isBinaryExpression(n)
        && (n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
            || n.operatorToken.kind === ts.SyntaxKind.BarBarToken)) {
        return [...resolvedChannelReads(n.left), ...resolvedChannelReads(n.right)];
    }
    if (ts.isConditionalExpression(n)) {
        return [...resolvedChannelReads(n.whenTrue), ...resolvedChannelReads(n.whenFalse)];
    }
    const hit = sensitiveChannelRead(n);
    return hit ? [hit] : [];
}

/**
 * The five detach shapes. `text` is the source line, for the failure message.
 *
 * ⛔ A read that stays in CALL position (`logger.warn(msg)`), that is only
 * PROBED (`if (logger.error)`, `typeof logger.error === 'function'`), or that
 * is the base of a further member access (`logger.error?.bind(logger)`) is not
 * a detach and appears in none of the five.
 */
function scan(text, fileName) {
    const sf = parseSourceFile(fileName, text, scriptKindOf(fileName));
    const findings = [];
    const at = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
    const line = (n) => text.slice(n.getStart(sf), n.getStart(sf) + 140).split('\n')[0].trim();
    const add = (shape, n, reads) => findings.push({
        shape,
        line: at(n),
        text: line(n),
        segment: reads[0].segment,
        channel: reads.map((r) => r.channel).join('/'),
    });

    const visit = (node) => {
        // (1) a call whose CALLEE is a parenthesized expression resolving to a
        //     sensitive channel: `(logger.error ?? logger.warn)(msg)`. Immune to
        //     line breaks -- the shape a single-line regex can only half see.
        if (ts.isCallExpression(node) && ts.isParenthesizedExpression(node.expression)) {
            const reads = resolvedChannelReads(node.expression);
            if (reads.length > 0) add('parenthesized-callee', node, reads);
        }

        if (ts.isVariableDeclaration(node) && node.initializer) {
            // (2) the two-step form, flagged AT THE DECLARATION: the local is
            //     already a bare function, whether the call is in this file or not.
            if (ts.isIdentifier(node.name)) {
                const reads = resolvedChannelReads(node.initializer);
                if (reads.length > 0) add('two-step-local', node, reads);
            }
            // (3) a channel destructured off a sensitive sink.
            if (ts.isObjectBindingPattern(node.name)) {
                const seg = receiverSegment(node.initializer);
                if (seg !== undefined && RECEIVER_SENSITIVE_SINKS.has(seg)) {
                    for (const el of node.name.elements) {
                        const key = (el.propertyName ?? el.name);
                        const name = ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : undefined;
                        if (name && LOG_CHANNELS.has(name)) {
                            add('destructured-channel', el, [{ segment: seg, channel: name }]);
                        }
                    }
                }
            }
        }

        // (4) handed on as a bare callback ARGUMENT: `run(logger.warn)`.
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
            for (const arg of node.arguments ?? []) {
                const hit = sensitiveChannelRead(unwrap(arg));
                if (hit) add('channel-as-callback', arg, [hit]);
            }
        }

        // (5) ⭐ THE RETURN PATH -- handed on inside an options bag:
        //     `configure({ warn: logger.warn })`. #12820's most important
        //     sentence: the detach happens at the CALLER, where no reviewer of
        //     the callee will ever see it, and nothing would notice if one
        //     caller started.
        if (ts.isPropertyAssignment(node)) {
            const hit = sensitiveChannelRead(unwrap(node.initializer));
            if (hit) add('channel-into-options-bag', node, [hit]);
        }

        ts.forEachChild(node, visit);
    };
    visit(sf);
    return findings;
}

// ---------------------------------------------------------------------------
// The control corpus -- run on EVERY invocation, not only --self-test
// ---------------------------------------------------------------------------

/**
 * ⛔ MUST FIRE. One instance of each of the five shapes, plus the two things
 * that must NOT be counted inside it: a docblock quoting the bad shape in prose
 * (the exact miscount #12792 corrected in public, when `grep -c` counted a
 * comment line as a call site) and the correct `if`/`else` spelling.
 *
 * The fallback in `b()` is SPLIT ACROSS LINES on purpose: no single-line
 * instrument can see it, and #12773's regex missing exactly this is how that
 * card's own population went from 1 to 3 mid-card.
 */
const CONTROL_MUST_FIRE = [
    'class Ctl {',
    '  private logger = { warn: (m: string) => void m, error: undefined as undefined | ((m: string) => void) };',
    "  a() { (this.logger.error ?? this.logger.warn)('one line'); }",
    '  b() {',
    '    (',
    '      this.logger.error ??',
    '      this.logger.warn',
    "    )('split across lines');",
    '  }',
    "  c() { const fn = this.logger.error ?? this.logger.warn; fn('two-step'); }",
    "  d() { const { warn } = this.logger; warn('destructured'); }",
    '  e() { [1].forEach(this.logger.warn); }',
    '  f() { configure({ warn: this.logger.warn }); }',
    '  /** prose: (this.logger.error ?? this.logger.warn)(…) is NOT a call site. */',
    "  ok() { if (this.logger.error) this.logger.error('bound'); else this.logger.warn('bound'); }",
    '}',
].join('\n');

/** Shape -> how many times it must appear in the MUST-FIRE control. */
const CONTROL_EXPECTED = new Map([
    ['parenthesized-callee', 2],
    ['two-step-local', 1],
    ['destructured-channel', 1],
    ['channel-as-callback', 1],
    ['channel-into-options-bag', 1],
]);

/** The last line of the MUST-FIRE control that may legitimately be flagged. */
const CONTROL_LAST_FLAGGABLE_LINE = 13;

/**
 * ⛔ MUST NOT FIRE -- and every line is a REAL spelling from this tree, not a
 * paraphrase. Half of a false-positive measurement is proving the instrument
 * stays silent on the sites that made the card refuse to propose a gate.
 */
const CONTROL_MUST_NOT_FIRE = [
    '// --- the `console` population (bound in Node and in browsers) ---',
    '// packages/cli/src/utils/dev-restart.ts',
    'const c1 = (opts: any, line: string) => (opts.log ?? console.log)(line);',
    '// packages/rest/src/log.ts',
    'const c2 = (...args: unknown[]) =>',
    '  ((globalThis as any).console?.warn ?? (globalThis as any).console?.error)?.(...args);',
    '// packages/types/src/env.ts',
    'const c3 = (consoleRef: any, m: string) => { const w = consoleRef?.warn; w?.(m); };',
    '',
    '// --- the options-callback population (caller-supplied plain functions) ---',
    '// packages/objectql/src/registry.ts, spec/data/object.zod.ts, runtime/artifact-reference.ts',
    'function o1(opts: { warn?: (m: string) => void }) { const warn = opts.warn ?? console.warn; warn("x"); }',
    'function o2(options: { warn?: (m: string) => void }) { const warn = options.warn ?? (() => {}); warn("x"); }',
    'function o3(opts: { info?: (m: string) => void; warn?: (m: string) => void }) {',
    '  const info = opts.info ?? console.log; const warn = opts.warn ?? console.warn; info("a"); warn("b");',
    '}',
    '',
    '// --- not log channels at all ---',
    'const n1 = (deps: any) => deps.error("INTERNAL", 500);          // an error ENVELOPE, 117 sites',
    'const n2 = (bytes: number) => Math.log(bytes) / Math.log(1024); // arithmetic',
    'const n3 = (result: any) => ({ ok: false, error: result.error });// a DATA field, 36 sites',
    '',
    '// --- the CORRECT spellings on a receiver-sensitive sink ---',
    '// packages/triggers/trigger-schedule/src/schedule-trigger.ts',
    'const b1 = (logger: any) => { const report = logger.error?.bind(logger) ?? logger.warn.bind(logger); report("x"); };',
    '// packages/drivers/driver-turso/src/turso-driver.ts',
    'const b2 = (o: any, message: string) => (o.logger.error ?? o.logger.warn).call(o.logger, message);',
    '// packages/services/service-settings/src/settings-service.ts',
    'const b3 = (o: any, message: string) => { if (o.logger?.warn) o.logger.warn(message); };',
    '// packages/objectql/src/engine.ts',
    'const b4 = (o: any, msg: string) => { if (typeof o.logger.error === "function") o.logger.error(msg); };',
    '// packages/plugins/plugin-security/src/per-organization-catalog.ts',
    'const b5 = (logger: any, message: string) => { logger?.error?.(message); };',
].join('\n');

/**
 * Run the control. Returns the problems found, empty when the instrument is
 * behaving. ⛔ Called by the GATE, not only by `--self-test`: without it a
 * broken matcher and a clean repo print the same green line.
 */
function controlProblems() {
    const problems = [];

    const fired = scan(CONTROL_MUST_FIRE, 'control-must-fire.ts');
    for (const [shape, want] of CONTROL_EXPECTED) {
        const got = fired.filter((f) => f.shape === shape).length;
        if (got !== want) {
            problems.push(
                `CONTROL (must fire): shape \`${shape}\` produced ${got} finding(s), expected ${want}. `
                + 'The matcher cannot see a shape it is supposed to see, so a zero over the repo '
                + 'is not a reading.',
            );
        }
    }
    for (const f of fired.filter((f) => f.line > CONTROL_LAST_FLAGGABLE_LINE)) {
        problems.push(
            `CONTROL (must fire): line ${f.line} was flagged as \`${f.shape}\`, but lines past `
            + `${CONTROL_LAST_FLAGGABLE_LINE} are the docblock quoting the shape in PROSE and the `
            + 'correct `if`/`else` spelling. Comments are not AST nodes; neither must be a finding.',
        );
    }

    const quiet = scan(CONTROL_MUST_NOT_FIRE, 'control-must-not-fire.ts');
    for (const f of quiet) {
        problems.push(
            `CONTROL (must NOT fire): line ${f.line} flagged as \`${f.shape}\` on receiver `
            + `\`${f.segment}\` -- ${f.text}. That is a LEGITIMATE spelling measured on this tree `
            + '(a bound `console`, a caller-supplied options callback, a non-log receiver, or a '
            + 'correctly re-bound channel). A gate that reds these is a gate people turn off.',
        );
    }
    return problems;
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

function sourceFilesUnder(dir, acc = []) {
    let entries;
    try { entries = readdirSync(dir); } catch { return acc; }
    for (const entry of entries) {
        if (SKIP_DIRS.has(entry)) continue;
        const p = join(dir, entry);
        let st;
        try { st = statSync(p); } catch { continue; }
        if (st.isDirectory()) sourceFilesUnder(p, acc);
        else if (/\.[cm]?tsx?$/.test(entry) && !TEST_TAIL.test(entry) && !entry.endsWith('.d.ts')) {
            acc.push(relative(repoRoot, p).replace(/\\/g, '/'));
        }
    }
    return acc;
}

function measure() {
    const files = SCAN_ROOTS.flatMap((r) => sourceFilesUnder(join(repoRoot, r)));
    const findings = [];
    for (const file of files.sort()) {
        const text = readFileSync(join(repoRoot, file), 'utf8');
        for (const f of scan(text, file)) findings.push({ file, ...f });
    }
    return { files, findings };
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function selfTest() {
    const failures = [];
    const expect = (what, ok) => { if (!ok) failures.push(what); };

    // The control corpus -- both halves.
    const problems = controlProblems();
    expect(
        `the control corpus agrees with the matcher (got ${problems.length} problem(s):\n      `
        + problems.join('\n      ') + ')',
        problems.length === 0,
    );

    // The two vocabularies describe disjoint worlds. A spelling in both would
    // mean the gate flags a receiver its own documentation declines.
    for (const seg of RECEIVER_SENSITIVE_SINKS.keys()) {
        expect(`\`${seg}\` is declared receiver-sensitive AND declined -- pick one`,
            !DECLINED_RECEIVERS.has(seg));
    }
    // Every entry carries a REASON, in both maps. An entry with an empty note
    // is an entry whose next reader cannot tell whether it is still true.
    for (const [map, name] of [[RECEIVER_SENSITIVE_SINKS, 'RECEIVER_SENSITIVE_SINKS'],
        [DECLINED_RECEIVERS, 'DECLINED_RECEIVERS']]) {
        for (const [seg, why] of map) {
            expect(`${name}[${seg}] names why`, typeof why === 'string' && why.length > 40);
        }
    }

    // ⭐ No vocabulary entry is decorative: each one, spelled into a detach,
    // FIRES; each declined one, spelled into the same detach, does NOT.
    const probe = (seg) => scan(
        `declare const ${seg}: any;\nconst fn = ${seg}.error ?? ${seg}.warn;\nfn('x');\n`,
        'probe.ts',
    );
    for (const seg of RECEIVER_SENSITIVE_SINKS.keys()) {
        expect(`RECEIVER_SENSITIVE_SINKS[${seg}] actually fires`, probe(seg).length > 0);
    }
    for (const seg of DECLINED_RECEIVERS.keys()) {
        if (seg === 'this') continue; // `this` is not a spellable declaration name
        expect(`DECLINED_RECEIVERS[${seg}] stays silent`, probe(seg).length === 0);
    }
    // …and the receiver is matched on the FINAL segment, so every injected seam
    // spelling is the SAME entry rather than one entry per host.
    for (const spelling of ['this.logger', 'ctx.logger', 'opts.logger', 'deps.logger',
        'kernel.logger', '(driver as any).logger']) {
        const src = `declare const ctx: any, opts: any, deps: any, kernel: any, driver: any;\n`
            + `class K { logger: any; m() { const fn = ${spelling}.error; fn('x'); } }\n`;
        expect(`\`${spelling}\` resolves to the \`logger\` entry`, scan(src, 'seg.ts').length === 1);
    }
    // ⛔ and the CHANNEL name alone never decides: the same shape on a declined
    // receiver is silent even though the channel spelling is identical.
    expect('an identical channel spelling on a declined receiver is silent',
        scan("declare const opts: any;\nconst fn = opts.error ?? opts.warn;\nfn('x');\n", 'ch.ts').length === 0);

    // A receiver-restoring leg contributes nothing -- the repo's five `.bind`
    // sites and the one `.call` site are green for a structural reason, not by
    // luck.
    expect('a `.bind` leg is not a detach',
        scan("declare const logger: any;\nconst r = logger.error?.bind(logger) ?? logger.warn.bind(logger);\nr('x');\n", 'bind.ts').length === 0);
    expect('`.call(receiver, …)` on a fallback is not a detach',
        scan("declare const logger: any;\n(logger.error ?? logger.warn).call(logger, 'x');\n", 'call.ts').length === 0);
    expect('an optional CALL keeps its receiver',
        scan("declare const logger: any;\nlogger.error?.('x');\n", 'optcall.ts').length === 0);
    expect('a capability PROBE is not a detach',
        scan("declare const logger: any;\nif (logger.error) logger.error('x');\n", 'probe2.ts').length === 0);

    // The walk: non-empty, and a NARROWING rather than the roots wearing a glob.
    const { files } = measure();
    expect('the walk is non-empty, so the repo pass judges something', files.length > 0);
    expect('every walked file is a non-test TS file under a declared root',
        files.every((f) => SCAN_ROOTS.some((r) => f.startsWith(`${r}/`))
            && /\.[cm]?tsx?$/.test(f) && !TEST_TAIL.test(f)));
    const walked = new Set(files);
    let testSibling;
    for (const f of files) {
        const dir = dirname(f);
        const hit = readdirSync(join(repoRoot, dir))
            .map((e) => `${dir}/${e}`)
            .find((s) => TEST_TAIL.test(s));
        if (hit) { testSibling = hit; break; }
    }
    expect('a `.test.ts` sibling exists to prove the test filter discriminates', Boolean(testSibling));
    expect('…and that sibling is NOT walked (limitation 2 is real, not aspirational)',
        Boolean(testSibling) && !walked.has(testSibling));

    // ── The dispatch-gates declaration, held to the walk in BOTH directions ──
    //
    // ⛔ Checked with a local matcher rather than by importing
    // `scripts/pm/dispatch-gates.mjs`: the import specifier would itself be a path
    // literal in this file's source, so the derivation would hand this gate that
    // module's declared population as if it were this gate's own -- a fabricated
    // watch surface, and a gate a reviewing seat cannot run in place.
    const declaresFile = (f) => ROOT_DIR_WATCH_HINTS.some((h) => {
        const m = /^([^/]+)\/\*\*\/\*(\.[a-z]+)$/.exec(h);
        return Boolean(m) && f.startsWith(`${m[1]}/`) && f.endsWith(m[2]);
    });
    const undeclared = files.filter((f) => !declaresFile(f));
    expect(`every walked file is named by a declared hint -- an undeclared one is a file this `
        + `gate opens and no dispatch brief can see (${undeclared.length} miss(es)`
        + `${undeclared.length ? `: ${undeclared.slice(0, 3).join(', ')}` : ''})`,
        undeclared.length === 0);
    expect('and no hint is DEAD -- each one names at least one file this gate really walks',
        ROOT_DIR_WATCH_HINTS.every((h) => files.some((f) => {
            const m = /^([^/]+)\/\*\*\/\*(\.[a-z]+)$/.exec(h);
            return Boolean(m) && f.startsWith(`${m[1]}/`) && f.endsWith(m[2]);
        })));
    expect('and no hint names a root this gate does not walk',
        ROOT_DIR_WATCH_HINTS.every((h) => SCAN_ROOTS.some((r) => h.startsWith(`${r}/`))));

    if (failures.length > 0) {
        console.error(`x check-logger-receiver-detach --self-test (${failures.length} failure(s)):\n`);
        for (const f of failures) console.error(`  - ${f}`);
        console.error('');
        process.exit(1);
    }
    console.log(
        'OK  self-test: the control corpus fires on all five detach shapes (including a fallback\n'
        + '    split across lines) and stays silent on prose, on the correct `if`/`else`, on the\n'
        + '    measured `console` and options-callback populations, on `deps.error` / `Math.log` /\n'
        + '    `result.error`, and on every receiver-restoring spelling in the tree; no vocabulary\n'
        + '    entry is decorative and no declined one fires; the walk is a narrowing and its\n'
        + '    roots match the declared watch hints.',
    );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function describe(f) {
    return `${f.file}:${f.line}  [${f.shape}] receiver \`${f.segment}\`, channel \`${f.channel}\`\n`
        + `      ${f.text}`;
}

if (!isEntrypoint(import.meta.url)) {
    // Imported (another gate's self-test, or a measurement helper). Walking the
    // tree as an import side effect would make this file impossible to reuse.
} else if (process.argv.includes('--self-test')) {
    selfTest();
} else if (process.argv.includes('--census')) {
    const { files, findings } = measure();
    console.log(`census: ${files.length} non-test TS file(s) under ${SCAN_ROOTS.join(', ')}`);
    console.log(`        ${findings.length} detach(es) on a receiver-sensitive sink`);
    const byShape = new Map();
    for (const f of findings) byShape.set(f.shape, (byShape.get(f.shape) ?? 0) + 1);
    for (const shape of CONTROL_EXPECTED.keys()) console.log(`        ${String(byShape.get(shape) ?? 0).padStart(4)}  ${shape}`);
    for (const f of findings) console.log(`  ${describe(f)}`);
    const problems = controlProblems();
    console.log(problems.length === 0
        ? '        control: fires on all five shapes, silent on every legitimate spelling.'
        : `        control: ${problems.length} PROBLEM(S) -- the numbers above are not readings.`);
} else {
    const errors = [];

    // ⛔ The control runs FIRST and on every invocation: this gate's success
    // condition and its total-failure condition print the same green.
    errors.push(...controlProblems());

    const { files, findings } = measure();
    if (files.length === 0) {
        errors.push(
            'DISCOVERED: the walk admitted no source files at all. That is a broken sweep, not a '
            + 'clean repo -- "no detach anywhere" is vacuously true over zero files.',
        );
    }
    for (const f of findings) {
        errors.push(
            `${describe(f)}\n      A log channel read off \`${f.segment}\` -- `
            + `${RECEIVER_SENSITIVE_SINKS.get(f.segment)}\n`
            + '      Fix: call it through the property access (`x.warn(msg)`), or restore the '
            + 'receiver explicitly (`x.warn.bind(x)`, `(x.error ?? x.warn).call(x, msg)`).',
        );
    }

    if (errors.length > 0) {
        console.error(`x logger receiver detach (${errors.length} problem(s)):\n`);
        for (const e of errors) console.error(`  - ${e}\n`);
        process.exit(1);
    }
    console.log(
        `OK  every log channel keeps its receiver: ${files.length} non-test TS file(s) walked, `
        + `0 detach(es) on the ${RECEIVER_SENSITIVE_SINKS.size} declared receiver-sensitive sink `
        + 'spelling(s).',
    );
    console.log(
        '    control corpus fired on all five detach shapes in this same run, and stayed silent '
        + 'on the measured `console` and options-callback populations -- so the zero above is a '
        + 'reading.',
    );
}
