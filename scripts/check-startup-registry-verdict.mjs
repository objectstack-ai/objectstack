#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Startup registry-verdict guard (#4777, from #4769 / #4771 / #4772).
 *
 * ## The rule it enforces
 *
 * A boot sequence fills its registries incrementally. Asking "is X registered?"
 * before the filling has finished is fine — the answer is simply not final yet.
 * Turning that not-yet into a **verdict, and recording the verdict**, is the
 * defect: the provider registers a moment later and nothing goes back to undo
 * the record.
 *
 * One showcase cold start on 2026-08-03 produced three instances of the same
 * shape, in three unrelated subsystems written by three people at three times:
 *
 *   - #4772 plugin-auth — `AuthPlugin.init()` probed `getServiceAsync('cache')`
 *     21ms before `CacheServicePlugin.init()` registered it, then FROZE the
 *     `undefined` into the better-auth config for the life of the process. The
 *     printed warning told operators to provision Redis for a problem they did
 *     not have; the real cost was that rate-limit counters never reached the
 *     shared store even after it came up (ADR-0069 D2 declared a capability the
 *     runtime did not deliver).
 *   - #4771 service-automation — flow node types were judged against the
 *     executor registry while `AutomationServicePlugin.start()` was still
 *     pulling flows, ~0.8s before `ApprovalsServicePlugin` registered the
 *     `approval` executor. Every cold boot asserted that eight ADR-0019
 *     approval flows "will fail at execution time"; all eight were false, and a
 *     deployment that genuinely lacked the plugin emitted the identical eight.
 *   - #4769 objectql — the ADR-0104 attestation wrote "verified" into
 *     `sys_migration` during the same boot that was still seeding rows which
 *     contradict it. **Not catchable here** — see "What it cannot see".
 *
 * The judgment question, the counterpart of the one AGENTS.md asks about
 * degradation log levels:
 *
 *   > At the moment this code concludes "X is not registered", can a provider
 *   > still register X in this same boot? If yes, is that conclusion RECORDED
 *   > anywhere that outlives the moment?
 *   > Yes and yes → violation.
 *
 * ## The three-part shape (all three, or it is not a finding)
 *
 *   1. a read of a registry that is still filling (the service registry during
 *      `init()`; a plugin-extensible capability registry before it is sealed),
 *   2. a terminal conclusion drawn from "absent",
 *   3. that conclusion **recorded** — cached in an instance field / module
 *      binding, asserted in a log line, or persisted.
 *
 * Part 3 is what makes this a rule and not noise. A read-only probe is
 * completely legal and this gate must not flag it: `getUnknownNodeTypeAudit()`
 * in `service-automation/src/engine.ts` reads the executor registry on every
 * call, records nothing, and is correct. A gate that flagged every startup
 * `getService(...)` would be switched off inside a week, and a gate people
 * switch off is worth less than no gate because it also reports success.
 *
 * ## What it checks
 *
 * **Rule A — pre-ready service probe with a recorded verdict.** Inside a
 * `constructor` or an `init()` (NOT `start()`: by then every `init()` has
 * completed, which is the same line `check-init-service-contract.mjs` draws and
 * for the same reason), a tolerated read of the service registry — `getService`
 * / `getServiceAsync` / `hasService` / … with a literal service name — whose
 * result is then branched on into a log line, or assigned somewhere that
 * outlives the call.
 *
 * **Rule B — open capability registry judged before it is sealed.** A registry
 * whose vocabulary is open by contract (ADR-0018: plugins contribute flow node
 * executors from their own `init()`/`start()`) may only produce an "absent"
 * verdict once the host has declared it closed. A function that both reads such
 * a registry and logs at `warn`/`error` — either directly or through same-file
 * helpers — is a violation unless it references the registry's declared seal
 * flag. Reading without logging is fine; logging without reading is fine.
 *
 * ## What it cannot see (stated up front, not discovered later)
 *
 * This is a declared vocabulary over syntax. Its reach is exactly as wide as
 * the vocabulary and no wider:
 *
 *   1. `getService('cache')` is visible; a `resolveCacheOrFallback()` three
 *      layers down a different package is not. The call-graph walk is
 *      same-file only.
 *   2. **#4769 is invisible to it.** That "registry" is the `sys_migration`
 *      table in a database, reached through the ObjectQL engine — no syntactic
 *      vocabulary distinguishes it from any other row read. #4769 is a fixture
 *      for this class because its FIX is verifiable, not because this gate
 *      finds it.
 *   3. A service name that is not a string literal (`ctx.getService(cfg.name)`)
 *      is skipped rather than guessed.
 *
 * Widening the match to cover any of these would trade a miss for a false
 * positive, and false positives kill a gate faster than misses do. This gate
 * stops the bleeding; it does not cure. The cure is #4776's decision.
 *
 * ## Why AST, not regex
 *
 * The record is rarely adjacent to the read. In #4772 the probe sat in a
 * `try`, the verdict in the `else` of an `if` three statements later, and the
 * durable half in `this.effectiveSecondaryStorage` forty lines below that. In
 * #4771 the read and the warn were in a private helper the public method
 * called. Line proximity does not decide this; block structure does.
 *
 * Nested function bodies are NOT descended into: a callback registered during
 * `init()` (`ctx.hook('kernel:ready', …)`, a lazily-resolved closure) runs
 * later, when the registry IS complete — that is the shape both #4771 and
 * #4772 were fixed INTO, so treating it as a violation would flag the cure.
 * Same choice, same reason, as `check-init-service-contract.mjs` and
 * `check-durability-degradation-log-level.mjs`.
 *
 * ## Usage
 *
 *     node scripts/check-startup-registry-verdict.mjs                    # audit
 *     node scripts/check-startup-registry-verdict.mjs --list             # every seam found
 *     node scripts/check-startup-registry-verdict.mjs --self-test        # verify the checker
 *     node scripts/check-startup-registry-verdict.mjs --packages-dir <p> # audit another tree
 *
 * `--packages-dir` is how the before/after proof in #4777 was produced: point
 * it at a checkout of a pre-fix commit and the gate must REPORT; point it at
 * `main` and it must be clean. A gate that has only ever been green is
 * indistinguishable from a gate that matches nothing (#4690).
 *
 * ## Dead scan roots are a hard error (#4930)
 *
 * This audit's verdict — "none recording a verdict the boot can contradict" —
 * is drawn from having read every `.ts` under the scan root. `collectSourceFiles`
 * used to open with `try { entries = readdirSync(dir); } catch { return out; }`,
 * so an unreadable directory contributed zero files and the walk carried on. At
 * the root that was caught downstream (`files.length === 0` refuses to report
 * success), but one level in it was not: a subdirectory that cannot be read
 * silently shrinks the corpus while `files.length` stays comfortably non-zero,
 * and the gate prints a green line over a scan that never opened part of its
 * subject. That is the shape this script's own header spends a screen warning
 * about, turned on the script itself.
 *
 * So the scan root is now resolved up front by `assertRootsResolvable`, which
 * fails BY NAME and distinguishes "does not exist" from "exists but is not a
 * directory" (the old `existsSync` accepted a file and then blamed the empty
 * result), and the walk carries no catch at all: an error during it means the
 * corpus was only partly read, which must not be reported as a clean audit.
 * Deliberately no optional-root flag — see `assertRootsResolvable`.
 */

