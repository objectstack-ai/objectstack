#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * measure-return-propagating-durability-seams -- the #16233 CENSUS instrument.
 *
 *   node scripts/measure-return-propagating-durability-seams.mjs             # census
 *   node scripts/measure-return-propagating-durability-seams.mjs --sites     # every member
 *   node scripts/measure-return-propagating-durability-seams.mjs --json      # machine
 *   node scripts/measure-return-propagating-durability-seams.mjs --self-test # every control family
 *
 * ## The question, and why an integer answers it
 *
 * `check-durability-degradation-log-level.mjs` accepts three answers from a
 * `catch` guarding a durability-critical operation: rethrow, log at `error`, or
 * HAND THE FAILURE TO THE CALLER through its declared propagation vocabulary.
 * That third answer is spelled in two maps, and BOTH are keyed on the NAME of a
 * callee the catch reaches -- `FAILURE_PROPAGATION_CALLEES` repo-wide,
 * `FAILURE_PROPAGATION_SITES` scoped to one `<file>::<function>`.
 *
 * A catch that hands the failure back by RETURNING AN OUT-PARAM OBJECT has no
 * callee to name. `return { ok: false, error: err }` calls nothing; the
 * delivery IS the constructed value. So that seam is not "missing an entry" --
 * it is unrepresentable in the vocabulary as the vocabulary is shaped, and the
 * only ways to green such a site are to baseline correct code or to bolt on a
 * `logger.error` the file's own header calls "the mirror-image failure".
 *
 * That is a statement about the checker's expressiveness, and it is TRUE
 * whether the population is one seam or fifty. What it is not, on its own, is a
 * reason to change anything: a gap with one member is a note, a gap with thirty
 * is a hole. This file exists so the choice between the candidate repairs is
 * made against a NUMBER rather than an impression -- and so the number can be
 * re-taken later instead of being quoted from a report that has gone stale.
 *
 * THIS IS NOT A GATE. It exits 0 on any membership count, prints "a
 * MEASUREMENT, not a gate" on every run, and is deliberately not named
 * `check:*` or `gen:*` -- the shape `measure-durability-swallow-family.mjs`
 * established. The only non-zero exits are a `--self-test` failing its declared
 * controls, an unreadable vocabulary (REFUSED, exit 2) and `ts-parse`'s
 * EXIT_UNPARSEABLE.
 *
 * ## The membership rule, in four parts
 *
 * A `try`/`catch` is a MEMBER when all four hold:
 *
 *   1. DURABLE -- the `try` calls, same-tick, an operation declared to claim
 *      persistence (see "The durability axis" below). Nested function bodies in
 *      the `try` are not descended into: a callback registered there runs later
 *      and is not guarded by that catch. Same choice, same reason, as the gate.
 *   2. RETURN-DELIVERED -- EVERY path out of the `catch` ends in a `return`
 *      whose value is an object CONSTRUCTED IN THE CATCH (an object literal, or
 *      a catch-local `const` bound to one) that NAMES THE FAILURE. No path falls
 *      off the end, no path returns a normal value. The path analysis mirrors
 *      the gate's own `catchDeliversFailure()` and reports "cannot prove" as
 *      "does not deliver", so an unmodelled shape is DROPPED from the census
 *      rather than counted into it -- this instrument's declared direction of
 *      error is to UNDER-count.
 *   3. NAMES THE FAILURE -- the returned object either references the catch's
 *      error binding in some property (directly, or one hop through a
 *      catch-local `const`), or carries an explicit failure discriminator
 *      (`ok: false`, `success: false`, `status: 'failed'`, `kind: 'unavailable'`
 *      …). An object that mentions the failure NOWHERE is a swallow, not a
 *      propagation, and belongs to #12981's census, not this one.
 *   4. NOT ALREADY EXPRESSIBLE -- the catch does not rethrow, does not log at
 *      `error`/`fatal`, reaches no `FAILURE_PROPAGATION_CALLEES` name, and its
 *      `<file>::<function>` is not a `FAILURE_PROPAGATION_SITES` key. Any one of
 *      those and the gate can already say what the seam does; the gap does not
 *      bite there, whatever else the catch returns.
 *
 * Part 4 is why the headline count is not simply "every catch that returns a
 * failure object". A seam that returns one AND logs `error` is reported
 * separately, as ADJACENT: it proves the shape exists at a gate-visible site
 * without being a seam the gate cannot express.
 *
 * ## The durability axis -- declared, never spelled
 *
 * "Is this call a claim to persist?" is the same semantic question the gate
 * refuses to answer by heuristic, and a `/save|write|persist/` matcher is no
 * more acceptable here. So the axis is three DECLARED vocabularies, and two of
 * them are read out of their own source files at run time rather than copied:
 *
 *   - `DURABILITY_CRITICAL_CALLEES`, read from the gate. A member here is a
 *     seam the gate SEES TODAY.
 *   - `WRITE_SHAPED_CALLEES`, read from `measure-durability-swallow-family.mjs`
 *     (#12981's widened write vocabulary, already reviewed in tree). A member
 *     here becomes gate-visible the day its callee is declared.
 *   - `READ_ON_THE_MERITS` below -- operations this card read and judged, each
 *     carrying WHY it claims persistence. Nothing is admitted by spelling.
 *
 * Reading the first two rather than copying them means this census cannot go
 * stale against the gate; it also means a vocabulary this file cannot PARSE is
 * a refusal, never a shorter list (the shape `readGateVocabulary` established).
 *
 * The opposite direction is `NOT_A_DURABILITY_CLAIM`: sites that match the
 * SHAPE over a declared write name but whose guarded call does not claim to
 * persist anything (building a driver, a connectivity probe). They are listed,
 * with the reading, and excluded from the count -- an exclusion that is read
 * rather than a filter that is silent.
 *
 * ## Both registers are staleness-checked
 *
 * A `READ_ON_THE_MERITS` entry that matches no `try` in the tree, and a
 * `NOT_A_DURABILITY_CLAIM` row whose site is gone, both fail `--self-test`. A
 * declaration that excuses or admits nothing is a licence waiting for the next
 * catch that lands on that name -- the gate says this about its own vocabulary
 * and it is no less true here.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { requireDefaultExport } from './import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);
import { parseSourceFile } from './ts-parse.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_ROOT = join(ROOT, 'packages');

const GATE_SCRIPT = 'scripts/check-durability-degradation-log-level.mjs';
const SWALLOW_CENSUS_SCRIPT = 'scripts/measure-durability-swallow-family.mjs';

const GATE_DURABILITY_IDENT = 'DURABILITY_CRITICAL_CALLEES';
const GATE_PROPAGATION_CALLEES_IDENT = 'FAILURE_PROPAGATION_CALLEES';
const GATE_PROPAGATION_SITES_IDENT = 'FAILURE_PROPAGATION_SITES';
const SWALLOW_WRITE_IDENT = 'WRITE_SHAPED_CALLEES';

const MEASUREMENT_BANNER =
    'return-propagating durability-seam census (#16233) — a MEASUREMENT, not a gate';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.turbo', 'coverage', '.cache']);
const LOGGER_RECEIVERS = /^(logger|log|console)$/i;
const LOUD_LEVELS = new Set(['error', 'fatal']);

const EXIT_REFUSED = 2;

/**
 * Operations outside both declared vocabularies that THIS card read and judged
 * to claim persistence. Each entry names the claim, because the note is what a
 * later reader audits -- a bare name here would be the spelling heuristic in
 * a costume.
 *
 * Every one of these is additionally narrowed by membership part 2: a name on
 * this list only ever contributes a member when the catch guarding it also
 * delivers by a constructed return. `transaction` would be far too generic as a
 * standalone write vocabulary; as "a transaction whose failure is handed back
 * as an object" it names two seams, both read below.
 */
const READ_ON_THE_MERITS = new Map([
    [
        'claimSuspension',
        'ADR-0019 suspended-run store: the call CONSUMES the persisted suspension row. A failure '
        + 'leaves persisted state and runtime state disagreeing — the #4420 family exactly — and the '
        + "catch's own comment already declares it answers the caller instead of logging.",
    ],
    [
        'transaction',
        'The driver/engine transaction whose body performs the write. Failure means the statements '
        + 'inside it did not commit, while the enclosing pass reports through its returned envelope.',
    ],
    [
        'inTxn',
        "metadata-protocol's spelling of the same thing: the bound transaction wrapper that publishes "
        + 'draft promotions. Failure means no draft was promoted.',
    ],
    [
        'insertMembership',
        'Writes a `sys_member` row. A refused write leaves the user bound to no organization while the '
        + 'sign-up path reports success.',
    ],
    [
        'exec',
        "The partial-index probe's DDL executor: the guarded statement is a CREATE INDEX. Same class as "
        + '`syncSchema` — the index does not exist yet the object stays registered and served.',
    ],
    [
        'execute',
        'Raw statement execution against a driver (`objectql.execute`, the Turso client). The guarded '
        + 'statements are DELETEs and backfill UPDATEs, not reads.',
    ],
    [
        'runBatchedUpdate',
        "The Turso canonical backfill's UPDATE loop. A failure leaves the column un-canonicalised while "
        + 'the column report is what carries the reason.',
    ],
]);

/**
 * Sites that match the SHAPE over a declared write name and are NOT durability
 * seams, read one by one. Keyed `<file>::<enclosing function>` — the same
 * granularity, and for the same reason, as `FAILURE_PROPAGATION_SITES`.
 */
const NOT_A_DURABILITY_CLAIM = new Map([
    [
        'packages/services/service-datasource/src/datasource-admin-plugin.ts::probe',
        '`factory.create(...)` BUILDS a driver instance; nothing is persisted by it. The matched name '
        + "is `create`, which in #12981's driver-contract row means a row insert.",
    ],
    [
        'packages/services/service-storage/src/storage-service-plugin.ts::start',
        'A connectivity PROBE (the `storage/test` settings action): it uploads, reads back and deletes '
        + 'its own throwaway object. The matched `delete` is the probe cleaning up after itself, and the '
        + 'returned `{ ok: false }` IS the probe verdict the operator asked for.',
    ],
    [
        'packages/mcp/src/mcp-server-runtime.ts::registerToolFromDefinition',
        '`toolRegistry.execute(...)` runs an MCP TOOL CALL. The matched `execute` is declared below for '
        + 'raw statement execution against a driver; a tool invocation persists nothing by itself, and '
        + 'the returned `content` is the MCP protocol answer.',
    ],
    [
        'packages/metadata-protocol/src/migrations/read-probe.ts::readTablePresence',
        'The guarded `exec(catalogSql)` is a catalog SELECT — a READ, and the module header calls the '
        + 'returned `{ verdict: \'unreadable\' }` its fence. Same delivery shape, no claim to persist; '
        + "read-side invention is the OTHER rule's subject, not this census's.",
    ],
]);
/* ------------------------------------------------------------------------- *
 *  Vocabulary readers — announce a refusal, never a shorter list
 * ------------------------------------------------------------------------- */

function scriptKindFor(file) {
    return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function walkAll(node, visit) {
    visit(node);
    node.forEachChild((child) => walkAll(child, visit));
}

function parseRepoFile(rel) {
    const abs = join(ROOT, rel);
    return parseSourceFile(abs, readFileSync(abs, 'utf8'), ts.ScriptKind.JS);
}

/**
 * The keys of a `const NAME = new Map([[key, …], …])` declaration, in source
 * order. Returns `null` — never `[]` — when the declaration cannot be read in
 * the shape this reader understands, so a parse the reader does not model
 * cannot degrade into a comparison against a vocabulary nobody read.
 */
function readMapKeys(sf, ident) {
    let names = null;
    walkAll(sf, (node) => {
        if (names !== null || !ts.isVariableDeclaration(node)) return;
        if (!ts.isIdentifier(node.name) || node.name.text !== ident) return;
        const init = node.initializer;
        if (!init || !ts.isNewExpression(init) || init.arguments?.length !== 1) return;
        const [entries] = init.arguments;
        if (!ts.isArrayLiteralExpression(entries)) return;
        const collected = [];
        for (const entry of entries.elements) {
            if (!ts.isArrayLiteralExpression(entry) || entry.elements.length === 0) return;
            const [key] = entry.elements;
            if (!ts.isStringLiteralLike(key)) return;
            collected.push(key.text);
        }
        names = collected;
    });
    return names;
}

function readVocabularies() {
    const gate = parseRepoFile(GATE_SCRIPT);
    const swallow = parseRepoFile(SWALLOW_CENSUS_SCRIPT);
    const durability = readMapKeys(gate, GATE_DURABILITY_IDENT);
    const propagationCallees = readMapKeys(gate, GATE_PROPAGATION_CALLEES_IDENT);
    const propagationSites = readMapKeys(gate, GATE_PROPAGATION_SITES_IDENT);
    const writeShaped = readMapKeys(swallow, SWALLOW_WRITE_IDENT);
    const unreadable = [];
    if (!durability) unreadable.push(`${GATE_DURABILITY_IDENT} in ${GATE_SCRIPT}`);
    if (!propagationCallees) unreadable.push(`${GATE_PROPAGATION_CALLEES_IDENT} in ${GATE_SCRIPT}`);
    if (!propagationSites) unreadable.push(`${GATE_PROPAGATION_SITES_IDENT} in ${GATE_SCRIPT}`);
    if (!writeShaped) unreadable.push(`${SWALLOW_WRITE_IDENT} in ${SWALLOW_CENSUS_SCRIPT}`);
    if (unreadable.length > 0) return { unreadable };
    return {
        unreadable: [],
        durability: new Set(durability),
        propagationCallees: new Set(propagationCallees),
        propagationSites: new Set(propagationSites),
        writeShaped: new Set(writeShaped),
    };
}

/* ------------------------------------------------------------------------- *
 *  AST helpers
 * ------------------------------------------------------------------------- */

function collectSourceFiles(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            collectSourceFiles(full, out);
            continue;
        }
        if (!entry.isFile()) continue;
        if (!/\.(ts|mts|cts|tsx)$/.test(entry.name)) continue;
        if (/\.(test|spec)\.(ts|mts|cts|tsx)$/.test(entry.name)) continue;
        if (/\.d\.(ts|mts|cts)$/.test(entry.name)) continue;
        out.push(full);
    }
    return out;
}

