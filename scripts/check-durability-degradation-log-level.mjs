#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Durability-degradation log-level guard (#4632, from #4471 / #4420 / #4460).
 *
 * ## The rule it enforces
 *
 * AGENTS.md → "Degradation log levels": a best-effort degradation whose
 * consequence is only reduced FUNCTIONALITY (a screen missing, a capability
 * not armed) may log `warn`/`info`. A degradation whose consequence is that
 * something the system CLAIMS to persist is not actually persisted — while the
 * system keeps looking healthy — MUST log `error`, naming the consequence and
 * the fix.
 *
 * The judgment question, from AGENTS.md:
 *
 *   > After the degradation, does the system still look "normal" from the
 *   > outside while something it claims is persisted has not actually landed?
 *   > Yes → `error`.
 *
 * #4420 is the accident this exists for: the durable suspended-run store was
 * attached to a table that was never created, every write failed into a `warn`
 * nobody read, and each restart silently dropped every in-flight approval. The
 * system reported itself healthy the whole time. #4460 fixed that ONE site;
 * this gate is what keeps the class fixed.
 *
 * ## What it checks (deliberately narrow — see "Why a vocabulary")
 *
 * For every `try`/`catch` whose `try` block calls a **durability-critical**
 * operation from the declared vocabulary below, the `catch` must either
 *
 *   - rethrow (the failure propagates — the loudest option), or
 *   - log at `error` (or `fatal`).
 *
 * A `catch` that logs `warn`/`info`/`debug`, or swallows silently, is a
 * violation: the write did not happen, and nothing above will ever hear so.
 *
 * ## Why a vocabulary, and not "detect persistence"
 *
 * "Is this catch guarding a durability seam?" is a semantic question, and a
 * heuristic that guesses it (callee names matching /save|write|persist/, say)
 * produces false positives at a rate that would get the gate disabled — and a
 * gate people disable is worth less than no gate, because it also *reports
 * success*. So the vocabulary is EXPLICIT and small: the operations whose
 * failure is known to mean "the bytes did not land". Adding an entry is a
 * deliberate, reviewable act.
 *
 * Two honest limitations, stated up front rather than discovered later:
 *
 *   1. It cannot FIND a durability seam whose operation is not in the
 *      vocabulary. It guarantees the seams already paid for cannot regress to
 *      `warn`, and gives one place to extend. A ratchet, not a proof.
 *   2. The `catch` is scanned for a loud log across its whole subtree, so a
 *      catch that RECOVERS through a nested try (the batch→sequential schema
 *      sync fallback in `objectql/plugin.ts`) passes on the nested path's
 *      `error`. That is the right verdict for that shape — the durability-losing
 *      path does end loudly — but it does mean an unrelated nested
 *      `logger.error` would satisfy the gate. Narrowing this would fail the
 *      legitimate recovering catch, which is the worse trade.
 *
 * ## Why AST, not regex
 *
 * The guarded call is rarely adjacent to the log line — in `objectql/plugin.ts`
 * the `await driver.syncSchema(...)` and its `logger.warn` sit in different
 * blocks of a nested loop, and in #4420 the call was in a private method the
 * try block invoked. Line proximity does not decide this; block structure does.
 *
 * Nested function bodies inside the `try` are NOT descended into: a callback
 * registered inside a try (`ctx.hook('kernel:ready', async () => …)`) runs
 * later and is not guarded by that catch. Same choice, same reason, as
 * `check-init-service-contract.mjs`.
 *
 * The `catch` side, by contrast, DOES follow same-file helpers transitively: a
 * catch that calls `reportSyncFailure(...)` is loud if that helper is. Without
 * this, extracting a shared reporter — normal, good refactoring — would defeat
 * the gate, which would make "hide the failure behind one indirection" the
 * cheapest way to go quiet. That is the #4420 shape itself, and it is why
 * `check-init-service-contract.mjs` walks a call graph too.
 *
 * ## Usage
 *
 *     node scripts/check-durability-degradation-log-level.mjs             # audit
 *     node scripts/check-durability-degradation-log-level.mjs --list      # every guarded seam found
 *     node scripts/check-durability-degradation-log-level.mjs --self-test # verify the checker
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASELINE_PATH = join(ROOT, 'scripts', 'durability-degradation.baseline.json');

/**
 * Operations whose failure means "the bytes did not land".
 *
 * Each entry names WHY it is durability-critical — the note is printed in the
 * violation message, so the author reads the consequence rather than a rule id.
 */
