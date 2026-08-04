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
    [
        'writeDeferredReference',
        "A seed's pass-2 back-fill never landed — the row was written but its reference column stays NULL, so a circular relationship is half-written while every row counter reads clean (#4729, framework#2805).",
    ],
    [
        'writeRecord',
        'A seed record was not written — the row is simply absent (or, on the upsert/update path, still holds its pre-seed contents) while the load moves on to the next record (#4729).',
    ],
    [
        'performSeedWrite',
        "A seed write's post-write roll-up summary recompute was swallowed — the rows landed, but a persisted summary column now disagrees with the detail rows it summarizes and nothing recomputes it, while every row counter and `success` still read clean (#4998, framework#3147).",
    ],
    [
        'deliverPersistedRow',
        "An accepted email was never transmitted — the sys_email row stays at `status:'queued'` with the caller already told the message was accepted, and the only other reader of that row is the once-per-boot outbox sweep (#5161).",
    ],
    [
        'dropPromotedDraftRow',
        "A published draft was never drained — the active row is correct, but the `state='draft'` row is still in `sys_metadata`, so Studio/Setup keeps showing unpublished changes that do not exist and the next publish promotes the same stale body again (#4981).",
    ],
    [
        'saveMetaItem',
        'The metadata definition was never written to the authoritative store — the runtime looks completely normal because the in-memory registry already has it, and the definition simply vanishes on the next provision/restart (#4754, from #4669).',
    ],
    [
        'deleteMetaItemFromLoader',
        'The metadata definition was never deleted from the authoritative store — `unregister()` still resolves and still announces `deleted`, the in-memory registry entry is gone, and the surviving row is read straight back out of storage by the very next `list()`/`get()`, so the "deleted" item reappears and survives every restart. Nothing retries it (#5259).',
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

/** Does this node's body run LATER (a callback), rather than on this tick? */
function runsLater(node) {
    return (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node)
    );
}

/** Walk `node`'s subtree without descending into bodies that run LATER. */
function walkSameTick(node, visit) {
    node.forEachChild((child) => {
        if (runsLater(child)) return;
        visit(child);
        walkSameTick(child, visit);
    });
}

/**
 * `walkSameTick`, plus the node itself.
 *
 * A concise-arrow helper body (`const logError = (...a) => console.error(...a)`)
 * IS the call expression, not a block containing one, so a plain `walkSameTick`
 * — which only ever visits CHILDREN — never inspects it and the helper reads as
 * silent. That shape is exactly the same-file reporter the `catch` side is
 * documented to follow, so missing it made a genuinely loud catch report as
 * `silent-swallow` (`rest-server.ts`'s two `/meta` PUT handlers, #4754).
 */