const RUNS_LATER = (n) =>
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isClassDeclaration(n) ||
    ts.isClassExpression(n);

/** Walk `node`'s subtree, stopping at bodies that run on a LATER tick. */
function walkSameTick(node, visit) {
    node.forEachChild(function step(child) {
        visit(child);
        if (RUNS_LATER(child)) return;
        child.forEachChild(step);
    });
}

/** The last segment of a call's callee: `a.b?.c(…)` -> `c`; null when unreadable. */
function calleeName(expr) {
    let cursor = expr;
    for (;;) {
        if (ts.isParenthesizedExpression(cursor) || ts.isNonNullExpression(cursor)) {
            cursor = cursor.expression;
            continue;
        }
        break;
    }
    if (ts.isIdentifier(cursor)) return cursor.text;
    if (ts.isPropertyAccessExpression(cursor) && ts.isIdentifier(cursor.name)) return cursor.name.text;
    return null;
}

/** The innermost NAMED function-like ancestor — the register key's second half. */
function enclosingFunctionName(node) {
    for (let n = node.parent; n; n = n.parent) {
        if (ts.isFunctionDeclaration(n) && n.name) return n.name.text;
        if (ts.isMethodDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
        if (
            (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
            n.parent &&
            ts.isVariableDeclaration(n.parent) &&
            ts.isIdentifier(n.parent.name)
        ) {
            return n.parent.name.text;
        }
        if (
            (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) &&
            n.parent &&
            ts.isPropertyAssignment(n.parent) &&
            ts.isIdentifier(n.parent.name)
        ) {
            return n.parent.name.text;
        }
        if (ts.isFunctionExpression(n) && n.name) return n.name.text;
        if (ts.isMethodDeclaration(n) && ts.isStringLiteralLike(n.name)) return n.name.text;
    }
    return undefined;
}

const FALSE_FLAGS = new Set([
    'ok', 'success', 'succeeded', 'persisted', 'written', 'durable', 'saved', 'applied', 'delivered',
]);
const FAILURE_WORDS = new Set([
    'failed', 'failure', 'error', 'errored', 'rejected', 'refused', 'unavailable', 'lost', 'aborted',
]);

/** Does `node` mention the catch's error binding, one hop through a catch-local const? */
function mentionsCaught(node, errNames, catchLocals) {
    let hit = false;
    walkAll(node, (n) => {
        if (hit || !ts.isIdentifier(n)) return;
        if (errNames.has(n.text)) hit = true;
        else if (catchLocals.has(n.text)) hit = true;
    });
    return hit;
}

/**
 * Does this object literal NAME the failure? Returns the human-readable
 * evidence, or `null` — an object that mentions the failure nowhere is a
 * swallow and belongs to #12981's census, not this one.
 */
function failureEvidence(obj, errNames, catchLocals) {
    const evidence = [];
    for (const prop of obj.properties) {
        if (ts.isSpreadAssignment(prop)) continue;
        const nameNode = prop.name;
        const name =
            nameNode && (ts.isIdentifier(nameNode) || ts.isStringLiteralLike(nameNode))
                ? nameNode.text
                : null;
        if (!name) continue;
        const init = ts.isPropertyAssignment(prop)
            ? prop.initializer
            : ts.isShorthandPropertyAssignment(prop)
              ? prop.name
              : null;
        if (!init) continue;
        if (FALSE_FLAGS.has(name) && init.kind === ts.SyntaxKind.FalseKeyword) {
            evidence.push(`${name}: false`);
            continue;
        }
        if (ts.isStringLiteralLike(init) && FAILURE_WORDS.has(init.text)) {
            evidence.push(`${name}: '${init.text}'`);
            continue;
        }
        if (mentionsCaught(init, errNames, catchLocals)) evidence.push(`${name}: <caught>`);
    }
    return evidence.length > 0 ? evidence.join(', ') : null;
}

/** Catch-local `const`s whose initializer mentions the caught error. */
function catchLocalsFromError(catchBlock, errNames) {
    const locals = new Set();
    let grew = true;
    while (grew) {
        grew = false;
        walkSameTick(catchBlock, (n) => {
            if (!ts.isVariableDeclaration(n) || !ts.isIdentifier(n.name) || !n.initializer) return;
            if (locals.has(n.name.text)) return;
            let mentions = false;
            walkAll(n.initializer, (x) => {
                if (!mentions && ts.isIdentifier(x) && (errNames.has(x.text) || locals.has(x.text))) {
                    mentions = true;
                }
            });
            if (mentions) {
                locals.add(n.name.text);
                grew = true;
            }
        });
    }
    return locals;
}

/** The object literal a returned expression resolves to, following a catch-local binding. */
function resolveReturnedObject(expr, catchBlock) {
    let e = expr;
    while (
        e &&
        (ts.isParenthesizedExpression(e) ||
            ts.isAsExpression(e) ||
            ts.isSatisfiesExpression(e) ||
            ts.isNonNullExpression(e) ||
            ts.isAwaitExpression(e))
    ) {
        e = e.expression;
    }
    if (!e) return null;
    if (ts.isObjectLiteralExpression(e)) return e;
    if (ts.isIdentifier(e)) {
        let found = null;
        walkSameTick(catchBlock, (n) => {
            if (found) return;
            if (
                ts.isVariableDeclaration(n) &&
                ts.isIdentifier(n.name) &&
                n.name.text === e.text &&
                n.initializer &&
                ts.isObjectLiteralExpression(n.initializer)
            ) {
                found = n.initializer;
            }
        });
        return found;
    }
    return null;
}

/**
 * Does EVERY path out of this `catch` return a constructed failure object?
 *
 * Mirrors the gate's `catchDeliversFailure()` — sequence, block, `if`/`else`,
 * `throw`, `return`, `break`/`continue`, and a conservative fallback that can
 * only carry a delivery FORWARD, never invent one. "Cannot prove" reads as
 * "does not deliver", which DROPS the seam from the census: this instrument's
 * declared direction of error is to under-count, and a member it names must be
 * one a reader can confirm.
 */
function catchReturnsFailureObject(block, errNames, catchLocals) {
    const carried = [];
    let sawThrow = false;

    const deliversAt = (stmt) => {
        if (!ts.isReturnStatement(stmt) || !stmt.expression) return false;
        const obj = resolveReturnedObject(stmt.expression, block);
        if (!obj) return false;
        const evidence = failureEvidence(obj, errNames, catchLocals);
        if (!evidence) return false;
        carried.push({ evidence, node: obj });
        return true;
    };

    const analyzeList = (statements, deliveredIn) => {
        let delivered = deliveredIn;
        let escaped = false;
        for (const stmt of statements) {
            const r = analyzeStmt(stmt, delivered);
            escaped = escaped || r.escaped;
            delivered = r.delivered;
            if (r.terminates) return { delivered: true, escaped, terminates: true };
        }
        return { delivered, escaped, terminates: false };
    };

    const analyzeStmt = (stmt, delivered) => {
        if (ts.isThrowStatement(stmt)) {
            sawThrow = true;
            return { delivered: true, escaped: false, terminates: true };
        }
        if (ts.isReturnStatement(stmt)) {
            return { delivered: true, escaped: !deliversAt(stmt), terminates: true };
        }
        if (ts.isBreakStatement(stmt) || ts.isContinueStatement(stmt)) {
            return { delivered: true, escaped: true, terminates: true };
        }
        if (ts.isBlock(stmt)) return analyzeList(stmt.statements, delivered);
        if (ts.isIfStatement(stmt)) {
            const t = analyzeStmt(stmt.thenStatement, delivered);
            const e = stmt.elseStatement
                ? analyzeStmt(stmt.elseStatement, delivered)
                : { delivered, escaped: false, terminates: false };
            const terminates = t.terminates && e.terminates;
            return { delivered: terminates, escaped: t.escaped || e.escaped, terminates };
        }
        if (ts.isExpressionStatement(stmt) || ts.isVariableStatement(stmt)) {
            return { delivered, escaped: false, terminates: false };
        }
        let escaped = false;
        walkSameTick(stmt, (child) => {
            if (ts.isReturnStatement(child)) {
                if (!deliversAt(child)) escaped = true;
            } else if (ts.isBreakStatement(child) || ts.isContinueStatement(child)) {
                escaped = true;
            }
        });
        return { delivered, escaped, terminates: false };
    };

    const r = analyzeList(block.statements, false);
    if (!r.terminates || r.escaped || carried.length === 0) return null;
    return { carried, sawThrow };
}

/** Log levels the catch reaches on a receiver this checker reads as a logger. */
function loggedLevels(block) {
    const levels = [];
    walkSameTick(block, (node) => {
        if (!ts.isCallExpression(node)) return;
        const callee = node.expression;
        if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.name)) return;
        let receiver = callee.expression;
        while (ts.isParenthesizedExpression(receiver) || ts.isNonNullExpression(receiver)) {
            receiver = receiver.expression;
        }
        const receiverName = ts.isIdentifier(receiver)
            ? receiver.text
            : ts.isPropertyAccessExpression(receiver) && ts.isIdentifier(receiver.name)
              ? receiver.name.text
              : null;
        if (receiverName && LOGGER_RECEIVERS.test(receiverName)) levels.push(callee.name.text);
    });
    return levels;
}