const DURABILITY_CRITICAL_CALLEES = new Map([
    [
        'syncSchema',
        'DDL for the object never ran — the table/columns do not exist, yet the object stays registered and served.',
    ],
    [
        'syncSchemasBatch',
        'DDL for a whole batch of objects never ran — their tables/columns do not exist, yet the objects stay registered and served.',
    ],
    [
        'syncRegisteredSchemas',
        'The schema-sync pass never completed — objects are registered and served against tables that were never created or altered.',
    ],
    [
        'initObjects',
        'Object storage was never initialized — writes go to a table that does not exist.',
    ],
    [
        'rearmSuspendedWaitTimers',
        'Suspended runs survive on disk but nothing will ever resume them — the persisted state and the runtime disagree (ADR-0019, #4420).',
    ],
]);

/** Log levels that are ACCEPTABLE inside a durability-guarding catch. */
const LOUD_LEVELS = new Set(['error', 'fatal']);
/** Log levels that are NOT — the whole point of the gate. */
const QUIET_LEVELS = new Set(['warn', 'info', 'debug', 'trace', 'log']);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.turbo', 'coverage', '.cache']);

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

/** Walk `node`'s subtree without descending into bodies that run LATER. */
function walkSameTick(node, visit) {
    node.forEachChild((child) => {
        if (
            ts.isFunctionDeclaration(child) ||
            ts.isFunctionExpression(child) ||
            ts.isArrowFunction(child) ||
            ts.isMethodDeclaration(child) ||
            ts.isClassDeclaration(child) ||
            ts.isClassExpression(child)
        ) {
            return;
        }
        visit(child);
        walkSameTick(child, visit);
    });
}

/** Walk everything, including nested function bodies. */
function walkAll(node, visit) {
    node.forEachChild((child) => {
        visit(child);
        walkAll(child, visit);
    });
}

function calleeName(node) {
    if (!ts.isCallExpression(node)) return undefined;
    const expr = node.expression;
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) return expr.name.text;
    return undefined;
}

/**
 * `x.logger.warn(...)` / `logger.warn(...)` / `this.log.error(...)` /
 * `console.error(...)` → 'warn' | 'error' | …
 *
 * Matched on the SHAPE `<logger|log|console>.<level>(…)`, so a renamed local
 * (`const log = ctx.logger`) is still seen. `console` counts because
 * `console.error` is every bit as loud as `logger.error` — measuring the gate
 * against the repo turned up a real site (`metadata/src/loaders/
 * database-loader.ts` history-schema sync) that reports honestly via `console`,
 * and flagging it would have been a false positive.
 */
function loggerLevel(node) {
    if (!ts.isCallExpression(node)) return undefined;
    const expr = node.expression;
    if (!ts.isPropertyAccessExpression(expr) || !ts.isIdentifier(expr.name)) return undefined;
    const level = expr.name.text;
    if (!LOUD_LEVELS.has(level) && !QUIET_LEVELS.has(level)) return undefined;
    const receiver = expr.expression;
    let receiverName;
    if (ts.isIdentifier(receiver)) receiverName = receiver.text;
    else if (ts.isPropertyAccessExpression(receiver) && ts.isIdentifier(receiver.name)) {
        receiverName = receiver.name.text;
    }
    if (!receiverName) return undefined;
    return /^(logger|log|console)$/i.test(receiverName) ? level : undefined;
}

/**
 * Index every named function-like body in the file, so a `catch` that delegates
 * to a helper can be judged by what the helper does.
 *
 * Covers `function foo() {}`, `const foo = () => {}` / `= function () {}`, and
 * class methods `foo() {}` — the three shapes the repo actually uses. Keyed by
 * bare name: same-file collisions are rare and the effect of one would only be
 * to consider a catch louder, never quieter than it is.
 */
function indexFunctionBodies(sf) {
    const byName = new Map();
    walkAll(sf, (node) => {
        if (ts.isFunctionDeclaration(node) && node.name && node.body) {
            byName.set(node.name.text, node.body);
        } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
            byName.set(node.name.text, node.body);
        } else if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
            node.initializer.body
        ) {
            byName.set(node.name.text, node.initializer.body);
        }
    });
    return byName;
}