import {
    existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseSourceFile } from './ts-parse.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASELINE_PATH = join(ROOT, 'scripts', 'startup-registry-verdict.baseline.json');

// ── Vocabulary ───────────────────────────────────────────────────────────────

/**
 * Reads of the kernel SERVICE registry. Each entry names why the answer is not
 * final during the phases below; the note is printed in the violation message
 * so the author reads the consequence rather than a rule id.
 */
const SERVICE_REGISTRY_PROBES = new Map([
    ['getService', 'resolves the kernel service registry, which other plugins are still filling'],
    ['getServiceAsync', 'resolves the kernel service registry (async accessor), which other plugins are still filling'],
    ['getServiceOptional', 'resolves the kernel service registry tolerantly — absence here means "not yet", not "never"'],
    ['tryGetService', 'resolves the kernel service registry tolerantly — absence here means "not yet", not "never"'],
    ['hasService', 'asks the kernel service registry for membership, which other plugins are still filling'],
]);

/**
 * Lifecycle phases in which a service-registry answer is NOT final.
 *
 * `start()` is deliberately absent: by then every plugin's `init()` has
 * completed, so a service registered in `init()` really is missing if it is
 * missing — that is the sanctioned best-effort seam, and it is the same line
 * `check-init-service-contract.mjs` draws. `ApprovalsServicePlugin.start()`
 * probing `automation` and warning is CORRECT and must not be flagged; it is
 * structurally identical to the #4772 defect and only the phase tells them
 * apart.
 */
const PRE_READY_PHASES = new Map([
    ['constructor', 'the constructor runs at composition time — before ANY plugin has been initialized'],
    ['init', 'ADR-0116: another plugin\'s init() may not have run yet, so an absent service may simply be a later one'],
]);

/**
 * Capability registries whose vocabulary is OPEN by contract, with the flag
 * whose presence licenses a verdict against them.
 *
 * `seal` is an identifier the licensing code must mention — set by the host at
 * the moment the vocabulary can no longer grow, or tested before drawing the
 * conclusion. Naming it here is what keeps "is it sealed yet?" a question the
 * code answers rather than one this script guesses.
 */
const OPEN_CAPABILITY_REGISTRIES = new Map([
    [
        'nodeExecutors',
        {
            seal: 'nodeTypeVocabularySealed',
            note: 'ADR-0018 makes the flow node-type vocabulary open and runtime-extensible — a plugin registers its executor from its own init()/start(), after the boot flow pull. An unknown type before the seal means "not registered YET" (#4771).',
        },
    ],
    [
        'actionDescriptors',
        {
            seal: 'nodeTypeVocabularySealed',
            note: 'ADR-0018 action descriptors are published by plugins during boot; a type missing from them before the seal means "not published YET" (#4771).',
        },
    ],
]);

/** Calls that write a verdict somewhere that survives the process (#4769's shape). */
const PERSISTENCE_CALLEES = new Set(['insert', 'insertOne', 'update', 'updateOne', 'upsert', 'save', 'saveMetaItem']);

/**
 * Members that ENUMERATE a registry — "everything registered, as of now".
 *
 * Only an enumeration can produce the #4771 verdict, which is about the
 * registry AS A WHOLE ("no plugin provides this type"). A keyed lookup
 * (`registry.has(x)`, `registry.get(x)`) asks about one item and is how the
 * runtime legitimately dispatches: `registerNodeExecutor` warns on a duplicate
 * it FOUND, `refuseGatedResume` resolves one descriptor at resume time. Both
 * read the registry and both warn, and neither is a startup verdict — reading
 * them as one is exactly the false-positive class that gets a gate turned off.
 */
const REGISTRY_ENUMERATORS = new Set(['keys', 'values', 'entries', 'size', 'forEach']);

/** Declaration fields ADR-0116 uses to make a plugin's ordering explicit. */
const DECLARATION_FIELDS = ['dependencies', 'optionalDependencies', 'requiresServices', 'providesServices'];

const LOUD_LEVELS = new Set(['error', 'fatal']);
const QUIET_LEVELS = new Set(['warn', 'info', 'debug', 'trace', 'log']);
/** Levels that constitute "the verdict was announced" for Rule B. */
const VERDICT_LEVELS = new Set(['warn', 'error', 'fatal']);

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.turbo', 'coverage', '.cache', '.next']);

// ── Generic AST helpers ──────────────────────────────────────────────────────

/** A declared scan root that could not be resolved to a directory. Carries the names. */
class DeadRootError extends Error {
    constructor(dead) {
        super(`unresolvable scan root(s): ${dead.map((d) => `${d.root} — ${d.reason}`).join('; ')}`);
        this.name = 'DeadRootError';
        this.dead = dead;
        /** @type {string[]} just the root paths, for callers that only need to point. */
        this.roots = dead.map((d) => d.root);
    }
}

/**
 * Resolve every declared scan root before reading anything; throw naming the ones
 * that are not directories.
 *
 * Deliberately no whitelist and no `optional: true` marker. The scan root is a
 * git-tracked directory (or a path the operator passed to `--packages-dir` and is
 * therefore asserting exists); no checkout that can run this gate is legitimately
 * missing it. An optional marker "just in case" would hand the next author a
 * supported way to silence this failure instead of fixing the rename — which is
 * the empty `catch {}` again, only spelled politely. If a root ever does become
 * legitimately absent, that is a real decision: record it with its condition and a
 * test, don't relax the check.
 *
 * @throws {DeadRootError}
 */
function assertRootsResolvable(roots) {
    const dead = [];
    for (const root of roots) {
        let st = null;
        try {
            st = statSync(root);
        } catch (err) {
            dead.push({
                root,
                reason: err?.code === 'ENOENT' ? 'does not exist' : `cannot be read (${err?.code ?? err})`,
            });
            continue;
        }
        if (!st.isDirectory()) dead.push({ root, reason: 'exists but is not a directory' });
    }
    if (dead.length) throw new DeadRootError(dead);
}

/**
 * Every auditable `.ts` file under `dir`, recursively.
 *
 * Nothing here is wrapped in a catch: an unresolvable root fails loudly in
 * `assertRootsResolvable`, and an error *inside* the walk (a vanished file, a
 * permission fault) means the corpus was only partly read — which must not be
 * reported as a clean audit either (#4930).
 */
function collectSourceFiles(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            collectSourceFiles(full, out);
        } else if (
            entry.endsWith('.ts') &&
            !entry.endsWith('.d.ts') &&
            !entry.includes('.test.') &&
            !entry.includes('.spec.') &&
            !entry.includes('.conformance.')
        ) {
            out.push(full);
        }
    }
    return out;
}

function isFunctionLike(node) {
    return (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)
    );
}