/* ------------------------------------------------------------------------- *
 *  The scan
 * ------------------------------------------------------------------------- */

function scan(vocab) {
    const files = collectSourceFiles(SCAN_ROOT);
    const stats = { files: files.length, tries: 0, durable: 0, returnDelivered: 0 };
    const members = [];
    const adjacent = [];
    const excluded = [];
    const meritHits = new Set();

    for (const file of files) {
        const rel = relative(ROOT, file).split('\\').join('/');
        const sf = parseSourceFile(file, readFileSync(file, 'utf8'), scriptKindFor(file));
        walkAll(sf, (node) => {
            if (!ts.isTryStatement(node) || !node.catchClause) return;
            stats.tries += 1;

            const guarded = [];
            walkSameTick(node.tryBlock, (child) => {
                if (!ts.isCallExpression(child)) return;
                const name = calleeName(child.expression);
                if (!name) return;
                const tier =
                    vocab.durability.has(name) ? 'gate-vocabulary'
                    : vocab.writeShaped.has(name) ? 'write-shaped'
                    : READ_ON_THE_MERITS.has(name) ? 'read-on-the-merits'
                    : null;
                if (!tier) return;
                guarded.push({
                    name,
                    tier,
                    line: sf.getLineAndCharacterOfPosition(child.getStart(sf)).line + 1,
                });
            });
            if (guarded.length === 0) return;
            stats.durable += 1;

            const catchClause = node.catchClause;
            const errNames = new Set();
            const decl = catchClause.variableDeclaration;
            if (decl && ts.isIdentifier(decl.name)) errNames.add(decl.name.text);
            const catchLocals = catchLocalsFromError(catchClause.block, errNames);

            const delivery = catchReturnsFailureObject(catchClause.block, errNames, catchLocals);
            if (!delivery) return;
            stats.returnDelivered += 1;

            const fn = enclosingFunctionName(catchClause);
            const siteKey = fn ? `${rel}::${fn}` : `${rel}::<anonymous>`;
            const levels = loggedLevels(catchClause.block);
            const propagationHits = [];
            walkSameTick(catchClause.block, (child) => {
                if (!ts.isCallExpression(child)) return;
                const name = calleeName(child.expression);
                if (name && vocab.propagationCallees.has(name)) propagationHits.push(name);
            });

            const record = {
                site: siteKey,
                file: rel,
                line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
                guarded: guarded.map((g) => `${g.name}@${g.line}`),
                tier:
                    guarded.some((g) => g.tier === 'gate-vocabulary') ? 'gate-vocabulary'
                    : guarded.some((g) => g.tier === 'write-shaped') ? 'write-shaped'
                    : 'read-on-the-merits',
                carries: delivery.carried.map((c) => c.evidence),
                levels,
            };

            if (NOT_A_DURABILITY_CLAIM.has(siteKey)) {
                excluded.push({ ...record, why: NOT_A_DURABILITY_CLAIM.get(siteKey) });
                return;
            }
            for (const g of guarded) if (g.tier === 'read-on-the-merits') meritHits.add(g.name);

            const alreadyExpressible =
                delivery.sawThrow ||
                levels.some((l) => LOUD_LEVELS.has(l.replace(/\?$/, ''))) ||
                propagationHits.length > 0 ||
                vocab.propagationSites.has(siteKey);

            if (alreadyExpressible) {
                adjacent.push({
                    ...record,
                    reason:
                        delivery.sawThrow ? 'rethrows on a path'
                        : propagationHits.length > 0 ? `reaches ${propagationHits[0]}()`
                        : vocab.propagationSites.has(siteKey) ? 'declared in FAILURE_PROPAGATION_SITES'
                        : `logs ${levels.filter((l) => LOUD_LEVELS.has(l.replace(/\?$/, ''))).join('/')}`,
                });
                return;
            }
            members.push(record);
        });
    }

    members.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    adjacent.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    excluded.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
    return { stats, members, adjacent, excluded, meritHits };
}

