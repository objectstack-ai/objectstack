// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Startup **open-vocabulary** verdicts — the authoring-side half of #4776.
 *
 * ## The pattern this names
 *
 * A boot fills its registries incrementally. Asking one "is X there?" while it
 * is still filling is fine — the answer is simply not final yet. Turning that
 * not-yet into a **verdict, and recording the verdict**, is the defect: the
 * provider registers a moment later and nothing goes back to undo the record.
 * The registry has one value for two different worlds:
 *
 * ```ts
 * const types = engine.getRegisteredNodeTypes(); // does not contain 'approval'
 * //   (a) no plugin in this deployment provides it   → the conclusion holds
 * //   (b) ApprovalsServicePlugin registers it in 0.8s → the conclusion is false
 * ```
 *
 * One showcase cold start on 2026-08-03 produced three instances of the shape
 * in three unrelated subsystems, written by three people at three times:
 * **#4771** (flow node types judged 0.8s before the `approval` executor
 * registered, phrased as "will fail at execution time"), **#4772** (an
 * `undefined` cache handle frozen into auth config, with a warning telling
 * operators to provision Redis for a problem they did not have) and **#4769**
 * (an ADR-0104 attestation written during the same boot that was still seeding
 * rows contradicting it). All three are fixed; this rule exists so the fourth
 * one is caught where it is WRITTEN.
 *
 * ## Its relationship to `pnpm check:startup-registry-verdict` (#4777 / PR #4833)
 *
 * That gate is the repo's CI enforcement of the same family, and this rule does
 * **not** restate it. Their division of labour, measured rather than assumed —
 * on 2026-08-08 the gate reported **40 seams across 1501 files under
 * `packages/`, of which 0 were in a `start()`**:
 *
 * | | `check:startup-registry-verdict` | this rule |
 * |:--|:--|:--|
 * | corpus | `packages/**` of THIS repo, via a `scripts/*.mjs` that is never published | any source string a caller hands it — a plugin in a user's app, an AI-authored extension, cloud graph-lint |
 * | phases | `constructor` + `init` (Rule A); the registry's OWNING class (Rule B) | `constructor` + `init` + **`start`**, from any consumer |
 * | registry | the kernel SERVICE registry, keyed on a literal service name; two open registries named by their `this.<prop>` | the **open capability vocabularies** ADR-0018 keeps runtime-extensible, matched by ACCESSOR name so a consumer package is visible |
 * | evidence | the shape of the record | the shape of the record **and the wording of the diagnostic** |
 *
 * The service-registry half (`getService('cache')` in `init()`, cleared by an
 * ADR-0116 `dependencies`/`requiresServices` declaration) is deliberately left
 * to the gate and is NOT re-implemented here. It needs the plugin-manifest model
 * the gate already carries, and answering one question in two vocabularies is
 * how vocabularies rot (#5841). What this rule adds is the region the gate
 * declares out of reach: the phase it does not enter, the consumer packages
 * Rule B cannot see, and the population — plugin authors outside this repo —
 * that a `scripts/` file never reaches at all.
 *
 * ## What it checks
 *
 * Inside a plugin lifecycle phase that runs BEFORE the vocabulary can be sealed
 * (`constructor` / `init` / `start` — see {@link PRE_SEAL_PHASES}), all three of:
 *
 *   1. a read of an **open** capability vocabulary ({@link OPEN_VOCABULARY_PROBES}) —
 *      one a plugin may still contribute to from its own `init()`/`start()`;
 *   2. a terminal conclusion drawn from what is (not) in it;
 *   3. that conclusion **recorded** — announced in a `warn`/`error`/`fatal` log,
 *      cached in an instance field or module binding, or persisted.
 *
 * All three, or it is not a finding. A read-only probe is completely legal and
 * must not be flagged: `AutomationEngine.getUnknownNodeTypeAudit()` reads the
 * executor registry on every call, records nothing, and is correct.
 *
 * When a site is flagged, its diagnostic TEXT is judged too
 * ({@link STARTUP_VERDICT_ASSERTIVE_WORDING}): a message that asserts a terminal
 * outcome about a world that has not finished forming ("will fail at execution
 * time", "you need Redis") is the half of #4771/#4772 that hurt operators most,
 * and the gate never reads message text. That second finding is emitted ONLY at
 * a site rule 1 already flagged, so it can add no false positive of its own.
 *
 * ## The escapes — the three sanctioned cures, recognised by shape
 *
 *   - **Deferral.** Nested function bodies are never descended into. A callback
 *     registered during the phase (`ctx.hook('kernel:ready', …)`, `on(...)`, a
 *     lazily-resolved closure) runs when the registry IS complete — that is what
 *     #4771 and #4772 were fixed INTO, so treating it as a violation would flag
 *     the cure. Same choice, same reason, as the CI gate.
 *   - **Lazy resolution.** Same mechanism: `createLazyCacheRateLimitStorage()`
 *     (plugin-auth, #4772's fix) resolves inside the accessor it returns.
 *   - **Seal, then judge.** A scope that mentions the vocabulary's seal
 *     ({@link SEAL_MARKERS}) has asked the host whether the world is closed;
 *     `AutomationEngine.sealNodeTypeVocabulary()` (#4771's fix) is the reference.
 *
 * ## What it cannot see (stated up front, not discovered later)
 *
 * This is a declared vocabulary over syntax. Its reach is exactly as wide as the
 * vocabulary and no wider:
 *
 *   1. `engine.getRegisteredNodeTypes()` is visible; a `resolveTypesOrDefault()`
 *      three layers down another package is not. Helper following is same-file
 *      and two levels deep.
 *   2. **#4769 is out of reach, deliberately.** Its "registry" is the
 *      `sys_migration` table, and the write that recorded the verdict is
 *      syntactically indistinguishable from ordinary first-boot seeding ("no
 *      rows → insert the defaults"), which is legitimate and common. A rule that
 *      flagged it would flag every seeder. It is a fixture for the family
 *      because its FIX is instructive, not because a syntactic rule finds it —
 *      the same admission the CI gate makes.
 *   3. A vocabulary read through a name not in {@link OPEN_VOCABULARY_PROBES} is
 *      skipped rather than guessed. Found a new open registry? Add its accessor
 *      here, in the same change that fixes the site.
 *
 * Widening any of these trades a miss for a false positive, and false positives
 * kill an advisory rule faster than misses do.
 *
 * ## Severity
 *
 * Always `warning`. The rule reasons about a boot sequence it cannot execute, so
 * it advises where it is confident and never gates — the same posture as
 * `lintUnknownAuthoringKeys` (#3786) and `validateHookBodyWrites` (#4271).
 */

import { createRequire } from 'node:module';
import type ts from 'typescript';

import { createSourceFileChecked, describeParseFailure, PARSE_FAILURE_HINT } from './checked-parse.js';

// The TypeScript compiler must NOT be imported at module top level: it is ~9 MB
// of CJS and @objectstack/lint sits on the kernel boot path, while this rule
// only parses when a caller actually hands it source. Same lazy-load contract as
// validate-hook-body-writes.ts / validate-react-page-props.ts, guarded by
// lazy-deps.test.ts.
//
// `node:module` is a Node builtin, untouched by esbuild/tsup, so the static
// `createRequire` import survives bundling; the `createRequire(...)` call is
// deferred because `import.meta.url` is rewritten to an empty stub in the CJS
// build.
let cachedTs: typeof ts | null = null;
function loadTypeScript(): typeof ts {
  if (cachedTs) return cachedTs;
  const anchor =
    typeof import.meta !== 'undefined' && import.meta.url
      ? import.meta.url
      : typeof __filename !== 'undefined'
        ? __filename
        : process.cwd() + '/';
  try {
    cachedTs = createRequire(anchor)('typescript') as typeof ts;
  } catch (err) {
    throw new Error(
      `@objectstack/lint: checking plugin source for startup registry verdicts requires the "typescript" ` +
        `package, which could not be loaded (${err instanceof Error ? err.message : String(err)}). It is a ` +
        `declared dependency of @objectstack/lint — if this deployment prunes packages, keep "typescript" in ` +
        `the image; it is only loaded when plugin source is actually checked.`,
    );
  }
  return cachedTs;
}

// ── Rule ids ─────────────────────────────────────────────────────────────────

/**
 * A verdict about an open capability vocabulary, recorded during a phase in
 * which a plugin can still contribute to it.
 */
export const STARTUP_OPEN_VOCABULARY_VERDICT = 'startup-open-vocabulary-verdict';

/**
 * The diagnostic at such a site asserts a terminal outcome about a world that
 * has not finished forming. Emitted only where
 * {@link STARTUP_OPEN_VOCABULARY_VERDICT} already fired.
 */
export const STARTUP_VERDICT_ASSERTIVE_WORDING = 'startup-verdict-assertive-wording';

/**
 * The source could not be parsed, so this rule's verdict about it covers only
 * what error recovery left standing (#10653).
 *
 * This rule's own subject matter, turned on the rule: a terminal conclusion
 * drawn about a world that had not finished forming. "No findings" about a
 * source the parser could not read is exactly that, and it is what this module
 * used to return — silently, with a `catch` above it that never ran.
 */
export const STARTUP_SOURCE_UNPARSEABLE = 'startup-source-unparseable';

// ── The vocabulary (词表) ────────────────────────────────────────────────────

/**
 * Accessors that read a capability vocabulary a plugin can still extend.
 *
 * Each entry names WHY the answer is not final; the note travels into the
 * finding so the author reads the consequence rather than a rule id.
 *
 * Matched on the accessor NAME rather than on a `this.<registry>` property,
 * which is what lets a consumer in another package be seen at all — the CI
 * gate's Rule B is keyed on the two property names the owning class uses, so a
 * caller that reaches the same vocabulary through its public accessor is
 * invisible to it. Keyed lookups that ask about ONE item and dispatch on the
 * answer (`registry.get(type)`, `registry.has(type)`) are deliberately absent:
 * that is how the runtime legitimately resolves work, and reading it as a
 * startup verdict is exactly the false-positive class that gets a rule switched
 * off.
 */
export const OPEN_VOCABULARY_PROBES: ReadonlyMap<string, string> = new Map([
  [
    'getRegisteredNodeTypes',
    'ADR-0018 keeps the flow node-type vocabulary open and runtime-extensible — a plugin registers its executor from its own init()/start(), which can be after this line (#4771)',
  ],
  [
    'knownNodeTypes',
    'ADR-0018 keeps the flow node-type vocabulary open and runtime-extensible — a plugin registers its executor from its own init()/start(), which can be after this line (#4771)',
  ],
  [
    'getUnknownNodeTypeAudit',
    'the unknown-node-type audit is a snapshot of an OPEN vocabulary a plugin can still extend during boot; it is read-only by design and answers "unknown as of now", never "unknown for this deployment" (#4771)',
  ],
  [
    'getActionDescriptors',
    'ADR-0018 action descriptors are published by plugins during boot, so a type missing from them here means "not published YET" (#4771)',
  ],
  [
    'getRegisteredExecutors',
    'executors are contributed by plugins during boot — an executor missing here may simply be a plugin that has not started',
  ],
  [
    'listExecutors',
    'executors are contributed by plugins during boot — an executor missing here may simply be a plugin that has not started',
  ],
  [
    'getRegisteredTools',
    'AI tools are contributed by plugins during boot, so the registered set is not final until every plugin has started',
  ],
  [
    'listConnectors',
    'connectors are contributed by plugins during boot (StackSchema.connectors documents provider-bound instances registered by plugins), so the list is not final until every plugin has started',
  ],
  [
    'getRegisteredConnectors',
    'connectors are contributed by plugins during boot, so the registered set is not final until every plugin has started',
  ],
  [
    'listCapabilities',
    'ADR-0066 capabilities are declared by every installed package, so the set is not final until every plugin has contributed its declarations',
  ],
  [
    'getRegisteredCapabilities',
    'ADR-0066 capabilities are declared by every installed package, so the set is not final until every plugin has contributed its declarations',
  ],
  [
    'listProviders',
    'providers are contributed by plugins during boot — a provider missing here may simply be a plugin that has not started',
  ],
  [
    'getRegisteredProviders',
    'providers are contributed by plugins during boot — a provider missing here may simply be a plugin that has not started',
  ],
]);

/**
 * Lifecycle phases that run BEFORE the vocabulary can be considered closed, with
 * the reason each one is still open.
 *
 * `start` is the phase this rule exists for. The CI gate stops at `init`, on the
 * sound reasoning that every plugin's `init()` has completed by then — true of
 * the SERVICE registry, and false of an open capability vocabulary: ADR-0018
 * executors are registered from `start()` too, and sibling plugins' `start()`
 * have not all run. That is literally where #4771 sat.
 */
export const PRE_SEAL_PHASES: ReadonlyMap<string, string> = new Map([
  ['constructor', 'the constructor runs at composition time — before ANY plugin has been initialized'],
  ['init', "another plugin's init() may not have run yet (ADR-0116), so the vocabulary is still filling"],
  [
    'start',
    "sibling plugins' start() have not all run, and ADR-0018 lets a plugin register its contributions from start() — the vocabulary is still filling",
  ],
]);

/**
 * Identifier fragments whose presence in the scope means the code ASKED whether
 * the vocabulary is closed before judging it — the third sanctioned cure.
 * Matched as a case-insensitive substring of an identifier so
 * `nodeTypeVocabularySealed`, `sealNodeTypeVocabulary` and a host's own
 * `vocabularySeal` all count.
 */
export const SEAL_MARKERS: readonly string[] = ['seal'];

/** Log levels at which a conclusion is ANNOUNCED rather than narrated. */
const VERDICT_LEVELS = new Set(['warn', 'error', 'fatal']);

/** Every level the logger-shape matcher recognises (so `info`/`debug` are seen and then ignored). */
const ALL_LEVELS = new Set(['warn', 'error', 'fatal', 'info', 'debug', 'trace', 'log']);

/** Calls that write a verdict somewhere that survives the process. */
const PERSISTENCE_CALLEES = new Set(['insert', 'insertOne', 'update', 'updateOne', 'upsert', 'save', 'saveMetaItem']);

/**
 * Phrases that assert a TERMINAL outcome about a world that has not finished
 * forming. Each is the wording of a real regression:
 *
 *  - "will fail at execution time" — #4771's eight false alarms per cold boot;
 *  - "nothing will register" / "no plugin provides" — the same claim, restated;
 *  - "you need" / "must install" / "must be provisioned" — #4772's misdirecting
 *    remedy: an operator who followed it connected Redis and got the identical
 *    warning.
 *
 * The honest wordings are the ones that keep the two worlds apart — "not
 * registered yet", "as of this point in the boot", "if no plugin contributes it".
 */
const ASSERTIVE_PHRASES: readonly string[] = [
  'will fail',
  'fails at execution',
  'nothing will register',
  'no plugin provides',
  'is not installed',
  'is not configured',
  'you need',
  'you must install',
  'must be provisioned',
];

/** Wordings that keep "not yet" and "not at all" apart — their presence clears the wording finding. */
const HEDGE_PHRASES: readonly string[] = [
  'not yet',
  'yet been registered',
  'so far',
  'as of',
  'may still',
  'might still',
  'still be registered',
  'has started',
  'have started',
];

// ── Finding shape ────────────────────────────────────────────────────────────

export type StartupRegistryVerdictSeverity = 'warning';

export interface StartupRegistryVerdictFinding {
  /** Always `warning` — this rule advises, it never gates (see module note). */
  severity: StartupRegistryVerdictSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `AutomationServicePlugin.start()`. */
  where: string;
  /** Source path, e.g. `plugin.ts:412`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

/**
 * The prescription every finding carries. It names the three cures in the order
 * AGENTS.md ranks them, and each by the change that actually shipped, so the
 * reader can go and read one.
 *
 * It states no verdict of its own about whether the site is broken at runtime —
 * asserting a terminal outcome about a world that has not finished forming is
 * the mistake this rule exists to remove, and a hint that did it would be the
 * defect wearing the rule's own badge.
 */
export const STARTUP_VERDICT_HINT =
  'Take one of the three shapes the fixes took: ' +
  "(1) resolve where the value is USED, not where you start — a lazy accessor or a `kernel:ready`/`kernel:bootstrapped` hook sees a provider that registered later (`createLazyCacheRateLimitStorage()` in plugin-auth, #4772); " +
  '(2) seal the vocabulary, then judge — have the host declare the moment it can no longer grow and draw the conclusion there (`AutomationEngine.sealNodeTypeVocabulary()`, called at `kernel:bootstrapped`, #4771); ' +
  '(3) order the verdict AFTER the mutation it describes, so it cannot attest to a state this same boot goes on to contradict (the ADR-0104 attestation, #4769). ' +
  'If the conclusion must stay here, keep the two worlds apart in the wording: "no executor registered YET (as of plugin start)" is true; "will fail at execution time" is a claim about a world that has not finished forming.';

// ── AST helpers ──────────────────────────────────────────────────────────────

type Ts = typeof ts;

function isFunctionLike(t: Ts, node: ts.Node): boolean {
  return (
    t.isFunctionDeclaration(node) ||
    t.isFunctionExpression(node) ||
    t.isArrowFunction(node) ||
    t.isMethodDeclaration(node) ||
    t.isConstructorDeclaration(node) ||
    t.isGetAccessorDeclaration(node) ||
    t.isSetAccessorDeclaration(node)
  );
}

/**
 * Walk `node`'s subtree WITHOUT entering bodies that run later.
 *
 * This is the mechanism behind two of the three cures: a `kernel:ready` callback
 * and a lazy accessor are both nested function bodies, so neither is ever
 * reached — the rule cannot flag the shape the fixes were fixed INTO.
 */
function walkSameTick(t: Ts, node: ts.Node, visit: (n: ts.Node) => void): void {
  node.forEachChild((child) => {
    if (isFunctionLike(t, child) || t.isClassDeclaration(child) || t.isClassExpression(child)) return;
    visit(child);
    walkSameTick(t, child, visit);
  });
}

/** Walk everything, nested bodies included. */
function walkAll(t: Ts, node: ts.Node, visit: (n: ts.Node) => void): void {
  node.forEachChild((child) => {
    visit(child);
    walkAll(t, child, visit);
  });
}

function calleeName(t: Ts, node: ts.Node): string | undefined {
  if (!t.isCallExpression(node)) return undefined;
  const expr = node.expression;
  if (t.isIdentifier(expr)) return expr.text;
  if (t.isPropertyAccessExpression(expr) && t.isIdentifier(expr.name)) return expr.name.text;
  return undefined;
}

/**
 * `logger.warn(…)` / `this.log.error(…)` / `console.error(…)` → the level.
 * Matched on the SHAPE `<logger|log|console>.<level>(…)` so a renamed local
 * (`const log = ctx.logger`) is still seen — same matcher the CI gates use.
 */
function loggerLevel(t: Ts, node: ts.Node): string | undefined {
  if (!t.isCallExpression(node)) return undefined;
  const expr = node.expression;
  if (!t.isPropertyAccessExpression(expr) || !t.isIdentifier(expr.name)) return undefined;
  const level = expr.name.text;
  if (!ALL_LEVELS.has(level)) return undefined;
  const receiver = expr.expression;
  let receiverName: string | undefined;
  if (t.isIdentifier(receiver)) receiverName = receiver.text;
  else if (t.isPropertyAccessExpression(receiver) && t.isIdentifier(receiver.name)) receiverName = receiver.name.text;
  if (!receiverName) return undefined;
  return /^(logger|log|console)$/i.test(receiverName) ? level : undefined;
}

/** Every string literal / template chunk in a node's subtree, lower-cased and joined. */
function literalText(t: Ts, node: ts.Node): string {
  const parts: string[] = [];
  const take = (n: ts.Node) => {
    if (t.isStringLiteralLike(n)) parts.push(n.text);
    else if (t.isTemplateHead(n) || t.isTemplateMiddle(n) || t.isTemplateTail(n)) parts.push(n.text);
  };
  take(node);
  walkAll(t, node, take);
  return parts.join(' ').toLowerCase();
}

/** Does this subtree mention an identifier containing one of the seal markers? */
function mentionsSeal(t: Ts, node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (t.isIdentifier(n)) {
      const lower = n.text.toLowerCase();
      if (SEAL_MARKERS.some((m) => lower.includes(m))) found = true;
    }
  };
  visit(node);
  walkAll(t, node, visit);
  return found;
}

/** Module-level `let`/`var` names — assigning one records a verdict for the process. */
function moduleLevelMutableBindings(t: Ts, sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const st of sf.statements) {
    if (!t.isVariableStatement(st)) continue;
    if (st.declarationList.flags & t.NodeFlags.Const) continue;
    for (const d of st.declarationList.declarations) {
      if (t.isIdentifier(d.name)) names.add(d.name.text);
    }
  }
  return names;
}

/**
 * Index every named function-like body in the file so a call can be followed to
 * what it does. Keyed by bare name — a same-file collision can only make the
 * analysis see MORE, never less, which is the safe direction for a rule whose
 * finding requires three parts to coincide.
 */
function indexFunctionBodies(t: Ts, sf: ts.SourceFile): Map<string, ts.Node> {
  const byName = new Map<string, ts.Node>();
  walkAll(t, sf, (node) => {
    if (t.isFunctionDeclaration(node) && node.name && node.body) byName.set(node.name.text, node.body);
    else if (t.isMethodDeclaration(node) && t.isIdentifier(node.name) && node.body) byName.set(node.name.text, node.body);
    else if (
      t.isVariableDeclaration(node) &&
      t.isIdentifier(node.name) &&
      node.initializer &&
      (t.isArrowFunction(node.initializer) || t.isFunctionExpression(node.initializer)) &&
      node.initializer.body
    ) {
      byName.set(node.name.text, node.initializer.body);
    }
  });
  return byName;
}

// ── Plugin lifecycle units ───────────────────────────────────────────────────

interface Phase {
  phase: string;
  body: ts.Node;
}

interface LifecycleUnit {
  label: string;
  phases: Phase[];
}

/**
 * Classes and object literals that carry a plugin lifecycle.
 *
 * The membership test is `init` or `start` — the pair that makes something a
 * plugin to the kernel. A class with neither is not on the boot path in a way
 * this rule can reason about, and reading its `constructor` would flag ordinary
 * construction-time work.
 */
function collectLifecycleUnits(t: Ts, sf: ts.SourceFile): LifecycleUnit[] {
  const units: LifecycleUnit[] = [];

  const readClass = (node: ts.ClassDeclaration | ts.ClassExpression) => {
    const phases: Phase[] = [];
    let hasLifecycle = false;
    for (const member of node.members) {
      if (t.isMethodDeclaration(member) && t.isIdentifier(member.name)) {
        if (member.name.text === 'init' || member.name.text === 'start') hasLifecycle = true;
      } else if (
        t.isPropertyDeclaration(member) &&
        t.isIdentifier(member.name) &&
        (member.name.text === 'init' || member.name.text === 'start') &&
        member.initializer &&
        (t.isArrowFunction(member.initializer) || t.isFunctionExpression(member.initializer))
      ) {
        hasLifecycle = true;
      }
    }
    if (!hasLifecycle) return;
    for (const member of node.members) {
      if (t.isConstructorDeclaration(member) && member.body) {
        phases.push({ phase: 'constructor', body: member.body });
      } else if (t.isMethodDeclaration(member) && t.isIdentifier(member.name) && member.body) {
        if (PRE_SEAL_PHASES.has(member.name.text)) phases.push({ phase: member.name.text, body: member.body });
      } else if (
        t.isPropertyDeclaration(member) &&
        t.isIdentifier(member.name) &&
        PRE_SEAL_PHASES.has(member.name.text) &&
        member.initializer &&
        (t.isArrowFunction(member.initializer) || t.isFunctionExpression(member.initializer)) &&
        member.initializer.body
      ) {
        phases.push({ phase: member.name.text, body: member.initializer.body });
      }
    }
    if (phases.length) units.push({ label: node.name?.text ?? '<anonymous class>', phases });
  };

  const readObjectLiteral = (node: ts.ObjectLiteralExpression) => {
    const phases: Phase[] = [];
    let name: string | undefined;
    let hasLifecycle = false;
    for (const prop of node.properties) {
      if (!t.isPropertyAssignment(prop) || !t.isIdentifier(prop.name)) continue;
      const key = prop.name.text;
      if (key === 'name' && t.isStringLiteralLike(prop.initializer)) name = prop.initializer.text;
      if ((key === 'init' || key === 'start') && isFunctionLike(t, prop.initializer)) hasLifecycle = true;
      if (
        PRE_SEAL_PHASES.has(key) &&
        (t.isArrowFunction(prop.initializer) || t.isFunctionExpression(prop.initializer)) &&
        prop.initializer.body
      ) {
        phases.push({ phase: key, body: prop.initializer.body });
      }
    }
    // An object literal with no `name` is not a plugin — the kernel keys the
    // registry on it, so its absence means this is some other options bag that
    // happens to carry an `init`.
    if (!name || !hasLifecycle || !phases.length) return;
    units.push({ label: `${name} (object plugin)`, phases });
  };

  walkAll(t, sf, (node) => {
    if (t.isClassDeclaration(node) || t.isClassExpression(node)) readClass(node);
    else if (t.isObjectLiteralExpression(node)) readObjectLiteral(node);
  });
  return units;
}

// ── The rule ─────────────────────────────────────────────────────────────────

export interface StartupRegistryVerdictOptions {
  /**
   * Label for the source under check — a path, a package name, whatever the
   * caller can point at. Prefixes every finding's `path`.
   */
  file?: string;
}

interface VerdictRecord {
  kind: 'announced' | 'cached' | 'persisted';
  detail: string;
  line: number;
  /** The node that did the recording — the wording check reads its text. */
  node: ts.Node;
}

/**
 * Find startup open-vocabulary verdicts in one TypeScript/JavaScript source.
 *
 * Pure: parses, never executes, never type-checks, touches no filesystem. An
 * unparseable source is REPORTED ({@link STARTUP_SOURCE_UNPARSEABLE}) rather
 * than thrown on — this advises on source someone else owns, so refusing to
 * parse is not a verdict about them, but going silent about it was a verdict
 * too, and the wrong one (#10653).
 */
export function findStartupRegistryVerdicts(
  source: string,
  options: StartupRegistryVerdictOptions = {},
): StartupRegistryVerdictFinding[] {
  if (!source || !source.trim()) return [];
  // Cheap pre-filter: when no accessor from the vocabulary appears anywhere in
  // the text, nothing can match and the ~9 MB parser stays unloaded. This is
  // what makes a whole-corpus sweep affordable.
  let mentionsAny = false;
  for (const probe of OPEN_VOCABULARY_PROBES.keys()) {
    if (source.includes(probe)) {
      mentionsAny = true;
      break;
    }
  }
  if (!mentionsAny) return [];

  const t = loadTypeScript();
  const fileLabel = options.file ?? 'source';
  // [#10653] The parse used to sit in a `try/catch` returning `[]`. The catch
  // never ran — `createSourceFile` cannot throw (measured; see checked-parse.ts)
  // — so the live path was the unread `parseDiagnostics`: a recovered partial
  // tree walked and reported clean. The tree is still walked, so every finding
  // this rule produces today it still produces; what is added is the signal that
  // the reading was partial.
  const { sourceFile: sf, failure } = createSourceFileChecked(t, fileLabel, source, {
    target: t.ScriptTarget.Latest,
    setParentNodes: true,
    scriptKind: t.ScriptKind.TS,
  });

  const findings: StartupRegistryVerdictFinding[] = [];
  if (failure) {
    findings.push({
      severity: 'warning',
      rule: STARTUP_SOURCE_UNPARSEABLE,
      where: fileLabel,
      path: `${fileLabel}:${failure.line}`,
      message:
        `source did not parse (${describeParseFailure(failure)}), so this rule read a partially recovered ` +
        `tree — a startup verdict in the unread part is not reported.`,
      hint: PARSE_FAILURE_HINT,
    });
  }
  const moduleBindings = moduleLevelMutableBindings(t, sf);
  const functionBodies = indexFunctionBodies(t, sf);
  const lineOf = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  for (const unit of collectLifecycleUnits(t, sf)) {
    for (const { phase, body } of unit.phases) {
      // The bodies that run synchronously as part of this phase — the phase body
      // itself plus the same-file helpers it calls, two levels deep. #4771's
      // read and its warn sat in different methods.
      const scopes: ts.Node[] = [];
      const seenNames = new Set<string>();
      const collect = (b: ts.Node, depth: number) => {
        scopes.push(b);
        if (depth >= 2) return;
        walkSameTick(t, b, (child) => {
          const name = calleeName(t, child);
          if (!name || seenNames.has(name)) return;
          const helper = functionBodies.get(name);
          if (!helper) return;
          seenNames.add(name);
          collect(helper, depth + 1);
        });
      };
      collect(body, 0);

      // (1) the read.
      const reads: Array<{ probe: string; node: ts.Node }> = [];
      for (const scope of scopes) {
        walkSameTick(t, scope, (node) => {
          const name = calleeName(t, node);
          if (name && OPEN_VOCABULARY_PROBES.has(name)) reads.push({ probe: name, node });
        });
      }
      if (!reads.length) continue;

      // The seal escape: somewhere in this phase's synchronous reach, the code
      // asked whether the vocabulary is closed. That is cure (2), and it is a
      // property of the SCOPE rather than of one expression — the seal flag is
      // typically read in a guard several statements above the judgement.
      if (scopes.some((scope) => mentionsSeal(t, scope))) continue;

      // (3) the record. Same-tick only: a record made inside a nested body runs
      // later, which is cure (1).
      const records: VerdictRecord[] = [];
      for (const scope of scopes) {
        walkSameTick(t, scope, (node) => {
          const level = loggerLevel(t, node);
          if (level && VERDICT_LEVELS.has(level)) {
            records.push({ kind: 'announced', detail: `${level} log`, line: lineOf(node), node });
            return;
          }
          const cn = calleeName(t, node);
          if (cn && PERSISTENCE_CALLEES.has(cn)) {
            records.push({ kind: 'persisted', detail: `${cn}()`, line: lineOf(node), node });
            return;
          }
          if (t.isBinaryExpression(node) && node.operatorToken.kind === t.SyntaxKind.EqualsToken) {
            const lhs = node.left;
            let target: string | undefined;
            if (t.isPropertyAccessExpression(lhs) && t.isIdentifier(lhs.name)) {
              target =
                lhs.expression.kind === t.SyntaxKind.ThisKeyword ? `this.${lhs.name.text}` : `<obj>.${lhs.name.text}`;
            } else if (t.isIdentifier(lhs) && moduleBindings.has(lhs.text)) {
              target = `module-level \`${lhs.text}\``;
            }
            if (target) records.push({ kind: 'cached', detail: target, line: lineOf(node), node });
          }
        });
      }
      if (!records.length) continue;

      const read = reads[0];
      const record = records[0];
      const where = `${unit.label}.${phase}${phase === 'constructor' ? '' : '()'}`;
      const note = OPEN_VOCABULARY_PROBES.get(read.probe)!;
      const phaseNote = PRE_SEAL_PHASES.get(phase)!;

      findings.push({
        severity: 'warning',
        rule: STARTUP_OPEN_VOCABULARY_VERDICT,
        where,
        path: `${fileLabel}:${lineOf(read.node)}`,
        message:
          `\`${read.probe}()\` reads a vocabulary that is still filling, and the conclusion is recorded ` +
          `(${record.kind}: ${record.detail}, line ${record.line}). ${note}; ${phaseNote}. ` +
          `"absent" here has two meanings the recorded verdict cannot tell apart — no provider in this ` +
          `deployment, or a provider that registers later in this same boot — and nothing retracts the ` +
          `record when the second one turns out to be the case (#4771 / #4772).`,
        hint: STARTUP_VERDICT_HINT,
      });

      // The wording half — only ever at a site already flagged above, so it can
      // contribute no false positive of its own.
      for (const rec of records) {
        if (rec.kind !== 'announced') continue;
        const text = literalText(t, rec.node);
        if (!text) continue;
        if (HEDGE_PHRASES.some((h) => text.includes(h))) continue;
        const hit = ASSERTIVE_PHRASES.find((p) => text.includes(p));
        if (!hit) continue;
        findings.push({
          severity: 'warning',
          rule: STARTUP_VERDICT_ASSERTIVE_WORDING,
          where,
          path: `${fileLabel}:${rec.line}`,
          message:
            `the diagnostic says "${hit}" about a vocabulary that can still grow during this boot. ` +
            `#4771 printed "will fail at execution time" for eight approval flows 0.8s before the executor ` +
            `that runs them was registered, and a deployment that genuinely lacked the plugin printed the ` +
            `identical eight — so the line could not tell an operator which of the two they had. #4772's ` +
            `remedy ("you need Redis") sent operators to fix a problem they did not have, and connecting ` +
            `Redis did not change the message.`,
          hint: STARTUP_VERDICT_HINT,
        });
      }
    }
  }

  return findings;
}