/** Walk `node`'s subtree WITHOUT descending into bodies that run later. */
function walkSameTick(node, visit) {
    node.forEachChild((child) => {
        if (isFunctionLike(child) || ts.isClassDeclaration(child) || ts.isClassExpression(child)) return;
        visit(child);
        walkSameTick(child, visit);
    });
}

/** Walk everything, nested function bodies included. */
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
 * `logger.warn(…)` / `this.log.error(…)` / `console.error(…)` → the level.
 * Matched on the SHAPE `<logger|log|console>.<level>(…)` so a renamed local
 * (`const log = ctx.logger`) is still seen — same matcher as
 * `check-durability-degradation-log-level.mjs`.
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

/** Does `node`'s subtree mention the identifier `name`? */
function mentionsIdentifier(node, name) {
    if (!name) return false;
    let found = false;
    const visit = (n) => {
        if (found) return;
        if (ts.isIdentifier(n) && n.text === name) found = true;
    };
    if (ts.isIdentifier(node) && node.text === name) return true;
    walkAll(node, visit);
    return found;
}

/** Strip `await` / `as T` / `(…)` / `!` wrappers. */
function unwrap(node) {
    let cur = node;
    for (;;) {
        if (ts.isAwaitExpression(cur) || ts.isParenthesizedExpression(cur) || ts.isNonNullExpression(cur)) {
            cur = cur.expression;
        } else if (ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur)) {
            cur = cur.expression;
        } else {
            return cur;
        }
    }
}

/**
 * Index every named function-like body in the file so a call can be followed to
 * what it does. Keyed by bare name — same trade as the durability gate: a
 * same-file collision can only make the analysis see MORE, never less.
 */
function indexFunctionBodies(sf) {
    const byName = new Map();
    walkAll(sf, (node) => {
        if (ts.isFunctionDeclaration(node) && node.name && node.body) byName.set(node.name.text, node.body);
        else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
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

/** Module-level `let`/`var` names — assigning one records a verdict for the process. */
function moduleLevelMutableBindings(sf) {
    const names = new Set();
    for (const st of sf.statements) {
        if (!ts.isVariableStatement(st)) continue;
        const flags = st.declarationList.flags;
        if (flags & ts.NodeFlags.Const) continue;
        for (const d of st.declarationList.declarations) {
            if (ts.isIdentifier(d.name)) names.add(d.name.text);
        }
    }
    return names;
}

// ── Plugin units and their ADR-0116 declarations ────────────────────────────

/** String elements of an array literal, or undefined when not statically readable. */
function stringArray(init) {
    if (!init || !ts.isArrayLiteralExpression(init)) return undefined;
    const out = [];
    for (const el of init.elements) {
        if (!ts.isStringLiteralLike(el)) return undefined;
        out.push(el.text);
    }
    return out;
}

/**
 * A plugin unit: a class or an object literal carrying a `name` plus lifecycle
 * methods. Both shapes are composed as plugins in this repo (`packages/cli`'s
 * `serve.ts` builds several inline), so both must be read the same way.
 */
function collectPluginUnits(sf) {
    const units = [];

    const readClass = (node) => {
        const decl = { name: undefined };
        const phases = [];
        for (const member of node.members) {
            if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
                const key = member.name.text;
                if (key === 'name' && member.initializer && ts.isStringLiteralLike(member.initializer)) {
                    decl.name = member.initializer.text;
                } else if (DECLARATION_FIELDS.includes(key)) {
                    decl[key] = stringArray(member.initializer) ?? [];
                }
            } else if (ts.isConstructorDeclaration(member) && member.body) {
                phases.push({ phase: 'constructor', body: member.body });
            } else if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name) && member.body) {
                if (PRE_READY_PHASES.has(member.name.text)) {
                    phases.push({ phase: member.name.text, body: member.body });
                }
            }
        }
        units.push({ label: node.name?.text ?? '<anonymous class>', decl, phases });
    };

    const readObjectLiteral = (node) => {
        const decl = { name: undefined };
        const phases = [];
        for (const prop of node.properties) {
            if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
            const key = prop.name.text;
            if (key === 'name' && ts.isStringLiteralLike(prop.initializer)) decl.name = prop.initializer.text;
            else if (DECLARATION_FIELDS.includes(key)) decl[key] = stringArray(prop.initializer) ?? [];
            else if (
                PRE_READY_PHASES.has(key) &&
                (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer)) &&
                prop.initializer.body
            ) {
                phases.push({ phase: key, body: prop.initializer.body });
            }
        }
        if (!decl.name && phases.length === 0 && !decl.providesServices) return;
        if (!decl.name) return; // an object literal with no `name` is not a plugin
        units.push({ label: `${decl.name} (object plugin)`, decl, phases });
    };

    walkAll(sf, (node) => {
        if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) readClass(node);
        else if (ts.isObjectLiteralExpression(node)) readObjectLiteral(node);
    });
    return units;
}

/**
 * service name → the workspace plugin(s) that declare `providesServices` for it.
 *
 * Same index `check-init-service-contract.mjs` builds, for the same reason: a
 * service nothing in the workspace provides has no provider to be ordered
 * against, so nothing about the boot sequence can change the answer.
 */
export function buildProviderIndex(units) {
    const providers = new Map();
    for (const u of units) {
        if (!u.decl.name || !u.decl.providesServices) continue;
        for (const service of u.decl.providesServices) {
            if (!providers.has(service)) providers.set(service, new Set());
            providers.get(service).add(u.decl.name);
        }
    }
    return providers;
}

/**
 * Has this unit made the boot order EXPLICIT for `service`?
 *
 * ADR-0116 gives three declarations, and `check-init-service-contract.mjs`
 * already errors on an init-time `getService` that uses none of them. Once one
 * IS used, the kernel hoists the provider ahead (or asserts it registered), so
 * "absent" really is absent — a verdict about it is a fact, not a guess. That
 * is the line between #4772 (undeclared `cache`, verdict frozen) and
 * `KnowledgeServicePlugin` (declares `optionalDependencies`, caches the answer,
 * and is correct to). Tolerance lives in the plugin's own declaration, where
 * the kernel enforces it — never in this script's ledger.
 */
function verdictIsFinal(unit, service, providers) {
    const d = unit.decl;
    if ((d.providesServices ?? []).includes(service)) return 'the plugin provides this service itself';
    if ((d.requiresServices ?? []).includes(service)) {
        return `declared in requiresServices — the kernel asserts '${service}' is registered before init()`;
    }
    const owners = providers.get(service);
    if (!owners || owners.size === 0) {
        return `no workspace plugin declares providesServices: ['${service}'] — nothing to order against`;
    }
    const declared = [...(d.dependencies ?? []), ...(d.optionalDependencies ?? [])];
    for (const owner of owners) {
        if (declared.includes(owner)) return `declared '${owner}' in dependencies/optionalDependencies — the kernel orders it ahead`;
    }
    return undefined;
}

// ── Rule A: pre-ready service probe with a recorded verdict ──────────────────