function tierCounts(rows) {
    const out = new Map([
        ['gate-vocabulary', 0],
        ['write-shaped', 0],
        ['read-on-the-merits', 0],
    ]);
    for (const r of rows) out.set(r.tier, (out.get(r.tier) ?? 0) + 1);
    return out;
}

function report({ sites = false, json = false } = {}) {
    const vocab = readVocabularies();
    if (vocab.unreadable.length > 0) {
        console.error(`\nREFUSED — a declared vocabulary could not be read:\n`);
        for (const u of vocab.unreadable) console.error(`  ${u}`);
        console.error(
            '\nNothing was measured. A vocabulary this reader cannot PARSE must never degrade to a\n'
            + 'shorter list — that would score the tree against a vocabulary nobody read.\n',
        );
        return EXIT_REFUSED;
    }

    const result = scan(vocab);
    if (json) {
        console.log(JSON.stringify(
            {
                banner: MEASUREMENT_BANNER,
                stats: result.stats,
                members: result.members,
                adjacent: result.adjacent,
                excluded: result.excluded,
            },
            null,
            2,
        ));
        return 0;
    }

    const tiers = tierCounts(result.members);
    console.log(`\n${MEASUREMENT_BANNER}\n`);
    console.log(`  scanned                        ${result.stats.files} non-test source file(s) under packages/`);
    console.log(`  try/catch statements           ${result.stats.tries}`);
    console.log(`  ...guarding a declared durable call  ${result.stats.durable}`);
    console.log(`  ...whose catch returns a constructed failure object on EVERY path  ${result.stats.returnDelivered}`);
    console.log('');
    console.log(`  MEMBERS — the gap's live population           ${result.members.length} site(s)`);
    console.log('    a durability failure handed to the caller as a RETURNED OBJECT, which neither');
    console.log('    FAILURE_PROPAGATION_CALLEES nor FAILURE_PROPAGATION_SITES can name:');
    console.log(`      [1] the gate SEES this seam today          ${tiers.get('gate-vocabulary')} site(s)`);
    console.log(`      [2] write-shaped (#12981 vocabulary)       ${tiers.get('write-shaped')} site(s)`);
    console.log(`      [3] durable, read on the merits here       ${tiers.get('read-on-the-merits')} site(s)`);
    console.log('');
    console.log(`  ADJACENT, not members                         ${result.adjacent.length} site(s)`);
    console.log('    the same returned-object delivery at a catch the gate can ALREADY express');
    console.log('    (it rethrows, logs `error`, or reaches a declared propagation callee)');
    console.log('');
    console.log(`  EXCLUDED by reading                           ${result.excluded.length} site(s)`);
    console.log('    matched the shape over a declared write name, but the guarded call claims');
    console.log('    no persistence — see `NOT_A_DURABILITY_CLAIM`');

    if (sites) {
        console.log('\n  MEMBERS:');
        for (const m of result.members) {
            console.log(`    ${m.file}:${m.line}  [${m.tier}]  guards ${m.guarded.join(', ')}`);
            console.log(`        ${m.site}`);
            console.log(`        returns → ${m.carries.join('  |  ')}`);
            if (m.levels.length > 0) console.log(`        also logs: ${m.levels.join(', ')}`);
        }
        console.log('\n  ADJACENT:');
        for (const a of result.adjacent) {
            console.log(`    ${a.file}:${a.line}  [${a.tier}]  guards ${a.guarded.join(', ')} — ${a.reason}`);
        }
        console.log('\n  EXCLUDED:');
        for (const x of result.excluded) {
            console.log(`    ${x.file}:${x.line}  guards ${x.guarded.join(', ')}`);
            console.log(`        ${x.why}`);
        }
    } else {
        console.log('\n  MEMBERS, by file:');
        const byFile = new Map();
        for (const m of result.members) byFile.set(m.file, (byFile.get(m.file) ?? 0) + 1);
        for (const [file, n] of [...byFile].sort()) console.log(`    ${n}×  ${file}`);
        console.log('\n  (--sites for every member, its tier and the evidence it returns)');
    }

    console.log(
        '\n  ⚠️  A green from check-durability-degradation-log-level.mjs over any MEMBER above\n'
        + '      means NOT MEASURED for that site: the gate reaches tier [1] only, and even there\n'
        + '      it is the log — never the returned object — that its verdict rests on.\n',
    );
    return 0;
}