function walkSameTickInclusive(node, visit) {
    visit(node);
    walkSameTick(node, visit);
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
        walkSameTickInclusive(block, (child) => {
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

    /**
     * Does this statement ALWAYS leave by throwing?
     *
     * Deliberately conservative — only the shapes whose control flow is
     * unambiguous. Anything it cannot prove counts as "may complete normally",
     * which errs toward judging the seam rather than excusing it.
     */
    const alwaysThrows = (stmt) => {
        if (ts.isThrowStatement(stmt)) return true;
        if (ts.isBlock(stmt)) return stmt.statements.some(alwaysThrows);
        if (ts.isIfStatement(stmt)) {
            return (
                !!stmt.elseStatement &&
                alwaysThrows(stmt.thenStatement) &&
                alwaysThrows(stmt.elseStatement)
            );
        }
        return false;
    };

    /**
     * Does this catch have a path that RECOVERS instead of propagating?
     *
     * A rethrow is only an excuse when the catch propagates on EVERY path: then
     * the failure reaches the caller and nothing is being degraded here. A
     * catch that rethrows on one branch and RETURNS a substitute on another is
     * two different seams sharing one block, and the recovery branch is a
     * degradation like any other — it must be loud or it is exactly the silent
     * data loss #4632 is about.
     *
     * Missing this cost a whole round: seed-loader's `writeRecoveringSummary`
     * recovers an `ERR_SUMMARY_RECOMPUTE` (the rows landed; re-writing would
     * duplicate) and rethrows everything else. Because the block contained a
     * `throw`, the old rule excused it wholesale — registering its callee in
     * `DURABILITY_CRITICAL_CALLEES` produced a ledger entry that could never
     * fire, i.e. protection that reads as real and enforces nothing (#4998).
     */
    const catchRecovers = (block) => {
        let sawReturn = false;
        walkSameTick(block, (child) => {
            if (ts.isReturnStatement(child)) sawReturn = true;
        });
        // A `return` is an explicit recovery: the caller gets a value, not the
        // failure. With no return, the catch still recovers by falling off the
        // end — unless one of its top-level statements always throws.
        return sawReturn || !block.statements.some(alwaysThrows);
    };

    /**
     * Collect the durability-critical calls a `catch` ACTUALLY guards.
     *
     * A call wrapped in a NESTED try whose own catch RECOVERS can never reach
     * the outer catch — the inner catch consumed it, and that inner catch is
     * judged on its own as a seam in its own right. Attributing the call to
     * every enclosing catch as well reported ONE seam once per level of
     * nesting, and the enclosing handlers it accused are usually generic
     * request-level error handlers that are correct as written. That pressures
     * an author to baseline correct code, which is how a shrink-only ledger
     * stops meaning anything (#4754: one `saveMetaItem` in `packages.ts`
     * surfaced three times — at its real seam and at the two route/function
     * level `catch`es enclosing it).
     *
     * Only an inner catch that propagates on EVERY path (see `catchRecovers`)
     * actually delivers the failure outward, and then the outer catch is a real
     * guard and is judged as one. Coverage is never lost either way: the
     * shadowing catch is itself checked.
     */
    const collectGuardedCalls = (tryBlock) => {
        const guarded = [];
        const inspect = (child) => {
            const name = calleeName(child);
            if (name && DURABILITY_CRITICAL_CALLEES.has(name)) {
                guarded.push({ callee: name, line: lineOf(child) });
            }
        };
        const walk = (n) => {
            n.forEachChild((child) => {
                if (runsLater(child)) return;
                if (
                    ts.isTryStatement(child) &&
                    child.catchClause &&
                    catchRecovers(child.catchClause.block)
                ) {
                    // The inner TRY block is shadowed. Its `catch`/`finally`
                    // bodies are not — a critical call there does propagate out.
                    for (const b of [child.catchClause.block, child.finallyBlock]) {
                        if (!b) continue;
                        inspect(b);
                        walk(b);
                    }
                    return;
                }
                inspect(child);
                walk(child);
            });
        };
        // The try block itself may BE a call at top level, so check it too.
        inspect(tryBlock);
        walk(tryBlock);
        return guarded;
    };

    walkAll(sf, (node) => {
        if (!ts.isTryStatement(node) || !node.catchClause) return;

        // 1. Does the guarded block call a durability-critical operation?
        const guarded = collectGuardedCalls(node.tryBlock);
        if (guarded.length === 0) return;

        // 2. How does the catch respond?
        const { levels, rethrows } = collectResponse(node.catchClause.block);
        // Only an UNCONDITIONAL rethrow excuses the seam — see catchRecovers().
        const propagatesAlways = rethrows && !catchRecovers(node.catchClause.block);

        const loud = levels.filter((l) => LOUD_LEVELS.has(l.level));
        const quiet = levels.filter((l) => QUIET_LEVELS.has(l.level));

        const seam = {
            file: relPath,
            callee: guarded[0].callee,
            calleeLine: guarded[0].line,
            catchLine: lineOf(node.catchClause),
            rethrows: propagatesAlways,
            partialRethrow: rethrows && !propagatesAlways,
            loud: loud.map((l) => `${l.level}@${l.line}${l.viaHelper ? ` via ${l.viaHelper}()` : ''}`),
            quiet: quiet.map((l) => `${l.level}@${l.line}${l.viaHelper ? ` via ${l.viaHelper}()` : ''}`),
        };
        seams.push(seam);

        if (propagatesAlways || loud.length > 0) return;

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
                : s.partialRethrow && s.loud.length > 0
                  ? `recovers on one branch, loud (${s.loud.join(', ')})`
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
            // #4998: a catch that RECOVERS on one branch and rethrows on the
            // other is two seams in one block. The rethrow covers the branch
            // that propagates; it says nothing about the branch that returns a
            // substitute value, and that branch is a degradation like any
            // other. Excusing the whole block on the presence of a `throw`
            // made a DURABILITY_CRITICAL_CALLEES entry for such a seam
            // unfireable — a ledger line that looks like protection and
            // enforces nothing.
            name: 'flags: catch that recovers on one branch (rethrowing on the other) and logs warn',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try { return await driver.syncSchema('t', obj); }
                    catch (e: any) {
                        if (e.code === 'RECOVERABLE') {
                            ctx.logger.warn('recovered; state may be stale');
                            return e.written;
                        }
                        throw e;
                    }
                } }`,
            expectViolation: true,
        },
        {
            name: 'passes: the same partial-recovery shape logging error',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try { return await driver.syncSchema('t', obj); }
                    catch (e: any) {
                        if (e.code === 'RECOVERABLE') {
                            ctx.logger.error('CONSEQUENCE: stale; FIX: re-run', e);
                            return e.written;
                        }
                        throw e;
                    }
                } }`,
            expectViolation: false,
        },
        {
            name: 'passes: catch that rethrows from inside a conditional and never recovers',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); }
                    catch (e: any) {
                        if (e.code === 'A') { throw e; } else { throw new Error('B'); }
                    }
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
        {
            // #4754: `rest-server.ts` reports through
            // `const logError = (...a) => console.error(...a)` — a same-file
            // helper the catch side is DOCUMENTED to follow. Its body is the
            // call expression itself, not a block containing one, and the
            // walker only ever visited CHILDREN, so the loudest site in the
            // file read as `silent-swallow`. A false positive here is not
            // cosmetic: the only ways to satisfy it are to baseline correct
            // code or to bolt on a redundant log.
            name: 'passes: catch delegating to a loud CONCISE-ARROW helper (expression body)',
            code: `
                const logError = (...args: unknown[]) => (globalThis as any).console?.error(...args);
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); } catch (e) { logError('DDL never ran', e); }
                } }`,
            expectViolation: false,
        },
        {
            name: 'flags: catch delegating to a QUIET concise-arrow helper (expression body)',
            code: `
                const note = (...args: unknown[]) => (globalThis as any).console?.warn(...args);
                class P { async f(driver: any, obj: any) {
                    try { await driver.syncSchema('t', obj); } catch (e) { note('failed', e); }
                } }`,
            expectViolation: true,
        },
        {
            // #4754: one `saveMetaItem` in `packages.ts` was reported THREE
            // times — at its real seam and again at each enclosing route- and
            // function-level catch, neither of which can ever observe it. The
            // enclosing handlers are correct as written, so every extra report
            // is pressure to baseline correct code.
            name: 'passes: enclosing catch is not accused when an inner RECOVERING catch already consumed the call',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try {
                        try { await driver.syncSchema('t', obj); }
                        catch (e) { ctx.logger.error('DDL never ran — not durable; fix X', e); }
                        return 'ok';
                    } catch (outer) { return 'failed'; }
                } }`,
            expectViolation: false,
            expectCount: 0,
        },
        {
            name: 'flags: the inner catch itself is still judged (no coverage lost to shadowing)',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try {
                        try { await driver.syncSchema('t', obj); }
                        catch (e) { ctx.logger.warn('oh well', e); }
                        return 'ok';
                    } catch (outer) { return 'failed'; }
                } }`,
            expectViolation: true,
            // Exactly one: the inner seam. The outer catch never sees it.
            expectCount: 1,
        },
        {
            name: 'flags: enclosing catch IS accused when the inner catch rethrows on every path',
            code: `
                class P { async f(ctx: any, driver: any, obj: any) {
                    try {
                        try { await driver.syncSchema('t', obj); }
                        catch (e) { throw e; }
                        return 'ok';
                    } catch (outer) { return 'failed'; }
                } }`,
            expectViolation: true,
            // Only the outer one: the inner catch propagates, so it is excused
            // and the failure genuinely arrives at the outer catch.
            expectCount: 1,
        },
        {
            name: 'flags: a critical call in an inner CATCH body still reaches the enclosing catch',
            code: `
                class P { async f(ctx: any, driver: any, obj: any, fallback: any) {
                    try {
                        try { await driver.initObjects(obj); }
                        catch (e) { ctx.logger.error('primary failed; retrying', e); await driver.syncSchema('t', fallback); }
                        return 'ok';
                    } catch (outer) { return 'failed'; }
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
        // `expectCount` pins HOW MANY seams a case reports, not just whether it
        // reports one. Nesting cases need it: "still flags" is satisfied both by
        // the correct single finding and by the duplicate-per-nesting-level bug
        // it replaced, so a boolean cannot tell those two apart (#4754).
        const countMismatch = c.expectCount !== undefined && findings.length !== c.expectCount;
        if (got !== c.expectViolation || countMismatch) {
            failures++;
            console.error(
                `  ✗ ${c.name}: expected violation=${c.expectViolation}` +
                    (c.expectCount !== undefined ? ` count=${c.expectCount}` : '') +
                    `, got violation=${got} count=${findings.length}`,
            );
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