/**
 * The binding a probe's result lands in: `const x = await ctx.getService(…)`,
 * `x = ctx.getService(…)`. Returns undefined for an un-bound call (used inline
 * in a condition), which the caller handles by matching on the call node.
 */
function probeBinding(call) {
    let cur = call;
    let parent = cur.parent;
    while (
        parent &&
        (ts.isAwaitExpression(parent) ||
            ts.isParenthesizedExpression(parent) ||
            ts.isAsExpression(parent) ||
            ts.isNonNullExpression(parent) ||
            ts.isSatisfiesExpression(parent))
    ) {
        cur = parent;
        parent = cur.parent;
    }
    if (!parent) return undefined;
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && parent.initializer === cur) {
        return parent.name.text;
    }
    if (
        ts.isBinaryExpression(parent) &&
        parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        parent.right === cur &&
        ts.isIdentifier(parent.left)
    ) {
        return parent.left.text;
    }
    // `x = (await call) ?? fallback` — still the same binding.
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        return probeBinding(parent);
    }
    return undefined;
}

/** Is the probe TOLERATED — wrapped so that "absent" flows on as a value? */
function probeIsTolerated(call, boundaryBody) {
    if (call.questionDotToken) return true;
    if (ts.isPropertyAccessExpression(call.expression) && call.expression.questionDotToken) return true;
    let cur = call.parent;
    while (cur && cur !== boundaryBody) {
        if (ts.isTryStatement(cur) && cur.catchClause) return true;
        if (isFunctionLike(cur)) return false;
        cur = cur.parent;
    }
    return false;
}

function analyzePreReadyScope(
    sf,
    relPath,
    body,
    phase,
    anchor,
    functionBodies,
    moduleBindings,
    findings,
    seams,
    unit,
    providers,
) {
    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

    /** Bodies that run synchronously as part of this phase, helpers included. */
    const bodies = [];
    const seenNames = new Set();
    const collect = (b, depth) => {
        bodies.push(b);
        if (depth >= 3) return;
        walkSameTick(b, (child) => {
            const name = calleeName(child);
            if (!name || seenNames.has(name)) return;
            const helper = functionBodies.get(name);
            if (!helper) return;
            seenNames.add(name);
            collect(helper, depth + 1);
        });
    };
    collect(body, 0);

    for (const scope of bodies) {
        walkSameTick(scope, (node) => {
            if (!ts.isCallExpression(node)) return;
            const name = calleeName(node);
            if (!name || !SERVICE_REGISTRY_PROBES.has(name)) return;
            const arg0 = node.arguments[0];
            if (!arg0 || !ts.isStringLiteralLike(arg0)) return; // non-literal → skipped, never guessed
            const service = arg0.text;
            const final = verdictIsFinal(unit, service, providers);
            const binding = probeBinding(node);
            const records = [];

            // (a) the verdict announced: a branch on the probe's answer that logs.
            // (b) the verdict persisted: a branch on the answer that writes a row.
            walkSameTick(scope, (child) => {
                let condition;
                let branches;
                if (ts.isIfStatement(child)) {
                    condition = child.expression;
                    branches = [child.thenStatement, child.elseStatement].filter(Boolean);
                } else if (ts.isConditionalExpression(child)) {
                    condition = child.condition;
                    branches = [child.whenTrue, child.whenFalse];
                } else {
                    return;
                }
                const about = binding
                    ? mentionsIdentifier(condition, binding)
                    : condition === node || mentionsIdentifier(condition, service);
                if (!about) return;
                for (const branch of branches) {
                    const inspect = (n) => {
                        // Only warn/error announce a VERDICT. `info`/`debug`
                        // narrate — `AnalyticsServicePlugin.init()` debug-logs
                        // the outcome of probing the service it provides
                        // itself, and calling that an assertion is noise.
                        const level = loggerLevel(n);
                        if (level && VERDICT_LEVELS.has(level)) {
                            records.push({ kind: 'asserted', detail: `${level} log`, line: lineOf(n) });
                        }
                        const cn = calleeName(n);
                        if (cn && PERSISTENCE_CALLEES.has(cn)) {
                            records.push({ kind: 'persisted', detail: `${cn}()`, line: lineOf(n) });
                        }
                    };
                    inspect(branch);
                    walkSameTick(branch, inspect);
                }
            });

            // (c) the verdict cached: assigned somewhere that outlives the call.
            if (binding) {
                walkSameTick(scope, (child) => {
                    if (!ts.isBinaryExpression(child)) return;
                    if (child.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
                    if (!mentionsIdentifier(child.right, binding)) return;
                    const lhs = unwrap(child.left);
                    let target;
                    if (ts.isPropertyAccessExpression(lhs) && ts.isIdentifier(lhs.name)) {
                        target =
                            lhs.expression.kind === ts.SyntaxKind.ThisKeyword
                                ? `this.${lhs.name.text}`
                                : `<obj>.${lhs.name.text}`;
                    } else if (ts.isIdentifier(lhs) && moduleBindings.has(lhs.text)) {
                        target = `module-level \`${lhs.text}\``;
                    }
                    if (target) records.push({ kind: 'cached', detail: target, line: lineOf(child) });
                });
            }

            const tolerated = probeIsTolerated(node, scope) || records.some((r) => r.kind === 'asserted');
            const seam = {
                file: relPath,
                anchor,
                phase,
                rule: 'A',
                service,
                probe: name,
                line: lineOf(node),
                tolerated,
                declared: final,
                records,
            };
            seams.push(seam);
            if (final) return;
            if (!tolerated || records.length === 0) return;
            findings.push({
                ...seam,
                why: `${SERVICE_REGISTRY_PROBES.get(name)}; ${PRE_READY_PHASES.get(phase)}`,
            });
        });
    }
}

// ── Rule B: open capability registry judged before the seal ─────────────────

/**
 * Is this `<x>.<registry>` access an ENUMERATION — the whole registry as it
 * stands right now — rather than a keyed lookup?
 *
 * `[...this.nodeExecutors.keys()]`, `for (const e of this.actionDescriptors)`,
 * `Array.from(this.nodeExecutors)`, `.size`, `.forEach(…)` all snapshot the
 * world. `this.nodeExecutors.has(type)` / `.get(type)` / `.set(type, …)` ask
 * or say something about ONE type and are how the runtime dispatches.
 */
function isEnumeration(access) {
    const parent = access.parent;
    if (parent && ts.isPropertyAccessExpression(parent) && ts.isIdentifier(parent.name)) {
        return REGISTRY_ENUMERATORS.has(parent.name.text);
    }
    if (parent && (ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent))) return true;
    if (parent && ts.isForOfStatement(parent) && parent.expression === access) return true;
    if (parent && ts.isCallExpression(parent) && parent.arguments.includes(access)) {
        // `Array.from(registry)` / `new Map(registry)` — a snapshot by another name.
        const cn = calleeName(parent);
        return cn === 'from' || cn === 'Map' || cn === 'Set';
    }
    if (parent && ts.isNewExpression(parent) && (parent.arguments ?? []).includes(access)) return true;
    return false;
}