/* ------------------------------------------------------------------------- *
 *  Self-test — the registers, and the membership rule's own direction
 * ------------------------------------------------------------------------- */

const SELF_TEST_FIXTURES = [
    {
        name: 'a returned failure object over a declared write is a MEMBER',
        source: `
            async function save(row: Row) {
                try {
                    await tryInsert(row);
                    return { ok: true };
                } catch (err) {
                    return { ok: false, error: (err as Error).message };
                }
            }
        `,
        expect: 'member',
    },
    {
        name: 'a loud catch that ALSO returns the object is ADJACENT, never a member',
        source: `
            async function save(row: Row) {
                try {
                    await tryInsert(row);
                    return { ok: true };
                } catch (err) {
                    logger.error('insert failed', err);
                    return { ok: false, error: (err as Error).message };
                }
            }
        `,
        expect: 'adjacent',
    },
    {
        name: 'a rethrowing catch is ADJACENT — rethrow IS delivery for the gate',
        source: `
            async function save(row: Row) {
                try {
                    await tryInsert(row);
                    return { ok: true };
                } catch (err) {
                    throw err;
                }
            }
        `,
        expect: 'none',
    },
    {
        name: 'an object that names the failure NOWHERE is a swallow, not a propagation',
        source: `
            async function save(row: Row) {
                try {
                    await tryInsert(row);
                    return { ok: true };
                } catch {
                    return { ok: true };
                }
            }
        `,
        expect: 'none',
    },
    {
        name: 'one path escaping without the object drops the seam (under-count, by design)',
        source: `
            async function save(row: Row, retry: boolean) {
                try {
                    await tryInsert(row);
                    return { ok: true };
                } catch (err) {
                    if (retry) return { ok: true };
                    return { ok: false, error: err };
                }
            }
        `,
        expect: 'none',
    },
    {
        name: 'a catch with no durable call in its try is not a seam at all',
        source: `
            function parse(text: string) {
                try {
                    return { ok: true, value: JSON.parse(text) };
                } catch (err) {
                    return { ok: false, error: (err as Error).message };
                }
            }
        `,
        expect: 'none',
    },
    {
        name: 'a delivery inside a callback registered by the catch does not answer THIS failure',
        source: `
            async function save(row: Row) {
                try {
                    await tryInsert(row);
                    return { ok: true };
                } catch (err) {
                    queue.push(() => ({ ok: false, error: err }));
                }
            }
        `,
        expect: 'none',
    },
];

