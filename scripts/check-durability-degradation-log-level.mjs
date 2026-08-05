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
 * operation from the declared vocabulary below, the `catch` must do one of
 * three things:
 *
 *   - rethrow (the failure propagates — the loudest option), or
 *   - log at `error` (or `fatal`), or
 *   - hand the failure to the CALLER on every path — an error envelope, or a
 *     per-item outcome report — through the declared failure-propagation
 *     vocabulary (#5241, see `FAILURE_PROPAGATION_CALLEES` below).
 *
 * A `catch` that logs `warn`/`info`/`debug`, or swallows silently, is a
 * violation: the write did not happen, and nothing above will ever hear so.
 *
 * The third answer is not a loophole and is not "reviewed exception" —
 * the NAME is declared here and the STRUCTURE is proved by the checker. It
 * exists because the rule's own judgment question ("does the system still look
 * normal from the outside?") answers NO when the caller was told, and because
 * without it the only ways to satisfy the gate at such a site were to baseline
 * correct code or to bolt on a `logger.error` that fires on every rejected
 * request — the mirror-image failure AGENTS.md names.
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
        'persistAuditTrailRow',
        'The compliance audit row was never written — the audited write itself succeeded and returned 200, so the API, the data and every counter read clean, while the `sys_audit_log` entry that records WHO did it is simply absent and nothing retries it. The gap surfaces, if ever, to an auditor who cannot connect it back to the write (#5226, the #4420 shape on the compliance ledger).',
    ],
    [
        'deleteMetaItemFromLoader',
        'The metadata definition was never deleted from the authoritative store — `unregister()` still resolves and still announces `deleted`, the in-memory registry entry is gone, and the surviving row is read straight back out of storage by the very next `list()`/`get()`, so the "deleted" item reappears and survives every restart. Nothing retries it (#5259).',
    ],
]);

/**
 * Declared FAILURE-PROPAGATION vocabulary (#5241).
 *
 * ## The blind spot this closes
 *
 * The rule above has three legal answers, not two. A `catch` may rethrow, or
 * log loudly — or it may **hand the failure to the caller**, which is the
 * loudest answer of all: the caller is told, in its own response, that the
 * write did not land. AGENTS.md's judgment question ("does the system still
 * look normal from the outside while something it claims is persisted has not
 * landed?") answers NO for that shape, so it is not a degradation at all.
 *
 * Until #5241 the gate could not express it. Adding `saveMetaItem` to the
 * vocabulary in #4754 surfaced four seams, and THREE of them were this shape:
 * `meta.ts`'s PUT handler answering `errorFromThrown(e, 400)`, and
 * `protocol.ts`'s two batch operations writing the failure into the per-item
 * outcome report that IS their contract. All three had to be parked in
 * `durability-degradation.baseline.json` — entries for correct code, in a
 * shrink-only ledger that says every line is debt. Worse, the cheapest way to
 * satisfy the gate at `meta.ts` was to bolt on a `logger.error`, and the common
 * case on that path is an author submitting an off-spec body: one durability
 * `error` per bad keystroke, which is the exact mirror-image failure AGENTS.md
 * warns about ("trains everyone to skim `error`") and the reason #4420's `warn`
 * went unread. A gate whose cheapest satisfaction is harmful has the wrong
 * shape.
 *
 * ## Declared, not guessed — and still structurally verified
 *
 * Same philosophy as `DURABILITY_CRITICAL_CALLEES`: the names are DECLARED
 * here, never inferred from spelling. `/report|failed|error/`-style matching is
 * the heuristic this file rejects on the other side of the rule, and it is no
 * more acceptable on this side — a name-shaped guess would let a genuinely
 * swallowing catch buy its way out by calling something that sounds like a
 * reporter.
 *
 * But a declaration alone would just be a baseline entry under a friendlier
 * name (the "reviewed exception" direction #5241 explicitly rejected). So the
 * declaration only supplies the NAME; the checker still proves the STRUCTURE:
 *
 *   > every path out of the `catch` must deliver the failure.
 *
 * A catch that answers an error envelope on one branch and a normal value on
 * another is still a violation. So is one that delivers on a branch and falls
 * off the end on the other. So is one whose delivery sits inside a callback
 * that runs later. See `catchDeliversFailure()` — the analysis is deliberately
 * conservative and reports "cannot prove" as "does not deliver", so an
 * unmodelled shape is judged, never excused.
 *
 * ## Two kinds, because they deliver differently
 *
 *   - `via: 'return'` — the call BUILDS the answer; the value is the delivery,
 *     so it only counts inside a `return`. `const env = errorFromThrown(e)`
 *     followed by a `warn` delivers nothing.
 *   - `via: 'effect'` — the call IS the delivery (it writes the failure into a
 *     report the caller receives), so a bare expression statement counts.
 *
 * `sendError` (`@objectstack/types`) is the obvious next `via: 'return'`
 * entry — it is a real repo-wide convention — but no durability-critical seam
 * exits through it today, and a declared entry nothing consumes is the
 * "declared ≠ enforced" shape this repo keeps paying to remove. It gets
 * declared by the PR that first needs it.
 */