function analyzeOpenRegistries(sf, relPath, functionBodies, findings, seams) {
    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

    /** name → { reads, logs, seals, calls, line } over the function's OWN body. */
    const units = new Map();
    const record = (name, node, bodyNode) => {
        const unit = { name, line: lineOf(node), reads: new Map(), logs: [], seals: new Set(), calls: new Set() };
        walkSameTick(bodyNode, (child) => {
            if (ts.isPropertyAccessExpression(child) && ts.isIdentifier(child.name)) {
                const member = child.name.text;
                if (OPEN_CAPABILITY_REGISTRIES.has(member) && isEnumeration(child)) {
                    if (!unit.reads.has(member)) unit.reads.set(member, lineOf(child));
                }
                for (const cfg of OPEN_CAPABILITY_REGISTRIES.values()) {
                    if (member === cfg.seal) unit.seals.add(cfg.seal);
                }
            }
            if (ts.isIdentifier(child)) {
                for (const cfg of OPEN_CAPABILITY_REGISTRIES.values()) {
                    if (child.text === cfg.seal) unit.seals.add(cfg.seal);
                }
            }
            const level = loggerLevel(child);
            if (level && VERDICT_LEVELS.has(level)) unit.logs.push({ level, line: lineOf(child) });
            const cn = calleeName(child);
            if (cn) unit.calls.add(cn);
        });
        units.set(name, unit);
    };

    walkAll(sf, (node) => {
        if (ts.isFunctionDeclaration(node) && node.name && node.body) record(node.name.text, node, node.body);
        else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
            record(node.name.text, node, node.body);
        } else if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
            node.initializer.body
        ) {
            record(node.name.text, node, node.initializer.body);
        }
    });

    if (units.size === 0) return;

    /** Transitive closure over same-file calls — hiding the read (or the warn)
     *  behind one indirection must not defeat the gate. */
    const closure = (name) => {
        const seen = new Set();
        const reads = new Map();
        const logs = [];
        const seals = new Set();
        const stack = [{ name, depth: 0 }];
        while (stack.length) {
            const { name: n, depth } = stack.pop();
            if (seen.has(n) || depth > 3) continue;
            seen.add(n);
            const u = units.get(n);
            if (!u) continue;
            for (const [member, line] of u.reads) if (!reads.has(member)) reads.set(member, { line, via: n === name ? undefined : n });
            for (const l of u.logs) logs.push({ ...l, via: n === name ? undefined : n });
            for (const s of u.seals) seals.add(s);
            for (const c of u.calls) if (!seen.has(c)) stack.push({ name: c, depth: depth + 1 });
        }
        return { reads, logs, seals, callees: seen };
    };

    const violating = new Map();
    for (const [name, unit] of units) {
        const { reads, logs, seals, callees } = closure(name);
        if (reads.size === 0) continue;
        const seam = {
            file: relPath,
            anchor: name,
            rule: 'B',
            line: unit.line,
            registries: [...reads.keys()],
            logs: logs.map((l) => `${l.level}@${l.line}${l.via ? ` via ${l.via}()` : ''}`),
            sealed: [...seals],
        };
        seams.push(seam);
        if (logs.length === 0) continue;
        const required = new Set([...reads.keys()].map((m) => OPEN_CAPABILITY_REGISTRIES.get(m).seal));
        if ([...required].every((s) => seals.has(s))) continue;
        violating.set(name, { seam, callees, required: [...required], reads });
    }

    // Report only the INNERMOST offenders: a public method that violates solely
    // because the helper it calls does would otherwise be reported twice.
    for (const [name, v] of violating) {
        const shadowed = [...v.callees].some((c) => c !== name && violating.has(c));
        if (shadowed) continue;
        const member = v.seam.registries[0];
        findings.push({
            ...v.seam,
            why: OPEN_CAPABILITY_REGISTRIES.get(member).note,
            seal: OPEN_CAPABILITY_REGISTRIES.get(member).seal,
        });
    }
}

// ── Driver ───────────────────────────────────────────────────────────────────

export function analyzeSourceFile(sf, relPath, findings, seams, providers) {
    const functionBodies = indexFunctionBodies(sf);
    const moduleBindings = moduleLevelMutableBindings(sf);
    const units = collectPluginUnits(sf);
    // Self-test / single-file use: index the providers declared in this file.
    const providerIndex = providers ?? buildProviderIndex(units);

    for (const unit of units) {
        for (const { phase, body } of unit.phases) {
            analyzePreReadyScope(
                sf,
                relPath,
                body,
                phase,
                `${unit.label}.${phase}()`,
                functionBodies,
                moduleBindings,
                findings,
                seams,
                unit,
                providerIndex,
            );
        }
    }

    analyzeOpenRegistries(sf, relPath, functionBodies, findings, seams);
}