function analyzeSourceFile(sf, relPath, findings, seams) {
    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const functionBodies = indexFunctionBodies(sf);

    /**
     * Collect the log levels a catch reaches, following same-file helper calls
     * transitively (depth-capped, cycle-safe).
     */
    const collectResponse = (block, seen = new Set(), depth = 0) => {
        const levels = [];
        let rethrows = false;
        walkSameTick(block, (child) => {
            if (ts.isThrowStatement(child)) rethrows = true;
            const level = loggerLevel(child);
            if (level) {
                levels.push({ level, line: lineOf(child) });
                return;
            }
            if (depth >= 3) return;
            const name = calleeName(child);
            if (!name || seen.has(name)) return;
            const body = functionBodies.get(name);
            if (!body) return;
            seen.add(name);
            const nested = collectResponse(body, seen, depth + 1);
            for (const l of nested.levels) levels.push({ ...l, viaHelper: name });
            // A helper that rethrows does NOT make the CATCH rethrow — it only
            // does if the catch itself propagates. Deliberately not inherited.
        });
        return { levels, rethrows };
    };

    walkAll(sf, (node) => {
        if (!ts.isTryStatement(node) || !node.catchClause) return;

        // 1. Does the guarded block call a durability-critical operation?
        const guarded = [];
        const inspectForCritical = (child) => {
            const name = calleeName(child);
            if (name && DURABILITY_CRITICAL_CALLEES.has(name)) {
                guarded.push({ callee: name, line: lineOf(child) });
            }
        };
        // The try block itself may BE a call at top level, so check it too.
        inspectForCritical(node.tryBlock);
        walkSameTick(node.tryBlock, inspectForCritical);
        if (guarded.length === 0) return;

        // 2. How does the catch respond?
        const { levels, rethrows } = collectResponse(node.catchClause.block);

        const loud = levels.filter((l) => LOUD_LEVELS.has(l.level));
        const quiet = levels.filter((l) => QUIET_LEVELS.has(l.level));

        const seam = {
            file: relPath,
            callee: guarded[0].callee,
            calleeLine: guarded[0].line,
            catchLine: lineOf(node.catchClause),
            rethrows,
            loud: loud.map((l) => `${l.level}@${l.line}${l.viaHelper ? ` via ${l.viaHelper}()` : ''}`),
            quiet: quiet.map((l) => `${l.level}@${l.line}${l.viaHelper ? ` via ${l.viaHelper}()` : ''}`),
        };
        seams.push(seam);

        if (rethrows || loud.length > 0) return;

        findings.push({
            ...seam,
            why: DURABILITY_CRITICAL_CALLEES.get(guarded[0].callee),
            kind: quiet.length > 0 ? 'quiet-log' : 'silent-swallow',
        });
    });
}

function loadBaseline() {
    if (!existsSync(BASELINE_PATH)) return { entries: [] };
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

function baselineKey(f) {
    return `${f.file}::${f.callee}`;
}

function run({ list = false } = {}) {
    const packagesDir = join(ROOT, 'packages');
    const files = collectSourceFiles(packagesDir);
    const findings = [];
    const seams = [];

    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        if (!text.includes('catch')) continue;
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        analyzeSourceFile(sf, relative(ROOT, file).split(sep).join('/'), findings, seams);
    }

    if (list) {
        console.log(`\nDurability-critical catch seams found: ${seams.length}\n`);
        for (const s of seams) {
            const verdict = s.rethrows
                ? 'rethrows'
                : s.loud.length > 0
                  ? `loud (${s.loud.join(', ')})`
                  : s.quiet.length > 0
                    ? `QUIET (${s.quiet.join(', ')})`
                    : 'SILENT';
            console.log(`  ${s.file}:${s.catchLine}  guards ${s.callee}()@${s.calleeLine}  → ${verdict}`);
        }
        console.log('');
    }

    const baseline = loadBaseline();
    const allowed = new Map((baseline.entries ?? []).map((e) => [`${e.file}::${e.callee}`, e]));
    const violations = [];
    const usedBaselineKeys = new Set();

    for (const f of findings) {
        const key = baselineKey(f);
        if (allowed.has(key)) {
            usedBaselineKeys.add(key);
            continue;
        }
        violations.push(f);
    }

    // Shrink-only: a baseline entry whose violation is gone must be deleted, so
    // the file can never quietly re-license a site that was already fixed.
    const stale = [...allowed.keys()].filter((k) => !usedBaselineKeys.has(k));

    let failed = false;

    if (violations.length > 0) {
        failed = true;
        console.error(
            `\n✗ ${violations.length} durability-critical catch(es) degrade quietly (AGENTS.md → "Degradation log levels", #4632):\n`,
        );
        for (const v of violations) {
            console.error(`  ${v.file}:${v.catchLine}`);
            console.error(`    guards  : ${v.callee}() at line ${v.calleeLine}`);
            console.error(`    consequence: ${v.why}`);
            console.error(
                `    found   : ${v.kind === 'quiet-log' ? `catch logs ${v.quiet.join(', ')} and does not rethrow` : 'catch swallows the failure with no log at all'}`,
            );
            console.error(
                `    fix     : log at \`error\` naming the CONSEQUENCE and the FIX (see packages/services/service-automation/src/plugin.ts start(), #4460), or rethrow.\n`,
            );
        }
    }

    if (stale.length > 0) {
        failed = true;
        console.error(
            `\n✗ ${stale.length} stale baseline entr(ies) in scripts/durability-degradation.baseline.json — the site no longer violates, so delete the entry (the baseline is shrink-only):\n`,
        );
        for (const k of stale) console.error(`  ${k}`);
        console.error('');
    }

    if (!failed) {
        console.log(
            `✓ durability-degradation log levels: ${seams.length} durability-critical catch seam(s), all loud or rethrowing` +
                (allowed.size > 0 ? ` (${allowed.size} baselined)` : '') +
                '.',
        );
    }

    return failed ? 1 : 0;
}