const FAILURE_PROPAGATION_CALLEES = new Map([
    [
        'errorFromThrown',
        {
            via: 'return',
            why:
                'Builds the HTTP error envelope FROM the caught error, preserving its own `.status` plus the '
                + 'structured spec-validation `issues` (packages/runtime/src/http-dispatcher.ts). The caller that '
                + 'asked for the write is told, field-anchored, that it did not happen.',
        },
    ],
]);

/**
 * Declared failure-propagation vocabulary, scoped to ONE function.
 *
 * The second shape #5241 names — a batch operation whose CONTRACT is a
 * structured per-item outcome report, delivering each failure by writing it
 * into that report — cannot use the global list above, because its delivery
 * runs through names that are only meaningful locally: `record(...)`,
 * `failed.push(...)`. Declaring `record` or `push` repo-wide would be the
 * spelling-heuristic this file rejects.
 *
 * So the declaration is scoped to the enclosing function. The key is
 * `<file>::<enclosing function name>` — NOT a line (line numbers churn on every
 * unrelated edit) and NOT a whole file (`protocol.ts` is nine thousand lines
 * and `saveMetaItem` is the most durability-critical callee in the repo; a
 * file-wide licence there is a blind spot big enough to hide the next #4669).
 *
 * This is a VOCABULARY entry, not a baseline entry, and the difference is
 * mechanical rather than editorial: it supplies a name, and `catchDeliversFailure()`
 * still has to prove every path out of the catch reaches it. A new swallowing
 * catch in the same function is still flagged; a catch that stops calling the
 * declared sink is still flagged. Entries are checked for staleness (an entry
 * that excuses nothing must be deleted) for the same reason the baseline is
 * shrink-only.
 */