function loadBaseline() {
    if (!existsSync(BASELINE_PATH)) return { entries: [] };
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

function baselineKey(f) {
    return f.rule === 'A' ? `${f.file}::${f.anchor}::${f.service}` : `${f.file}::${f.anchor}::${f.registries.join('+')}`;
}

function run({ list = false, packagesDir } = {}) {
    const scanRoot = packagesDir ? resolve(packagesDir) : join(ROOT, 'packages');
    const relBase = packagesDir ? resolve(packagesDir, '..') : ROOT;
    // The scan root must resolve BEFORE anything is concluded from the scan. The
    // old guard was `existsSync`, which accepts a file: the run then fell through
    // to `files.length === 0` and blamed an empty corpus for what is really a dead
    // root, naming the wrong cause on the one line the operator reads (#4930).
    let files;
    try {
        assertRootsResolvable([scanRoot]);
        files = collectSourceFiles(scanRoot);
    } catch (err) {
        if (!(err instanceof DeadRootError)) throw err;
        console.error('\n✗ startup-registry-verdict: the scan root does not resolve, so the audit would have\n' +
            '  reported a verdict over a corpus it never opened:\n');
        for (const d of err.dead) console.error(`  ${d.root} — ${d.reason}`);
        console.error(
            '\nThis check scans the workspace `packages/` tree (override with --packages-dir <p>). If the' +
            '\ndirectory was renamed or moved, point the check at it; if it was deleted, that is a' +
            '\ndeliberate decision to record. Do NOT restore a tolerant skip: the walk used to open with' +
            '\n`catch { return out; }`, which turned an unreadable directory into a silently smaller' +
            '\ncorpus (#4930).\n',
        );
        return 1;
    }
    if (files.length === 0) {
        // "Absence must be loud" — a scan that found no input must never exit 0
        // and read as a pass (#4690).
        console.error(`✗ startup-registry-verdict: no source files under ${scanRoot} — refusing to report success.`);
        return 1;
    }
    const findings = [];
    const seams = [];

    // Pass 1 — who provides what, workspace-wide. A service no workspace plugin
    // declares has no provider to order against (same reading as
    // `check-init-service-contract.mjs`), so nothing in the boot sequence can
    // turn its "absent" into "present".
    const providers = new Map();
    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        if (!text.includes('providesServices')) continue;
        const sf = parseSourceFile(file, text, ts.ScriptKind.TS);
        for (const [service, owners] of buildProviderIndex(collectPluginUnits(sf))) {
            if (!providers.has(service)) providers.set(service, new Set());
            for (const o of owners) providers.get(service).add(o);
        }
    }

    // Pass 2 — the audit.
    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        let interesting = false;
        for (const probe of SERVICE_REGISTRY_PROBES.keys()) if (text.includes(probe)) interesting = true;
        for (const registry of OPEN_CAPABILITY_REGISTRIES.keys()) if (text.includes(registry)) interesting = true;
        if (!interesting) continue;
        const sf = parseSourceFile(file, text, ts.ScriptKind.TS);
        analyzeSourceFile(sf, relative(relBase, file).split(sep).join('/'), findings, seams, providers);
    }

    if (list) {
        console.log(`\nStartup registry seams found: ${seams.length} (scanned ${files.length} files under ${scanRoot})\n`);
        for (const s of seams) {
            if (s.rule === 'A') {
                const verdict = s.records.length === 0 ? 'read-only (legal)' : s.records.map((r) => `${r.kind}:${r.detail}@${r.line}`).join(', ');
                const declared = s.declared ? `  [final: ${s.declared}]` : '';
                console.log(`  [A] ${s.file}:${s.line}  ${s.anchor} probes '${s.service}' → ${verdict}${declared}`);
            } else {
                const verdict = s.logs.length === 0 ? 'read-only (legal)' : `announces ${s.logs.join(', ')}`;
                const seal = s.sealed.length > 0 ? ` [sealed by ${s.sealed.join(', ')}]` : '';
                console.log(`  [B] ${s.file}:${s.line}  ${s.anchor} reads ${s.registries.join('+')} → ${verdict}${seal}`);
            }
        }
        console.log('');
    }

    const baseline = loadBaseline();
    const allowed = new Map((baseline.entries ?? []).map((e) => [e.key, e]));
    const violations = [];
    const used = new Set();
    for (const f of findings) {
        const key = baselineKey(f);
        if (allowed.has(key)) {
            used.add(key);
            continue;
        }
        violations.push(f);
    }
    // Shrink-only: an entry whose finding is gone must be deleted in the same PR.
    const stale = packagesDir ? [] : [...allowed.keys()].filter((k) => !used.has(k));

    let failed = false;
    if (violations.length > 0) {
        failed = true;
        console.error(
            `\n✗ ${violations.length} startup registry read(s) record a verdict the boot can still contradict (#4777):\n`,
        );
        for (const v of violations) {
            if (v.rule === 'A') {
                console.error(`  ${v.file}:${v.line}  ${v.anchor}`);
                console.error(`    reads   : ${v.probe}('${v.service}')`);
                console.error(`    why     : ${v.why}`);
                console.error(
                    `    records : ${v.records.map((r) => `${r.kind} — ${r.detail} (line ${r.line})`).join('; ')}`,
                );
                console.error(
                    `    fix     : resolve it where it is USED (a lazy accessor / a kernel:ready hook), so a provider that registers later is still seen — see plugin-auth createLazyCacheRateLimitStorage() (#4772). Reading without recording stays legal.\n`,
                );
            } else {
                console.error(`  ${v.file}:${v.line}  ${v.anchor}`);
                console.error(`    reads   : ${v.registries.join(', ')} (open capability registry)`);
                console.error(`    why     : ${v.why}`);
                console.error(`    records : announces the verdict — ${v.logs.join(', ')}`);
                console.error(
                    `    fix     : defer the verdict to the moment the vocabulary is closed and mention \`${v.seal}\` where you draw it — see AutomationEngine.sealNodeTypeVocabulary() (#4771). A read that only returns state stays legal.\n`,
                );
            }
        }
    }

    if (stale.length > 0) {
        failed = true;
        console.error(
            `\n✗ ${stale.length} stale baseline entr(ies) in scripts/startup-registry-verdict.baseline.json — the site no longer violates, so delete the entry (the baseline is shrink-only):\n`,
        );
        for (const k of stale) console.error(`  ${k}`);
        console.error('');
    }

    if (!failed) {
        const readOnly = seams.filter((s) => (s.rule === 'A' ? s.records.length === 0 : s.logs.length === 0)).length;
        console.log(
            `✓ startup registry verdicts: ${seams.length} startup/open-registry seam(s) across ${files.length} file(s), ` +
                `${readOnly} read-only (legal), none recording a verdict the boot can contradict` +
                (allowed.size > 0 ? ` (${allowed.size} baselined)` : '') +
                '.',
        );
    }
    return failed ? 1 : 0;
}