function classifyFixture(source, vocab) {
    const sf = parseSourceFile('fixture.ts', source, ts.ScriptKind.TS);
    let verdict = 'none';
    walkAll(sf, (node) => {
        if (verdict !== 'none' || !ts.isTryStatement(node) || !node.catchClause) return;
        const guarded = [];
        walkSameTick(node.tryBlock, (child) => {
            if (!ts.isCallExpression(child)) return;
            const name = calleeName(child.expression);
            if (!name) return;
            if (vocab.durability.has(name) || vocab.writeShaped.has(name) || READ_ON_THE_MERITS.has(name)) {
                guarded.push(name);
            }
        });
        if (guarded.length === 0) return;
        const errNames = new Set();
        const decl = node.catchClause.variableDeclaration;
        if (decl && ts.isIdentifier(decl.name)) errNames.add(decl.name.text);
        const catchLocals = catchLocalsFromError(node.catchClause.block, errNames);
        const delivery = catchReturnsFailureObject(node.catchClause.block, errNames, catchLocals);
        if (!delivery) return;
        const levels = loggedLevels(node.catchClause.block);
        verdict =
            delivery.sawThrow || levels.some((l) => LOUD_LEVELS.has(l.replace(/\?$/, '')))
                ? 'adjacent'
                : 'member';
    });
    return verdict;
}