const FAILURE_PROPAGATION_SITES = new Map([
    [
        'packages/metadata-protocol/src/protocol.ts::migrateStoredMetadata',
        {
            callees: [['record', 'effect']],
            why:
                "`record()` is this function's per-item outcome recorder: it appends the row to `report.items` "
                + "and increments the matching counter, so `record({ outcome: 'failed', reason })` in the catch "
                + 'increments `report.failed` and itemises WHICH row did not land, with why. The report IS the '
                + "operation's contract — strictly louder than a log line, and the caller cannot miss it (#5241, "
                + 'entered the baseline in #4754).',
        },
    ],
    [
        'packages/metadata-protocol/src/protocol.ts::duplicatePackage',
        {
            callees: [['failed.push', 'effect']],
            why:
                '`failed[]` is half of this function\'s returned envelope: pushing to it flips the aggregate '
                + '`success` to false, populates `failedCount`, and returns the offending `{ type, name, error }` '
                + 'to the caller. The copy reports, per item, that the write did not land (#5241, entered the '
                + 'baseline in #4754).',
        },
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
 * Does this call expression match a declared propagation name?
 *
 * Two spellings, both exact — never a pattern:
 *   - bare `errorFromThrown` matches `errorFromThrown(...)` AND
 *     `deps.errorFromThrown(...)` (the method name is what carries the meaning,
 *     exactly as `calleeName()` already resolves it for the critical side);
 *   - dotted `failed.push` matches `failed.push(...)` and nothing else — the
 *     receiver is load-bearing, because `push` alone means nothing.
 */
function matchesPropagationName(node, declaredName) {
    if (!ts.isCallExpression(node)) return false;
    const dot = declaredName.indexOf('.');
    if (dot === -1) return calleeName(node) === declaredName;
    const receiverName = declaredName.slice(0, dot);
    const methodName = declaredName.slice(dot + 1);
    const expr = node.expression;
    if (!ts.isPropertyAccessExpression(expr) || !ts.isIdentifier(expr.name)) return false;
    if (expr.name.text !== methodName) return false;
    const receiver = expr.expression;
    return ts.isIdentifier(receiver) && receiver.text === receiverName;
}

/**
 * The innermost NAMED function-like ancestor of `node` — the granularity of a
 * `FAILURE_PROPAGATION_SITES` key. Returns `undefined` inside an anonymous
 * callback, which simply means no site declaration can be written for that
 * catch (it must rethrow, be loud, or use the global vocabulary).
 */
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
        if (ts.isFunctionExpression(n) && n.name) return n.name.text;
    }
    return undefined;
}

/**
 * Does `node`'s SAME-TICK subtree contain a declared propagation call of one of
 * the accepted kinds? Returns the matched declaration, so the caller can record
 * which site entry was actually load-bearing.
 *
 * Same-tick on purpose: a delivery inside a callback registered by the catch
 * runs later and does not answer THIS failure — the same reason the `try` side
 * refuses to descend into `runsLater` bodies.
 */
function findPropagationCall(node, declared, acceptedKinds) {
    let hit;
    walkSameTickInclusive(node, (child) => {
        if (hit) return;
        for (const d of declared) {
            if (!acceptedKinds.has(d.via)) continue;
            if (matchesPropagationName(child, d.name)) {
                hit = d;
                return;
            }
        }
    });
    return hit;
}

/**
 * Does EVERY path out of this `catch` deliver the failure?
 *
 * This is the half of #5241 that keeps the new vocabulary from blinding the
 * gate. A declared name is necessary and NOT sufficient: the catch must have no
 * path that leaves without delivering — no early `return` of a normal value, no
 * `break`/`continue` before the report is written, no falling off the end.
 *
 * Modelled structurally over the shapes the repo actually uses (sequence,
 * block, `if`/`else`, `throw`, `return`, `break`/`continue`). Anything else is
 * handled by the conservative fallback: it can only carry a delivery FORWARD,
 * never invent one, and any exit it contains that has not already delivered
 * counts as an escape. "Cannot prove" therefore reads as "does not deliver",
 * which judges the seam instead of excusing it — the safe direction for a gate.
 *
 * `delivered` = every path that FALLS THROUGH past this construct has delivered
 *               (vacuously true when nothing falls through).
 * `escaped`   = some path LEAVES the catch (return/break/continue) without
 *               having delivered.
 * `terminates`= no path falls through past this construct.
 */
function catchDeliversFailure(block, declared) {
    if (declared.length === 0) return undefined;
    const returnKinds = new Set(['return', 'effect']);
    const effectKinds = new Set(['effect']);
    let evidence;

    const note = (hit) => {
        if (hit && !evidence) evidence = hit;
        return !!hit;
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
            // A rethrow IS delivery — the loudest kind.
            return { delivered: true, escaped: false, terminates: true };
        }
        if (ts.isReturnStatement(stmt)) {
            const ok = delivered || note(findPropagationCall(stmt, declared, returnKinds));
            return { delivered: true, escaped: !ok, terminates: true };
        }
        if (ts.isBreakStatement(stmt) || ts.isContinueStatement(stmt)) {
            return { delivered: true, escaped: !delivered, terminates: true };
        }
        if (ts.isExpressionStatement(stmt)) {
            const ok = delivered || note(findPropagationCall(stmt, declared, effectKinds));
            return { delivered: ok, escaped: false, terminates: false };
        }
        if (ts.isBlock(stmt)) return analyzeList(stmt.statements, delivered);
        if (ts.isIfStatement(stmt)) {
            const t = analyzeStmt(stmt.thenStatement, delivered);
            const e = stmt.elseStatement
                ? analyzeStmt(stmt.elseStatement, delivered)
                : { delivered, escaped: false, terminates: false };
            const terminates = t.terminates && e.terminates;
            const fallThrough =
                terminates ? true
                : t.terminates ? e.delivered
                : e.terminates ? t.delivered
                : t.delivered && e.delivered;
            return { delivered: fallThrough, escaped: t.escaped || e.escaped, terminates };
        }
        // Conservative fallback for every shape not modelled above (loops,
        // `switch`, nested `try`, labelled statements). It never invents a
        // delivery; it only asks whether some exit inside it escapes undelivered.
        let escaped = false;
        walkSameTick(stmt, (child) => {
            if (ts.isReturnStatement(child)) {
                if (!delivered && !note(findPropagationCall(child, declared, returnKinds))) escaped = true;
            } else if (ts.isBreakStatement(child) || ts.isContinueStatement(child)) {
                if (!delivered) escaped = true;
            }
        });
        return { delivered, escaped, terminates: false };
    };

    const r = analyzeList(block.statements, false);
    if (!r.delivered || r.escaped || !evidence) return undefined;
    return evidence;
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

function analyzeSourceFile(sf, relPath, findings, seams, options = {}) {
    const propagationSites = options.propagationSites ?? FAILURE_PROPAGATION_SITES;
    const usedPropagationSites = options.usedPropagationSites;
    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    const functionBodies = indexFunctionBodies(sf);

    const globalPropagation = [...FAILURE_PROPAGATION_CALLEES].map(([name, d]) => ({
        name,
        via: d.via,
        why: d.why,
        site: undefined,
    }));

    /** The propagation names in scope for a catch: global + this function's. */
    const declaredPropagationFor = (tryNode) => {
        const fnName = enclosingFunctionName(tryNode);
        if (!fnName) return globalPropagation;
        const key = `${relPath}::${fnName}`;
        const entry = propagationSites.get(key);
        if (!entry) return globalPropagation;
        return [
            ...globalPropagation,
            ...entry.callees.map(([name, via]) => ({ name, via, why: entry.why, site: key })),
        ];
    };

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

        // 3. …or does it hand the failure to the caller on EVERY path? (#5241)
        const delivery = catchDeliversFailure(
            node.catchClause.block,
            declaredPropagationFor(node),
        );
        if (delivery?.site && usedPropagationSites) usedPropagationSites.add(delivery.site);

        const loud = levels.filter((l) => LOUD_LEVELS.has(l.level));
        const quiet = levels.filter((l) => QUIET_LEVELS.has(l.level));

        const seam = {
            file: relPath,
            callee: guarded[0].callee,
            calleeLine: guarded[0].line,
            catchLine: lineOf(node.catchClause),
            rethrows: propagatesAlways,
            partialRethrow: rethrows && !propagatesAlways,
            propagates: delivery ? `${delivery.name}()${delivery.site ? ' (site-declared)' : ''}` : undefined,
            propagatesWhy: delivery?.why,
            loud: loud.map((l) => `${l.level}@${l.line}${l.viaHelper ? ` via ${l.viaHelper}()` : ''}`),
            quiet: quiet.map((l) => `${l.level}@${l.line}${l.viaHelper ? ` via ${l.viaHelper}()` : ''}`),
        };
        seams.push(seam);

        if (propagatesAlways || delivery || loud.length > 0) return;

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
    const usedPropagationSites = new Set();

    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        if (!text.includes('catch')) continue;
        const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        analyzeSourceFile(sf, relative(ROOT, file).split(sep).join('/'), findings, seams, {
            usedPropagationSites,
        });
    }

    if (list) {
        console.log(`\nDurability-critical catch seams found: ${seams.length}\n`);
        for (const s of seams) {
            const verdict = s.rethrows
                ? 'rethrows'
                : s.propagates
                  ? `propagates to caller via ${s.propagates}`
                  : s.partialRethrow && s.loud.length > 0
                  ? `recovers on one branch, loud (${s.loud.join(', ')})`
                  : s.loud.length > 0
                  ? `loud (${s.loud.join(', ')})`
                  : s.quiet.length > 0
                    ? `QUIET (${s.quiet.join(', ')})`
                    : 'SILENT';
            console.log(`  ${s.file}:${s.catchLine}  guards ${s.callee}()@${s.calleeLine}  → ${verdict}`);
            // A propagating seam is EXCUSED, so the census must show the reason
            // it was excused — otherwise reviewing the vocabulary means reading
            // the script instead of the report it prints.
            if (s.propagates && s.propagatesWhy) console.log(`      why: ${s.propagatesWhy}`);
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
                `    fix     : log at \`error\` naming the CONSEQUENCE and the FIX (see packages/services/service-automation/src/plugin.ts start(), #4460), or rethrow.\n` +
                `    OR      : if this catch already HANDS THE FAILURE TO THE CALLER on every path (an error envelope, a per-item outcome report), do NOT bolt on a log — declare how it delivers, in FAILURE_PROPAGATION_CALLEES or FAILURE_PROPAGATION_SITES in this script (#5241). Adding a redundant \`logger.error\` to a path whose common case is a rejected request is the mirror-image failure AGENTS.md warns about.\n`,
            );
        }
    }

    const staleSites = [...FAILURE_PROPAGATION_SITES.keys()].filter(
        (k) => !usedPropagationSites.has(k),
    );
    if (staleSites.length > 0) {
        failed = true;
        console.error(
            `\n✗ ${staleSites.length} stale entr(ies) in FAILURE_PROPAGATION_SITES — the declaration excuses nothing, so delete it (a vocabulary entry that matches no seam is a licence waiting for the next catch that lands in that function):\n`,
        );
        for (const k of staleSites) {
            console.error(`  ${k}`);
            const why = FAILURE_PROPAGATION_SITES.get(k)?.why;
            if (why) console.error(`    it was declared because: ${why}`);
        }
        console.error(
            '  If the function was RENAMED, update the key. If the catch no longer delivers the\n' +
            '  failure that way, the seam is a real degradation again and must be fixed, not re-keyed.\n',
        );
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
        const propagating = seams.filter((s) => s.propagates).length;
        console.log(
            `✓ durability-degradation log levels: ${seams.length} durability-critical catch seam(s), all loud, rethrowing or propagating to the caller` +
                (propagating > 0 ? ` (${propagating} propagating, declared)` : '') +
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

        // ── #5241: the declared failure-propagation vocabulary ───────────────
        // The gate's third legal answer. Every case below pins BOTH halves of
        // it: the name must be DECLARED (never guessed from spelling), and the
        // structure must be PROVED (every path out of the catch delivers). Drop
        // either half and the gate goes blind in one of two directions — a
        // spelling heuristic excuses swallows, a bare declaration is a baseline
        // entry wearing a vocabulary's name.
        {
            // The `meta.ts` PUT handler: `saveMetaItem` IS the request's primary
            // operation, and the catch answers the caller a 4xx/422 carrying the
            // structured spec-validation `issues`. Nothing looks normal
            // afterwards, so it is not a degradation and must not need a log.
            name: 'passes: catch answers the caller an error envelope on every path (#5241)',
            code: `
                class P { async f(deps: any, protocol: any, type: string, name: string, body: any) {
                    try {
                        const result = await protocol.saveMetaItem({ type, name, item: body });
                        return { handled: true, response: deps.success(result) };
                    } catch (e: any) {
                        return { handled: true, response: deps.errorFromThrown(e, 400) };
                    }
                } }`,
            expectViolation: false,
        },
        {
            // The negative that keeps the vocabulary honest: one branch answers
            // the failure, the other answers success. The caller on THAT path is
            // told the save worked when it did not — the #4632 loss exactly.
            name: 'flags: envelope on one branch, a normal value on the other (partial propagation)',
            code: `
                class P { async f(deps: any, protocol: any, body: any) {
                    try { await protocol.saveMetaItem(body); }
                    catch (e: any) {
                        if (e?.status === 422) return { handled: true, response: deps.errorFromThrown(e, 400) };
                        return { handled: true, response: deps.success({ ok: true }) };
                    }
                } }`,
            expectViolation: true,
        },
        {
            name: 'flags: envelope on one branch, falls off the end on the other',
            code: `
                class P { async f(deps: any, protocol: any, body: any) {
                    try { await protocol.saveMetaItem(body); }
                    catch (e: any) {
                        if (e?.status === 422) return { handled: true, response: deps.errorFromThrown(e, 400) };
                    }
                } }`,
            expectViolation: true,
        },
        {
            // `via: 'return'` is why this is caught: for an envelope BUILDER the
            // value is the delivery, so building one and then dropping it
            // delivers nothing. A "does the catch mention errorFromThrown"
            // check would wave this through.
            name: 'flags: an error envelope BUILT but never returned',
            code: `
                class P { async f(deps: any, protocol: any, body: any) {
                    try { await protocol.saveMetaItem(body); }
                    catch (e: any) {
                        const envelope = deps.errorFromThrown(e, 400);
                        deps.logger.warn('save failed', envelope);
                    }
                } }`,
            expectViolation: true,
        },
        {
            // The second shape #5241 names: a batch whose CONTRACT is a per-item
            // outcome report. `record` means nothing repo-wide, so it is
            // declared for ONE function — and the structure is still proved.
            name: 'passes: site-declared per-item outcome report (#5241 second shape)',
            code: `
                class P { async migrateStoredMetadata(rows: any[], report: any) {
                    const record = (entry: any) => { report.items.push(entry); };
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); record({ outcome: 'rewritten' }); }
                        catch (e: any) { record({ outcome: 'failed', reason: e?.message }); }
                    }
                } }`,
            sites: [['t.ts::migrateStoredMetadata', { callees: [['record', 'effect']] }]],
            expectViolation: false,
            expectSitesUsed: ['t.ts::migrateStoredMetadata'],
        },
        {
            // Same code, no declaration: still a violation. This is the whole
            // "declared, not guessed" half — the checker must never infer that
            // something called `record` reports a failure.
            name: 'flags: the same report shape with NO site declaration (declared, not guessed)',
            code: `
                class P { async migrateStoredMetadata(rows: any[], report: any) {
                    const record = (entry: any) => { report.items.push(entry); };
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); record({ outcome: 'rewritten' }); }
                        catch (e: any) { record({ outcome: 'failed', reason: e?.message }); }
                    }
                } }`,
            expectViolation: true,
        },
        {
            // Function granularity is load-bearing: `protocol.ts` is nine
            // thousand lines and a file-wide licence for `saveMetaItem` would
            // hide the next real swallow.
            name: 'flags: a site declaration for a DIFFERENT function does not license this one',
            code: `
                class P { async duplicatePackage(rows: any[], report: any) {
                    const record = (entry: any) => { report.items.push(entry); };
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); }
                        catch (e: any) { record({ outcome: 'failed', reason: e?.message }); }
                    }
                } }`,
            sites: [['t.ts::migrateStoredMetadata', { callees: [['record', 'effect']] }]],
            expectViolation: true,
        },
        {
            name: 'passes: site-declared DOTTED sink (failed.push) — the receiver is what carries the meaning',
            code: `
                class P { async duplicatePackage(rows: any[]) {
                    const failed: any[] = [];
                    const copied: any[] = [];
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); copied.push(row); }
                        catch (e: any) { failed.push({ type: row.type, name: row.name, error: e?.message }); }
                    }
                    return { success: failed.length === 0, copied, failed };
                } }`,
            sites: [['t.ts::duplicatePackage', { callees: [['failed.push', 'effect']] }]],
            expectViolation: false,
            expectSitesUsed: ['t.ts::duplicatePackage'],
        },
        {
            name: 'flags: a DIFFERENT array than the declared sink does not deliver',
            code: `
                class P { async duplicatePackage(rows: any[]) {
                    const failed: any[] = [];
                    const skipped: any[] = [];
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); }
                        catch (e: any) { skipped.push({ name: row.name }); }
                    }
                    return { success: failed.length === 0, failed };
                } }`,
            sites: [['t.ts::duplicatePackage', { callees: [['failed.push', 'effect']] }]],
            expectViolation: true,
        },
        {
            name: 'flags: the declared report is written on only ONE branch',
            code: `
                class P { async migrateStoredMetadata(rows: any[], report: any) {
                    const record = (entry: any) => { report.items.push(entry); };
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); }
                        catch (e: any) { if (e?.fatal) { record({ outcome: 'failed' }); } }
                    }
                } }`,
            sites: [['t.ts::migrateStoredMetadata', { callees: [['record', 'effect']] }]],
            expectViolation: true,
        },
        {
            name: 'passes: report written, then `continue` — the loop moves on AFTER delivering',
            code: `
                class P { async migrateStoredMetadata(rows: any[], report: any) {
                    const record = (entry: any) => { report.items.push(entry); };
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); }
                        catch (e: any) { record({ outcome: 'failed', reason: e?.message }); continue; }
                    }
                } }`,
            sites: [['t.ts::migrateStoredMetadata', { callees: [['record', 'effect']] }]],
            expectViolation: false,
        },
        {
            name: 'flags: `continue` BEFORE the declared report leaves a path undelivered',
            code: `
                class P { async migrateStoredMetadata(rows: any[], report: any) {
                    const record = (entry: any) => { report.items.push(entry); };
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); }
                        catch (e: any) { if (e?.transient) continue; record({ outcome: 'failed' }); }
                    }
                } }`,
            sites: [['t.ts::migrateStoredMetadata', { callees: [['record', 'effect']] }]],
            expectViolation: true,
        },
        {
            // Same reason the `try` side refuses to descend into `runsLater`
            // bodies: a delivery scheduled for later does not answer THIS
            // failure, and the caller has already been told the write is done.
            name: 'flags: the delivery sits in a callback that runs LATER',
            code: `
                class P { async f(deps: any, protocol: any, body: any, queue: any) {
                    try { await protocol.saveMetaItem(body); }
                    catch (e: any) { queue.push(() => deps.errorFromThrown(e, 400)); }
                } }`,
            expectViolation: true,
        },
        {
            name: 'passes: BOTH branches of an if/else answer the caller an envelope',
            code: `
                class P { async f(deps: any, protocol: any, body: any) {
                    try { await protocol.saveMetaItem(body); return { handled: true, response: deps.success(null) }; }
                    catch (e: any) {
                        if (e?.status === 422) { return { handled: true, response: deps.errorFromThrown(e, 422) }; }
                        else { return { handled: true, response: deps.errorFromThrown(e, 500) }; }
                    }
                } }`,
            expectViolation: false,
        },
        {
            // Documents the conservative fallback: a shape the analysis does not
            // model can carry a delivery forward but never invent one, so
            // "cannot prove" reads as "does not deliver" and the seam is judged.
            // The safe direction — the opposite one would excuse swallows.
            name: 'flags: a delivery the analysis cannot prove reaches every path (conservative fallback)',
            code: `
                class P { async migrateStoredMetadata(rows: any[], report: any) {
                    const record = (entry: any) => { report.items.push(entry); };
                    for (const row of rows) {
                        try { await this.saveMetaItem(row); }
                        catch (e: any) { for (const issue of e?.issues ?? []) { record({ outcome: 'failed', issue }); } }
                    }
                } }`,
            sites: [['t.ts::migrateStoredMetadata', { callees: [['record', 'effect']] }]],
            expectViolation: true,
        },
        {
            // A propagating catch is still a SEAM — it is reported by `--list`
            // and it must not vanish from the census. #4754's whole precision
            // problem started with seams the gate could see but not classify.
            name: 'passes: a propagating catch is still counted as a seam (not made invisible)',
            code: `
                class P { async f(deps: any, protocol: any, body: any) {
                    try { await protocol.saveMetaItem(body); }
                    catch (e: any) { return { handled: true, response: deps.errorFromThrown(e, 400) }; }
                } }`,
            expectViolation: false,
            expectSeams: 1,
        },
    ];

    let failures = 0;
    for (const c of cases) {
        const sf = ts.createSourceFile('t.ts', c.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
        const findings = [];
        const seams = [];
        const usedPropagationSites = new Set();
        analyzeSourceFile(sf, 't.ts', findings, seams, {
            // A case may declare its OWN site vocabulary, so the fixtures can
            // exercise `FAILURE_PROPAGATION_SITES` without depending on the real
            // repo paths (which would rot the moment a function is renamed).
            ...(c.sites ? { propagationSites: new Map(c.sites) } : {}),
            usedPropagationSites,
        });
        const got = findings.length > 0;
        // `expectCount` pins HOW MANY seams a case reports, not just whether it
        // reports one. Nesting cases need it: "still flags" is satisfied both by
        // the correct single finding and by the duplicate-per-nesting-level bug
        // it replaced, so a boolean cannot tell those two apart (#4754).
        const countMismatch = c.expectCount !== undefined && findings.length !== c.expectCount;
        const seamMismatch = c.expectSeams !== undefined && seams.length !== c.expectSeams;
        // `expectSitesUsed` pins the bookkeeping the STALENESS check runs on: a
        // site declaration that excuses nothing must be reported and deleted, so
        // "was this entry load-bearing?" has to be recorded accurately (#5241).
        const usedList = [...usedPropagationSites].sort();
        const sitesMismatch =
            c.expectSitesUsed !== undefined &&
            JSON.stringify(usedList) !== JSON.stringify([...c.expectSitesUsed].sort());
        if (got !== c.expectViolation || countMismatch || seamMismatch || sitesMismatch) {
            failures++;
            console.error(
                `  ✗ ${c.name}: expected violation=${c.expectViolation}` +
                    (c.expectCount !== undefined ? ` count=${c.expectCount}` : '') +
                    (c.expectSeams !== undefined ? ` seams=${c.expectSeams}` : '') +
                    (c.expectSitesUsed !== undefined ? ` sitesUsed=${JSON.stringify(c.expectSitesUsed)}` : '') +
                    `, got violation=${got} count=${findings.length} seams=${seams.length}` +
                    (c.expectSitesUsed !== undefined ? ` sitesUsed=${JSON.stringify(usedList)}` : ''),
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