// ── Self-test ────────────────────────────────────────────────────────────────
// A checker nobody checks is the shape this gate exists to prevent. Every case
// below is a real shape from #4777's corpus, pinned in BOTH directions: the
// gate must flag the three recording shapes and must NOT flag the read-only
// probe, the deferred probe, or the sealed verdict — which are precisely what
// #4771 and #4772 were fixed INTO.
function selfTest() {
    // Every fixture is analysed on its own, so the provider index is built from
    // the fixture itself — which means each one must declare the provider it is
    // reasoning about, exactly as the workspace does. That is deliberate: it
    // exercises the ADR-0116 index rather than stubbing it out.
    const PROVIDERS = `
        class CachePlugin { name = 'com.objectstack.service.cache'; providesServices = ['cache']; }
        class MigratorPlugin { name = 'com.objectstack.migrator'; providesServices = ['migrator']; }
        class DataPlugin { name = 'com.objectstack.engine.objectql'; providesServices = ['data', 'objectql']; }
        class AutomationPlugin { name = 'com.objectstack.service.automation'; providesServices = ['automation']; }
    `;
    const cases = [
        {
            // #4772, pre-fix (packages/plugins/plugin-auth/src/auth-plugin.ts).
            name: '#4777/A flags: init() probes a service and ANNOUNCES the absence',
            code: `
                class P {
                  async init(ctx: any) {
                    let cache: any;
                    try { cache = await ctx.getServiceAsync?.('cache'); } catch { cache = undefined; }
                    if (cache && typeof cache.get === 'function') {
                      ctx.logger.info('bound to cache');
                    } else {
                      ctx.logger.warn('no cache service registered — counters are per-process');
                    }
                  }
                }`,
            expectViolation: true,
        },
        {
            // #4772, pre-fix, durable half: the verdict frozen onto the instance.
            name: '#4777/A flags: init() probes a service and CACHES the absence on the instance',
            code: `
                class P {
                  private effective: unknown;
                  async init(ctx: any) {
                    let cache: any;
                    try { cache = await ctx.getServiceAsync('cache'); } catch { cache = undefined; }
                    this.effective = cache;
                  }
                }`,
            expectViolation: true,
        },
        {
            name: '#4777/A flags: init() probe whose absence is PERSISTED',
            code: `
                class P {
                  async init(ctx: any) {
                    let svc: any;
                    try { svc = ctx.getService('migrator'); } catch { svc = undefined; }
                    if (!svc) { await ctx.getService('data').insert('sys_migration', { attested: true }); }
                  }
                }`,
            expectViolation: true,
        },
        {
            // #4772, post-fix: the probe moved into a closure resolved at use time.
            name: '#4777/A passes: probe DEFERRED into a lazily-resolved closure',
            code: `
                class P {
                  async init(ctx: any) {
                    const cfg: any = {};
                    cfg.resolveCache = async () => {
                      try { return await ctx.getServiceAsync('cache'); } catch { return undefined; }
                    };
                    this.cfg = cfg;
                  }
                  cfg: any;
                }`,
            expectViolation: false,
        },
        {
            name: '#4777/A passes: probe deferred into a kernel:ready hook',
            code: `
                class P {
                  async init(ctx: any) {
                    ctx.hook('kernel:ready', async () => {
                      let cache: any;
                      try { cache = await ctx.getServiceAsync('cache'); } catch { cache = undefined; }
                      if (!cache) ctx.logger.warn('no cache');
                    });
                  }
                }`,
            expectViolation: false,
        },
        {
            // The negative case the acceptance criteria ask for: reading is legal.
            name: '#4777/A passes: read-only probe — used, never recorded',
            code: `
                class P {
                  async init(ctx: any) {
                    const data = ctx.getService('data');
                    await data.insert('t', { a: 1 });
                  }
                }`,
            expectViolation: false,
        },
        {
            // ApprovalsServicePlugin.start() — structurally identical to the #4772
            // defect; only the PHASE tells them apart, and start() is after every
            // init(). Flagging this would turn `main` red on a correct fix.
            name: '#4777/A passes: the same shape in start() — every init() has completed by then',
            code: `
                class P {
                  async start(ctx: any) {
                    let automation: any;
                    try { automation = ctx.getService('automation'); } catch { automation = undefined; }
                    if (automation) { this.attach(automation); }
                    else { ctx.logger.warn('no automation engine — the approval node is NOT registered'); }
                  }
                  attach(a: any) { void a; }
                }`,
            expectViolation: false,
        },
        {
            name: '#4777/A passes: non-literal service name is skipped, never guessed',
            code: `
                class P {
                  async init(ctx: any) {
                    let svc: any;
                    try { svc = ctx.getService(this.options.serviceName); } catch { svc = undefined; }
                    if (!svc) ctx.logger.warn('missing');
                  }
                  options: any;
                }`,
            expectViolation: false,
        },
        {
            name: '#4777/A flags: the probe hidden behind a same-file helper init() calls',
            code: `
                class P {
                  async init(ctx: any) { this.probe(ctx); }
                  private probe(ctx: any) {
                    let cache: any;
                    try { cache = ctx.getService('cache'); } catch { cache = undefined; }
                    if (!cache) ctx.logger.warn('no cache — counters are per-process');
                  }
                }`,
            expectViolation: true,
        },
        {
            // packages/services/service-knowledge — probes `objectql` in init()
            // and caches the answer on the instance, which is legitimate BECAUSE
            // it declares the provider: the kernel hoists it ahead, so absent
            // really is absent. This is the line between it and #4772.
            name: '#4777/A passes: the probe is licensed by optionalDependencies (the kernel orders the provider ahead)',
            code: `
                class P {
                  name = 'com.objectstack.service.knowledge';
                  optionalDependencies = ['com.objectstack.engine.objectql'];
                  private svc: unknown;
                  async init(ctx: any) {
                    let engine: any;
                    try { engine = ctx.getService('objectql'); } catch { engine = undefined; }
                    this.svc = engine;
                    if (!engine) ctx.logger.warn('no data engine — pure-search mode');
                  }
                }`,
            expectViolation: false,
        },
        {
            // packages/plugins/plugin-webhooks — `requiresServices` makes the
            // kernel assert the service registered BEFORE init() runs.
            name: '#4777/A passes: the probe is licensed by requiresServices',
            code: `
                class P {
                  name = 'com.objectstack.plugin-webhook-outbox';
                  requiresServices = ['data'];
                  async init(ctx: any) {
                    const m = ctx.getService('data');
                    if (m && typeof m.register === 'function') { m.register({}); }
                    else { ctx.logger.warn('data service unavailable — objects will NOT appear'); }
                  }
                }`,
            expectViolation: false,
        },
        {
            // packages/services/service-analytics — probes the service it
            // PROVIDES itself (an idempotency check), and narrates at debug.
            name: '#4777/A passes: a plugin probing the service it provides itself',
            code: `
                class P {
                  name = 'com.objectstack.service-analytics';
                  providesServices = ['analytics'];
                  async init(ctx: any) {
                    let existing: any;
                    try { existing = ctx.getService('analytics'); } catch { existing = undefined; }
                    if (existing) { ctx.logger.warn('analytics already registered — skipping'); return; }
                    ctx.registerService('analytics', {});
                  }
                }`,
            expectViolation: false,
        },
        {
            // #4771, pre-fix (service-automation/src/engine.ts validateNodeTypes).
            name: '#4777/B flags: open node-type registry judged and announced before any seal',
            code: `
                class E {
                  private nodeExecutors = new Map<string, unknown>();
                  private actionDescriptors = new Map<string, unknown>();
                  private validateNodeTypes(flowName: string, flow: any): void {
                    const known = new Set<string>([...this.nodeExecutors.keys(), ...this.actionDescriptors.keys()]);
                    const unknown = flow.nodes.map((n: any) => n.type).filter((t: string) => !known.has(t));
                    if (unknown.length > 0) {
                      this.logger.warn('references node type(s) with no registered executor — they will fail at execution time');
                    }
                  }
                  logger: any;
                }`,
            expectViolation: true,
        },
        {
            // #4771, post-fix: the verdict is drawn only at the sealing seam.
            name: '#4777/B passes: the verdict is drawn at the declared seal',
            code: `
                class E {
                  private nodeExecutors = new Map<string, unknown>();
                  private actionDescriptors = new Map<string, unknown>();
                  private nodeTypeVocabularySealed = false;
                  private knownNodeTypes(): Set<string> {
                    return new Set<string>([...this.nodeExecutors.keys(), ...this.actionDescriptors.keys()]);
                  }
                  sealNodeTypeVocabulary(): void {
                    this.nodeTypeVocabularySealed = true;
                    const known = this.knownNodeTypes();
                    if (known.size === 0) this.logger.warn('nothing registered');
                  }
                  logger: any;
                }`,
            expectViolation: false,
        },
        {
            // The other acceptance-criteria negative, taken from the real repo:
            // getUnknownNodeTypeAudit() reads the open registry on every call and
            // returns state. Reporting is not a verdict.
            name: '#4777/B passes: read-only audit — returns state, never announces',
            code: `
                class E {
                  private nodeExecutors = new Map<string, unknown>();
                  getUnknownNodeTypeAudit(): string[] {
                    const known = new Set<string>([...this.nodeExecutors.keys()]);
                    return [...known];
                  }
                }`,
            expectViolation: false,
        },
        {
            // The real `AutomationEngine.registerNodeExecutor` — a KEYED lookup
            // that warns about what it FOUND (a duplicate). Reads the registry,
            // warns, and is not a startup verdict.
            name: '#4777/B passes: keyed lookup at registration warning about a duplicate',
            code: `
                class E {
                  private nodeExecutors = new Map<string, unknown>();
                  registerNodeExecutor(type: string, ex: unknown): void {
                    if (this.nodeExecutors.has(type)) this.logger.warn('executor replaced for ' + type);
                    this.nodeExecutors.set(type, ex);
                  }
                  logger: any;
                }`,
            expectViolation: false,
        },
        {
            // The real `AutomationEngine.refuseGatedResume` — a keyed descriptor
            // lookup at RESUME time, warning about authorization. Nothing here
            // is a boot-time membership verdict.
            name: '#4777/B passes: keyed descriptor lookup on a runtime path',
            code: `
                class E {
                  private actionDescriptors = new Map<string, any>();
                  private authority(type: string) { return this.actionDescriptors.get(type)?.resumeAuthority; }
                  private refuseGatedResume(runId: string, nodeType: string) {
                    if (this.authority(nodeType) !== 'service') return null;
                    this.logger.warn('refused resume of run ' + runId);
                    return { success: false };
                  }
                  logger: any;
                }`,
            expectViolation: false,
        },
        {
            name: '#4777/B flags: the read hidden behind one same-file indirection',
            code: `
                class E {
                  private nodeExecutors = new Map<string, unknown>();
                  private known(): Set<string> { return new Set<string>([...this.nodeExecutors.keys()]); }
                  private audit(flow: any): void {
                    const known = this.known();
                    if (flow.nodes.some((n: any) => !known.has(n.type))) this.logger.warn('will fail at execution time');
                  }
                  logger: any;
                }`,
            expectViolation: true,
        },
    ];

    let failures = 0;
    for (const c of cases) {
        const sf = parseSourceFile('t.ts', `${PROVIDERS}\n${c.code}`, ts.ScriptKind.TS);
        const findings = [];
        const seams = [];
        analyzeSourceFile(sf, 't.ts', findings, seams);
        const got = findings.length > 0;
        if (got !== c.expectViolation) {
            failures++;
            console.error(`  ✗ ${c.name}: expected violation=${c.expectViolation}, got ${got}`);
            for (const f of findings) console.error(`      → ${JSON.stringify(f)}`);
        } else {
            console.log(`  ✓ ${c.name}`);
        }
    }
    // --- Reverse proof for the dead-root hard error (#4930), made permanent. ---
    // Every case above ran green over source text held in memory, which says
    // nothing about whether the scan can reach the source text on disk. The defect
    // fixed here is an audit that reports a clean verdict *because* it could not
    // open (part of) its root. So drive the real walker over a real temporary
    // tree: require green, break the root the way a rename breaks it, require red
    // naming that root, then restore it and require the same green again.
    const expectRoot = (label, got, want) => {
        if (got !== want) {
            failures++;
            console.error(`  ✗ ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
        } else {
            console.log(`  ✓ ${label}`);
        }
    };
    const dir = mkdtempSync(join(tmpdir(), 'check-startup-registry-verdict-selftest-'));
    try {
        mkdirSync(join(dir, 'packages', 'a', 'src'), { recursive: true });
        mkdirSync(join(dir, 'packages', 'b', 'src'), { recursive: true });
        writeFileSync(join(dir, 'packages', 'a', 'src', 'x.ts'), 'export const x = 1;\n');
        writeFileSync(join(dir, 'packages', 'a', 'src', 'x.test.ts'), 'export const t = 1;\n');
        writeFileSync(join(dir, 'packages', 'b', 'src', 'y.ts'), 'export const y = 2;\n');
        const scanRoot = join(dir, 'packages');

        expectRoot('the walker reads both packages and skips the test file',
            collectSourceFiles(scanRoot).length, 2);

        // A root that is renamed away must fail by name, not scan zero files.
        const renamed = join(dir, 'packages-renamed-by-self-test');
        renameSync(scanRoot, renamed);
        let deadErr = null;
        try { assertRootsResolvable([scanRoot]); } catch (err) { deadErr = err; }
        expectRoot('a renamed scan root throws instead of quietly scanning nothing',
            deadErr instanceof DeadRootError, true);
        expectRoot('the failure names the dead root', deadErr?.roots?.join(',') ?? '<none>', scanRoot);
        expectRoot('the failure says why', deadErr?.dead?.[0]?.reason ?? '<none>', 'does not exist');

        // A root that exists but is not a directory is dead in the same way — and
        // is exactly what the old `existsSync` guard waved through.
        writeFileSync(scanRoot, 'not a directory');
        let notDirErr = null;
        try { assertRootsResolvable([scanRoot]); } catch (err) { notDirErr = err; }
        expectRoot('a scan root that is a file is dead too',
            notDirErr?.dead?.[0]?.reason ?? '<none>', 'exists but is not a directory');
        expectRoot('...and existsSync alone would have accepted it', existsSync(scanRoot), true);

        // An entry the walk cannot stat INSIDE the root is the same defect one
        // level in: `catch { continue; }` used to shrink the corpus while
        // `files.length` stayed comfortably non-zero, so the loud empty-corpus
        // guard never fired and the audit reported a clean verdict over a subject
        // it had only partly read. A dangling symlink is that case, deterministically.
        rmSync(scanRoot);
        renameSync(renamed, scanRoot);
        symlinkSync(join(dir, 'no-such-target'), join(scanRoot, 'c'));
        let partialErr = null;
        try { collectSourceFiles(scanRoot); } catch (err) { partialErr = err; }
        expectRoot('an entry the walk cannot stat is an error, not a smaller corpus',
            partialErr?.code, 'ENOENT');

        // ...and restoring the tree restores the green, so the reds above were
        // caused by the broken roots and nothing else.
        rmSync(join(scanRoot, 'c'));
        expectRoot('restoring the tree makes the walk green again', collectSourceFiles(scanRoot).length, 2);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }

    if (failures > 0) {
        console.error(`\n✗ self-test: ${failures} case(s) failed\n`);
        return 1;
    }
    console.log(`\n✓ self-test: ${cases.length} analysis case(s) + the dead-root hard error (red when the scan root is renamed, green when restored) all passed\n`);
    return 0;
}

const args = process.argv.slice(2);
// Exports bindings, so an import for those exports alone must run nothing (#10667).
const invokedDirectly = isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // imported as a module — expose the exports and do nothing else
} else if (args.includes('--self-test')) {
    process.exit(selfTest());
} else {
    const dirFlag = args.indexOf('--packages-dir');
    process.exit(
        run({
            list: args.includes('--list'),
            packagesDir: dirFlag >= 0 ? args[dirFlag + 1] : undefined,
        }),
    );
}