function selfTest() {
    const problems = [];
    const vocab = readVocabularies();
    if (vocab.unreadable.length > 0) {
        for (const u of vocab.unreadable) problems.push(`vocabulary unreadable: ${u}`);
        for (const p of problems) console.error(`  ✗ ${p}`);
        return 1;
    }

    let passed = 0;
    for (const fixture of SELF_TEST_FIXTURES) {
        const got = classifyFixture(fixture.source, vocab);
        if (got === fixture.expect) passed += 1;
        else problems.push(`[fixture] ${fixture.name}: expected ${fixture.expect}, got ${got}`);
    }

    // The gate's third answer must still BE a name-keyed thing, or this whole
    // census is measuring a gap that has already been closed elsewhere.
    if (vocab.propagationCallees.size === 0) {
        problems.push(
            `[premise] ${GATE_PROPAGATION_CALLEES_IDENT} is empty — the gate's propagation vocabulary `
            + 'moved, and this census measures a shape that may no longer be the one it cannot name',
        );
    }

    const result = scan(vocab);

    // Register staleness, both directions — a declaration that admits or
    // excuses nothing is a licence waiting for the next catch to land on it.
    for (const name of READ_ON_THE_MERITS.keys()) {
        if (!result.meritHits.has(name)) {
            problems.push(
                `[stale] READ_ON_THE_MERITS declares '${name}' and it admits no seam in the tree — `
                + 'delete the entry, or say why the operation is still durable',
            );
        }
    }
    const excludedKeys = new Set(result.excluded.map((x) => x.site));
    for (const key of NOT_A_DURABILITY_CLAIM.keys()) {
        if (!excludedKeys.has(key)) {
            problems.push(
                `[stale] NOT_A_DURABILITY_CLAIM declares '${key}' and it excuses nothing — the site `
                + 'moved or stopped matching the shape; delete the row or re-read the site',
            );
        }
    }

    if (problems.length > 0) {
        console.error(`\n✗ measure-return-propagating-durability-seams --self-test: ${problems.length} problem(s)\n`);
        for (const p of problems) console.error(`  ${p}`);
        console.error('');
        return 1;
    }
    console.log(
        `✓ measure-return-propagating-durability-seams --self-test: ${passed} membership fixture(s), `
        + `${READ_ON_THE_MERITS.size} READ_ON_THE_MERITS entr(ies) and `
        + `${NOT_A_DURABILITY_CLAIM.size} NOT_A_DURABILITY_CLAIM row(s) all reached`,
    );
    return 0;
}

if (isEntrypoint(import.meta.url)) {
    const argv = process.argv.slice(2);
    const code =
        argv.includes('--self-test')
            ? selfTest()
            : report({ sites: argv.includes('--sites'), json: argv.includes('--json') });
    process.exit(code);
}