// ── Self-test ────────────────────────────────────────────────────────────────
// A checker nobody checks is the shape this gate exists to prevent. These
// fixtures pin both directions: it must FLAG the #4420 shape and must NOT flag
// the shapes that are legitimately `warn`.
function selfTest() {
    const cases = [
        {
            name: 'flags: catch around syncSchema logging warn',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { ctx.logger.warn('failed', { e }); }
                } }`,
            expectViolation: true,
        },
        {
            name: 'flags: catch around syncSchema swallowing silently',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); } catch { /* ignore */ }
                } }`,
            expectViolation: true,
        },
        {
            name: 'passes: catch around syncSchema logging error',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { ctx.logger.error('DDL never ran — writes will not persist; fix X', { e }); }
                } }`,
            expectViolation: false,
        },
        {
            name: 'passes: catch around syncSchema that rethrows',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { ctx.logger.warn('context'); throw e; }
                } }`,
            expectViolation: false,
        },
        {
            name: 'passes: functional degradation (no critical callee) may warn',
            code: `
                class P { async f(ctx: any, automation: any) {
                    try { automation.registerTrigger(this.t); }
                    catch (e) { ctx.logger.warn('trigger NOT installed'); }
                } }`,
            expectViolation: false,
        },
        {
            name: 'passes: critical call inside a LATER callback is not guarded by this catch',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try { ctx.hook('kernel:ready', async () => { await driver.syncSchema('t', obj); }); }
                    catch (e) { ctx.logger.warn('hook registration failed'); }
                } }`,
            expectViolation: false,
        },
        {
            name: 'passes: console.error is as loud as logger.error',
            code: `
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { console.error('DDL never ran — writes will not persist; fix X', e); }
                } }`,
            expectViolation: false,
        },
        {
            name: 'passes: catch delegating to a LOUD same-file helper',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    const report = (e: unknown) => { ctx.logger.error('DDL never ran — not durable; fix X', e); };
                    try { await driver.syncSchema('t', obj); } catch (e) { report(e); }
                } }`,
            expectViolation: false,
        },
        {
            name: 'flags: catch delegating to a QUIET same-file helper',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    const report = (e: unknown) => { ctx.logger.warn('failed', e); };
                    try { await driver.syncSchema('t', obj); } catch (e) { report(e); }
                } }`,
            expectViolation: true,
        },
        {
            name: 'flags: renamed logger local is still seen',
            code: `
                class P { async f(log: any, driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e) { log.warn('failed'); }
                } }`,
            expectViolation: true,
        },
    ];

    let failures = 0;
    for (const c of cases) {
        const sf = ts.createSourceFile('t.ts', c.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const findings = [];
        const seams = [];
        analyzeSourceFile(sf, 't.ts', findings, seams);
        const got = findings.length > 0;
        if (got !== c.expectViolation) {
            failures++;
            console.error(`  ✗ ${c.name}: expected violation=${c.expectViolation}, got ${got}`);
        } else {
            console.log(`  ✓ ${c.name}`);
        }
    }
    if (failures > 0) {
        console.error(`\n✗ self-test: ${failures} case(s) failed\n`);
        return 1;
    }
    console.log(`\n✓ self-test: ${cases.length} case(s) passed\n`);
    return 0;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
    process.exit(selfTest());
} else {
    process.exit(run({ list: args.includes('--list') }));
}
