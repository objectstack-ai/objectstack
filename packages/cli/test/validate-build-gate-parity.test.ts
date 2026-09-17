// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `os validate` is documented — and relied on by CI setups — as the READ-ONLY
 * SUPERSET of the gates `os build` runs: same checks, no artifact emitted. That
 * contract had no enforcement, so it drifted (#3782): four authoring lints were
 * wired into `compile.ts` only, two of them already emitting `severity: 'error'`,
 * so `os validate` reported a clean stack that `os build` then rejected.
 *
 * ## What changed, and what this file still guards
 *
 * The metadata rules the two commands share now come from ONE table
 * (`@objectstack/lint`'s `authoring-rules.ts`, #4409/#4463), and its own ratchet —
 * `src/commands/authoring-rule-wiring.test.ts` — proves all three authoring
 * commands run the identical gating set. That is a stronger guarantee than the
 * source diff this file used to do, and it covers `os lint` too.
 *
 * What the registry CANNOT cover is the gates that are not pure functions of the
 * stack: the capability-provider preflight reads `node_modules`, the docs lint
 * reads `src/docs/`, the access-matrix snapshot reads a file next to the config.
 * Those are still hand-wired per command, so they can still drift — and one of
 * them already had. `collectAndLintDocs` gated `os build` and never ran on
 * `os validate`, invisible for the same reason the #3782 four were: the old
 * scan keyed on the `lint*`/`validate*` naming convention, and this gate is
 * named `collect*`. This file now names each shared gate explicitly instead of
 * pattern-matching for them.
 *
 * Source-level rather than behavioural on purpose: it fails when a gate is ADDED
 * to the build without being added to validate, which is the moment the mistake
 * is cheap to fix — not later, when some app trips it.
 */

const COMMANDS_DIR = join(__dirname, '..', 'src', 'commands');

/**
 * Gates that are NOT registry rules — they need the filesystem, the emitted
 * artifact, or the whole ARTIFACT across its packages, and none of those is a
 * pure function of the ONE stack `runAuthoringRules` hands a rule — and that
 * both commands must therefore wire by hand.
 *
 * Adding a gate to `compile.ts` means adding it here and to `validate.ts`, or
 * to `BUILD_ONLY_GATES` below with a reason. There is no third option — that is
 * the whole point of the file.
 *
 * ⭐ [#18491] This roster is now CLOSED rather than advisory: every bare
 * identifier either command calls must appear in exactly one of the three
 * ledgers in this file — here, in {@link BUILD_ONLY_GATES}, or in
 * {@link NOT_A_GATE} with the reason it is not a gate. A name nobody
 * classified fails, so a gate arrives here by being ADDED to the commands, not
 * by being spelled a particular way.
 */
const SHARED_NON_REGISTRY_GATES: readonly string[] = [
  // [#3366] Resolves each `requires` token's provider in the active edition.
  'preflightRequiredCapabilities',
  // [#3786] The pre-parse undeclared-key diff, both halves.
  'lintUnknownStackKeys',
  'lintUnknownAuthoringKeys',
  // [ADR-0046] Package docs: flatness, prefixed names, MDX/image ban, links.
  'collectAndLintDocs',
  // [#16544] The pre-parse lowering of inline `function` handlers to a
  // metadata `body` + string ref. It refuses nothing itself; it decides what
  // the parse — and the registry's `parsed` tier — SEES. Build-only until
  // #16544, on the reasoning that "there is nothing to lower when nothing is
  // emitted": measured false, because the `hook-body-*` /
  // `hook-api-update-readonly-*` family opens on `body.language === 'js'`, so
  // on the un-lowered stack `os validate` passed a handler-authored hook `os
  // build` refuses. Both doors run the same call, between the two key lints
  // above and the parse.
  'lowerCallables',
  // [#18024] Permission sets declared under a name another package in the SAME
  // artifact owns — the compile-time half of #17516's runtime refusal. Neither
  // the filesystem nor the emitted artifact, but cross-package by construction:
  // the name is declared by package A and declared again by package B, so the
  // per-package walk a registry rule gets sees one half at a time.
  'findPermissionSetNameCollisions',
  // [#14553] Navigation contributions aimed at a group the target app does not
  // declare. Reports, never refuses. Not a registry rule: it is judged across
  // the whole ARTIFACT — a contribution in package A against an app declared in
  // package B — so the per-package stack a rule is handed sees one side only.
  //
  // ⭐ This row is #18491's positive control, and it is the reason that card
  // exists. The gate has been hand-wired into BOTH commands since #14553 and
  // appeared in NO roster, because the pre-#18491 extractor matched
  // `lintFoo(`/`validateFoo(` and this gate is named `find*`. It was held by
  // nothing at all: had one of the two wirings been dropped, every assertion in
  // this file would have stayed green.
  'findNavGroupDiagnostics',
  // [#18491] Protocol-version drift advisory. Reports, never refuses. Not a
  // registry rule: it resolves the `@objectstack/spec` actually installed in
  // the APP's `node_modules`, which is the filesystem, not the stack.
  //
  // ⚠️ Found by falsifying "`find*` is the only invisible family" — it is not.
  // `check*` is a second one, live on the tree, wired into both commands and
  // in no roster. Two families were invisible, which is the evidence that
  // widening the pattern to cover `find*` would have moved the blind spot
  // rather than closed it.
  'checkProtocolVersionGap',
];

/**
 * Gates `os build` may legitimately run that `os validate` does not.
 *
 * Each entry is a deliberate assertion that the check CANNOT be made read-only
 * — it needs the emitted artifact, the bundler, or filesystem output. A gate
 * that merely *reads* the parsed stack does not belong here; wire it into
 * `validate.ts`, or better, register it in `@objectstack/lint`'s `authoring-rules.ts` so all
 * three authoring commands get it at once.
 */
const BUILD_ONLY_GATES: Readonly<Record<string, string>> = {
  buildAccessMatrix:
    '[ADR-0090 D6] The snapshot gate reads (and with --update-access-matrix WRITES) access-matrix.json ' +
    'next to the config. Rewriting a committed snapshot is not a read-only operation.',
  diffAccessMatrix: 'The comparison half of the same D6 snapshot gate.',
  buildRuntimeBundle: 'Emits the objectstack-runtime.{hash}.mjs sibling module. Artifact output by definition.',
};

/**
 * Everything else the two commands call, and the reason each one is NOT an
 * artifact-level gate. Keyed by reason so the classification is readable as a
 * set of claims rather than a wall of names.
 *
 * ⭐ [#18491] This ledger is the price of a CLOSED roster, and it is the point.
 * The scan below extracts every bare-identifier call site in `compile.ts` and
 * `validate.ts` — it keys on nothing but "this source calls it" — so the only
 * way a gate can stay out of the two gate rosters above is for a human to write
 * it down HERE, in a diff, next to a sentence saying it does not judge
 * anything. Before #18491 the scan matched `lintFoo(`/`validateFoo(` and saw
 * exactly TWO names in each command (`lintUnknownStackKeys`,
 * `lintUnknownAuthoringKeys`) out of 45 and 39 call sites: an entire gate could
 * be added to one command and this file had no way to notice.
 *
 * ⛔ Do not answer a red from the classification test by dropping a name in the
 * nearest bucket. The buckets are assertions; a gate filed under
 * "presentation" is a false statement that a reviewer can read in the diff,
 * which is exactly the visibility this ledger buys.
 */
const NOT_A_GATE: Readonly<Record<string, readonly string[]>> = {
  'The authoring-rule registry and the stack it judges — held by packages/cli/src/commands/authoring-rule-wiring.test.ts and by the union-fold assertions above, not by this roster':
    [
      'runAuthoringRules',
      'authoringRulesFor',
      'splitBySeverity',
      'authoringRuleUnionStack',
      'normalizeStackInput',
      'resolveSduiManifest',
      'loadConfig',
      'ObjectStackDefinitionSchema',
    ],
  // ⚠️ [#18491] These two are compile-only, and so is the SECOND
  // `runAuthoringRules` run they feed. That run is not covered by the roster
  // above and is not covered by the union fold either: `compile.ts`'s own
  // comment says what survives its de-duplication is "exactly the set the union
  // could not see". So `os build` judges something `os validate` does not, in
  // the false-clean direction. Recorded here rather than silently wired up —
  // wiring a real gate into the other door is a decision, not a test fix.
  'Input to the compile-only per-package rule walk — a real parity gap, reported not closed (see the note above this entry)':
    ['artifactPackages', 'packageBodyAsStack'],
  'Presentation — renders, formats or serialises a verdict something else reached; judges nothing':
    [
      'printHeader',
      'printKV',
      'printStep',
      'printSuccess',
      'printError',
      'printWarning',
      'printBulletList',
      'printAuthoringAdvisories',
      'printAuthoringRuleErrors',
      'printDocIssueErrors',
      'printMetadataStats',
      'collectMetadataStats',
      'formatConversionNotice',
      'formatZodErrors',
      'formatPermissionSetNameCollisions',
      'formatUnknownAuthoringKey',
      'JSON_FULL_LIST_REMEDY',
      'renderCapabilityMessage',
      'namedExportRejectionHints',
      'errorCodeFields',
      'emitJson',
    ],
  'Control flow, cleanup and local helpers — no diagnostic of its own': [
    'createTimer',
    'isExitSignal',
    'isReportedError',
    'cleanupOldRuntimeBundles',
    'findingKey',
    'warningsSoFar',
  ],
  'Not ours — a Node builtin, a global, an oclif base or a third-party namespace': [
    'dirname',
    'Set',
    'String',
    'path',
    'fs',
    'chalk',
    'ZodError',
    'Args',
    'Command',
    'Flags',
  ],
};

/** Every name in {@link NOT_A_GATE}, flattened. */
const NOT_A_GATE_NAMES: ReadonlySet<string> = new Set(Object.values(NOT_A_GATE).flat());

/**
 * The two doors this file holds equal. `lint.ts` is the third authoring
 * command and is held to the registry by the checks further down, but it emits
 * no artifact and runs no artifact-level gate, so it is not part of the parity
 * question.
 */
const PARITY_COMMANDS: readonly string[] = ['compile.ts', 'validate.ts'];

/** Every name any ledger in this file accounts for. */
const CLASSIFIED: ReadonlySet<string> = new Set([
  ...SHARED_NON_REGISTRY_GATES,
  ...Object.keys(BUILD_ONLY_GATES),
  ...NOT_A_GATE_NAMES,
]);

const sourceOf = (file: string) => readFileSync(join(COMMANDS_DIR, file), 'utf8');

const UTILS_DIR = join(__dirname, '..', 'src', 'utils');

/**
 * The three authoring commands, as one list. Named once so a rule below cannot
 * quietly cover a subset of the class it describes — the #12297 failure the
 * sink guard at the bottom of this file records.
 */
const AUTHORING_COMMANDS: readonly string[] = ['compile.ts', 'validate.ts', 'lint.ts'];

/**
 * The prose fingerprint of the ADR-0087 D2 conversion notice — the part of the
 * sentence that is neither interpolation nor punctuation, so it survives a
 * rename of the loop variable and does NOT survive a reword. Matching on this
 * rather than the whole template is deliberate: a divergence that only reworded
 * the tail would still be caught by the formatter-call assertion, and a
 * whole-template match would go vacuously green the day someone reflowed a
 * line.
 */
const NOTICE_PROSE = 'converted at load; conversion';

/**
 * The source with every comment body and every string/template body blanked to
 * spaces, character offsets and line breaks preserved.
 *
 * ⭐ [#18491] This is what lets the scan below mean "this command CALLS it"
 * instead of "these characters appear somewhere in the file". Both halves were
 * live holes: {@link calls} matched raw text, so a prose line writing
 * `preflightRequiredCapabilities(...)` would have satisfied the roster
 * assertion for a command that had stopped calling it, and every name named in
 * a docblock counted as a call site.
 *
 * ⛔ Deliberately NOT used by the inline-notice assertion at the bottom of this
 * file. An inline copy of the conversion sentence IS a string literal, so the
 * check that no command spells it out must read the RAW source — blanking
 * strings there would make that assertion pass on exactly the file it exists to
 * reject. `sourceOf` stays, and which of the two a reader wants is a real
 * choice, not an oversight.
 *
 * ⚠️ Bound: a regex literal containing `//` or a quote would derail the scan.
 * Neither command contains a regex literal today, and the failure direction is
 * loud rather than silent — a derailed scan blanks call sites, which strands
 * ledger entries and reds `no ledger entry is stale` below.
 */
function codeOnly(src: string): string {
  const out = src.split('');
  const N = src.length;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < N; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < N) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const j = src.indexOf('\n', i);
      blank(i, j === -1 ? N : j);
      i = j === -1 ? N : j;
    } else if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      blank(i, j === -1 ? N : j + 2);
      i = j === -1 ? N : j + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < N) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === c) break;
        j++;
      }
      blank(i + 1, j);
      i = Math.min(j + 1, N);
    } else {
      i++;
    }
  }
  return out.join('');
}

/** Keywords that take a parenthesis and are not calls of anything. */
const NOT_CALLABLE: ReadonlySet<string> = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'function',
  'new', 'do', 'else', 'yield', 'void', 'delete', 'in', 'of', 'import', 'super',
  'constructor', 'as', 'async',
]);

/**
 * Every bare-identifier call site in a command's source: `foo(` wherever `foo`
 * is not a property access, not the tail of a longer identifier, not a keyword
 * and not a declaration.
 *
 * ⭐ [#18491] THE DIRECTION OF THIS FILE IS INVERTED HERE. The old extractor
 * asked "which call sites LOOK like gates" — a regex for the two prefixes
 * `lint` and `validate` followed by a capital — and answered with 2 of the 45
 * names `compile.ts` calls. Everything else was
 * invisible, so the roster was advisory: a gate could be wired into one command
 * only and nothing in this file could tell. Two families were invisible on the
 * tree at once (`findNavGroupDiagnostics`, `checkProtocolVersionGap`), which is
 * why widening the pattern was the wrong fix: it would have moved the blind
 * spot to whatever the repo names a gate next.
 *
 * This asks the opposite question — "what does this command call" — and hands
 * the answer to the ledgers, which must account for ALL of it. A naming choice
 * cannot defeat it because it reads no names.
 *
 * ⚠️ What it still cannot see, stated so it is a known bound and not a
 * surprise. Each is asserted absent by `the command sources use no call shape
 * this scan cannot read` below, so none of them is silent:
 *   - a gate reached through a namespace import (`import * as g` → `g.run()`)
 *     or a dynamic `await import(...)` / `require(...)`;
 *   - a gate never CALLED here but handed on as a value (`list.map(gate)`).
 *     Asserted absent by requiring every value import to be either called or
 *     declared in a ledger.
 */
function callSitesOf(src: string): Set<string> {
  const code = codeOnly(src);
  const found = new Set<string>();
  const re = /([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const before = code.slice(0, m.index);
    // Tail of a longer identifier, or a property access. `...spread(` is a
    // call of `spread`, so the dot test must not fire on the third dot.
    if (/[\w$]$/.test(before)) continue;
    if (/(?<!\.\.)\.\s*$/.test(before)) continue;
    // `function foo(` / `async foo(` declare; they do not call.
    if (/\b(?:function|async)\s+$/.test(before)) continue;
    if (NOT_CALLABLE.has(m[1])) continue;
    found.add(m[1]);
  }
  return found;
}

const callSitesIn = (file: string): Set<string> => callSitesOf(sourceOf(file));

/** Is `name` invoked anywhere in this command's source? */
const calls = (file: string, name: string) => callSitesIn(file).has(name);

/**
 * Every value symbol a command's static imports bind, with `import type` and
 * inline `type` specifiers dropped.
 *
 * ⛔ A parse that quietly skipped an import statement would remove names from
 * the classification demand — a silent hole of exactly the kind this file is
 * about — so {@link importStatementCount} is asserted equal to the number of
 * statements actually consumed.
 */
/** How many import statements {@link valueImportsOf} actually consumed. */
const importsConsumed = new Map<string, number>();

function valueImportsOf(src: string): Set<string> {
  const names = new Set<string>();
  const re = /import\s+(type\s+)?([\s\S]*?)\s+from\s+['"][^'"]+['"];/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(src)) !== null) {
    consumed++;
    if (m[1]) continue;
    const clause = m[2];
    const braced = /\{([\s\S]*)\}/.exec(clause);
    for (const raw of braced ? braced[1].split(',') : []) {
      const t = raw.trim();
      if (!t || /^type\s/.test(t)) continue;
      const local = t.split(/\s+as\s+/).pop()?.trim();
      if (local) names.add(local);
    }
    const dflt = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, ' ').trim();
    if (dflt) names.add(dflt);
  }
  importsConsumed.set(src, consumed);
  return names;
}

/** How many import statements the source has, counted independently. */
const importStatementCount = (src: string): number =>
  (codeOnly(src).match(/^import\s/gm) ?? []).length;

/**
 * The names `os build` calls and `os validate` does not, once the two written
 * excuses are taken out: a declared build-only gate, and a declared non-gate.
 *
 * ⭐ Pure over source TEXT, not over file names, so the negative controls can
 * hand it fabricated commands. A guard that can only be run against the real
 * tree can only ever be observed passing.
 */
function parityGapBetween(
  compileSrc: string,
  validateSrc: string,
  notGates: ReadonlySet<string>,
): string[] {
  const inValidate = callSitesOf(validateSrc);
  return [...callSitesOf(compileSrc)]
    .filter((name) => !inValidate.has(name))
    .filter((name) => !(name in BUILD_ONLY_GATES))
    .filter((name) => !notGates.has(name))
    .sort();
}

/**
 * The `runAuthoringRules(...)` call in one command's source, from the call
 * through to its closing brace — the object literal whose `normalized` and
 * `parsed` members ARE the stack the rule table judges.
 */
function ruleTableCall(src: string): string {
  const at = src.indexOf('runAuthoringRules(');
  return at === -1 ? '' : src.slice(at, src.indexOf('})', at));
}

const ruleTableCallIn = (file: string): string => ruleTableCall(sourceOf(file));

/** A literal call of the ONE fold. */
const FOLD_CALL = /\bauthoringRuleUnionStack\s*\(/;

/**
 * The expression one tier is handed, as source text: from `tier:` to the
 * object literal's own separating comma, tracking bracket depth so a call's own
 * arguments cannot terminate it.
 */
function tierExpression(call: string, tier: string): string | null {
  const at = new RegExp(String.raw`\b${tier}\s*:\s*`).exec(call);
  if (!at) return null;
  const from = at.index + at[0].length;
  let depth = 0;
  for (let i = from; i < call.length; i++) {
    const c = call[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) return call.slice(from, i).trim();
  }
  return call.slice(from).trim();
}

/** The right-hand side of `const NAME = …;` / `const { …, NAME, … } = …;`. */
function constBindingOf(name: string, src: string): string | null {
  const decl = new RegExp(
    String.raw`^[ \t]*const\s+(?:${name}\b[^=\n]*|\{[^}\n]*\b${name}\b[^}\n]*\})\s*=\s*`,
    'm',
  ).exec(src);
  if (!decl) return null;
  const from = decl.index + decl[0].length;
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ';' && depth === 0) return src.slice(from, i);
  }
  return null;
}

/** Every identifier token in an expression, in source order. */
const identifiersIn = (expr: string): string[] => expr.match(/[A-Za-z_$][\w$]*/g) ?? [];

/**
 * Does the value handed to `tier` come from the ONE fold?
 *
 * ⭐ [#17528] Two spellings are legal, and they are the same act. `compile.ts`
 * and `validate.ts` fold AT the call (`parsed: authoringRuleUnionStack(…)`);
 * `lint.ts` folds ONCE at `lintConfig`'s entry, because its own hand-written
 * checks read that stack too, and hands the tiers the hoisted binding. A guard
 * that only matched the first spelling would force the second door to write a
 * cosmetic re-fold whose sole purpose is to satisfy a regex — and, worse, would
 * be satisfied BY that cosmetic call whatever the surrounding code did.
 *
 * So the identifier is RESOLVED instead of pattern-matched: follow `const`
 * bindings in this same source, at most {@link MAX_BINDING_HOPS} deep, and
 * answer true only when some hop is a literal `authoringRuleUnionStack(` call.
 *
 * ⛔ This is NOT a relaxation to "any identifier". An identifier that resolves
 * to nothing, or whose chain never reaches the fold, still fails — including
 * the two shapes this guard exists for, `normalized: config` and
 * `normalized: normalizeStackInput(config)`, and including a source where the
 * fold is called but not on the value handed over. Those three are asserted
 * directly, against fabricated sources, in the negative-control test below: a
 * guard that cannot fail is not a guard.
 *
 * ⚠️ Two BOUNDS, stated so the next reader knows which parts are proof and
 * which are approximation — neither is a hole today, and both are places a
 * future shape could outgrow this resolver rather than quietly defeat it:
 *
 *   - it follows EVERY identifier in the expression, so a composed expression
 *     (`merge(a, b)`) passes as soon as any identifier it names reaches the
 *     fold, even when the value handed over is the other one. Strictly narrower
 *     than the `foldedElsewhere` case rejected below — there the fold-bearing
 *     binding is not referenced at all — but it is source-level reachability,
 *     not dataflow.
 *   - {@link constBindingOf} takes the FIRST `const NAME =` in the file, so a
 *     shadowed or re-declared binding resolves to the wrong one. Today each
 *     command declares each of these names once.
 */
const MAX_BINDING_HOPS = 4;

function handsFoldedStack(src: string, tier: string): boolean {
  const expr = tierExpression(ruleTableCall(src), tier);
  if (expr === null) return false;

  const reaches = (text: string, seen: Set<string>, hops: number): boolean => {
    if (FOLD_CALL.test(text)) return true;
    if (hops >= MAX_BINDING_HOPS) return false;
    for (const id of identifiersIn(text)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const rhs = constBindingOf(id, src);
      if (rhs !== null && reaches(rhs, seen, hops + 1)) return true;
    }
    return false;
  };

  return reaches(expr, new Set(), 0);
}

describe('os validate is the read-only superset of os build (#3782, #4409)', () => {
  it('both commands run the shared authoring-rule registry', () => {
    for (const file of ['compile.ts', 'validate.ts']) {
      expect(calls(file, 'runAuthoringRules'), `${file} must run the authoring-rule registry`).toBe(true);
    }
  });

  /**
   * The same drift one layer EARLIER than every check in this file: not "does
   * this command run the table" but "what stack does it hand the table".
   *
   * ⭐ [#17069] A project whose definitions live only in `packages[]` — the
   * ADR-0130 D4 / option-B shape — carries no collections at the top level.
   * `compile.ts` folds them back in with `authoringRuleUnionStack` before it
   * runs the table; `validate.ts` and `lint.ts` did not, so each ran all 44
   * rules over an EMPTY stack and reported a clean bill of health for a project
   * it had read nothing of, at exit 0. That is the #4409 weakest-gate class
   * arriving through the INPUT rather than the rule set — and in its worst
   * direction, because `os validate` is the check an author runs before
   * shipping.
   *
   * Source-level for the same reason as the gate check above: it fails when a
   * door drops the fold, which is the moment it is cheap to fix. The
   * behavioural half — the card's own repro through the three real binaries —
   * is `test/union-fold-command-parity.test.ts`.
   */
  it('all three authoring commands hand the rule table the union-folded stack', () => {
    // Positive control FIRST: the helper must still exist and still be the ONE
    // fold. Without it, deleting `authoringRuleUnionStack` outright would
    // satisfy nothing below — but renaming it would make every assertion here
    // fail for the wrong reason, and this line says which.
    const helper = readFileSync(join(UTILS_DIR, 'stack-collections.ts'), 'utf8');
    expect(
      /export function authoringRuleUnionStack\b/.test(helper),
      'src/utils/stack-collections.ts must export authoringRuleUnionStack — if it moved, move this ' +
        'guard with it. ⛔ Do not answer a red here by writing a second fold.',
    ).toBe(true);

    for (const file of AUTHORING_COMMANDS) {
      const call = ruleTableCallIn(file);
      expect(call, `${file} must call runAuthoringRules`).not.toBe('');
      for (const tier of ['normalized', 'parsed']) {
        expect(
          handsFoldedStack(sourceOf(file), tier),
          `${file} hands the authoring-rule table a '${tier}' stack that has NOT been through ` +
            `authoringRuleUnionStack(). On an ADR-0130 D4 / option-B project — every definition in ` +
            `packages[], none at the top level — that input is an EMPTY stack, so every rule in the ` +
            `table reports nothing and this command certifies an unread project as clean at exit 0. ` +
            `Fold it, at the call as compile.ts does or once at the reader's entry as lint.ts does — ` +
            `either way the value handed over must resolve to authoringRuleUnionStack(). ⛔ Do not ` +
            `reimplement the fold here — import the one in src/utils/stack-collections.ts.`,
        ).toBe(true);
      }
    }
  });

  /**
   * The negative controls for the resolver above, on the same pass — because a
   * guard that cannot fail is not a guard, and this one became a resolver
   * rather than a literal match in #17528.
   *
   * Fabricated sources, not the real commands: the point is to exhibit inputs
   * the predicate must REJECT, and the tree is (correctly) expected to contain
   * none of them.
   */
  it('the union-fold guard still rejects a tier that does not reach the fold', () => {
    const withCall = (decls: string, normalized: string, parsed: string) =>
      `${decls}\n  for (const f of runAuthoringRules('x', {\n` +
      `    normalized: ${normalized},\n    parsed: ${parsed},\n    sduiManifest: m,\n  })) {}\n`;

    // ⛔ The pre-#17069 defect itself: the caller's own stack, handed straight on.
    const rawConfig = withCall('  const config = load();', 'config', 'config');
    expect(handsFoldedStack(rawConfig, 'normalized')).toBe(false);
    expect(handsFoldedStack(rawConfig, 'parsed')).toBe(false);

    // A bound identifier whose chain never reaches the fold.
    const normalizedOnly = withCall(
      '  const normalized = normalizeStackInput(config);',
      'normalized',
      'normalized',
    );
    expect(handsFoldedStack(normalizedOnly, 'normalized')).toBe(false);

    // ⭐ The sharpest one: the fold IS called in this source, on something else.
    // Resolution follows the value handed over, never the file's vocabulary.
    const foldedElsewhere = withCall(
      '  const unused = authoringRuleUnionStack(config);\n  const normalized = normalizeStackInput(config);',
      'normalized',
      'normalized',
    );
    expect(handsFoldedStack(foldedElsewhere, 'normalized')).toBe(false);

    // A chain longer than the hop budget is rejected too — the budget is a
    // bound on the resolver, not a hole in it.
    const tooDeep = withCall(
      '  const a = authoringRuleUnionStack(config);\n  const b = f(a);\n  const c = f(b);\n' +
        '  const d = f(c);\n  const e = f(d);\n  const g = f(e);',
      'g',
      'g',
    );
    expect(handsFoldedStack(tooDeep, 'normalized')).toBe(false);

    // ── And the three shapes it must ACCEPT, so the rejections above are not
    //    a predicate that says no to everything.
    expect(
      handsFoldedStack(withCall('', 'authoringRuleUnionStack(normalized)', 'authoringRuleUnionStack(lowered)'), 'parsed'),
      'the fold-at-the-call spelling (compile.ts / validate.ts) must pass',
    ).toBe(true);
    const hoisted = withCall(
      '  const stack = authoringRuleUnionStack(config);\n' +
        '  const { lowered, loweredHookRefs } = lowerCallables(stack);',
      'stack',
      'lowered',
    );
    expect(handsFoldedStack(hoisted, 'normalized'), 'a hoisted binding must pass').toBe(true);
    expect(
      handsFoldedStack(hoisted, 'parsed'),
      'a hoisted binding read through one intermediate call must pass — the lint.ts shape',
    ).toBe(true);
  });

  it.each(SHARED_NON_REGISTRY_GATES)('both commands run %s', (gate) => {
    // Guard the guard: a gate that has been renamed or deleted must fail here
    // rather than pass vacuously on both sides.
    expect(calls('compile.ts', gate), `compile.ts no longer calls ${gate} — is this list stale?`).toBe(true);
    expect(
      calls('validate.ts', gate),
      `os build runs ${gate} and os validate does not, so a stack can pass 'os validate' and fail ` +
        `'os build'. Wire it into packages/cli/src/commands/validate.ts (mirroring compile.ts's severity ` +
        `handling), or — only if it genuinely cannot run without emitting an artifact — move it to ` +
        `BUILD_ONLY_GATES in this file with a reason.`,
    ).toBe(true);
  });

  /**
   * ⭐ [#18491] THE COMPLETENESS HALF, and the reason the roster above can be
   * called closed. Every name either command calls must be classified; a name
   * nobody classified fails HERE, which is how a gate gets onto the roster
   * without anyone having to notice it.
   *
   * Before this, the roster was advisory and the drift scan matched
   * `lintFoo(`/`validateFoo(` — 2 of the 45 names `compile.ts` calls. Two
   * artifact-level gates were wired into both commands and held by nothing
   * (`findNavGroupDiagnostics` since #14553, `checkProtocolVersionGap`), and a
   * third wired into one command only would have passed every assertion in this
   * file. That is the FALSE-CLEAN direction, and it is the direction that
   * matters: `os validate` is the check an author runs before shipping.
   */
  it('every call site in compile.ts and validate.ts is classified', () => {
    // Non-vacuity FIRST. A scan that derailed — a stripper that blanked real
    // code, a regex that stopped matching — reports an empty difference and
    // reads exactly like agreement. These floors are deliberately far below
    // today's 47 and 39: they catch collapse, not growth.
    for (const file of PARITY_COMMANDS) {
      expect(
        callSitesIn(file).size,
        `${file}: the call-site scan found almost nothing, so every assertion in this file that ` +
          `reads it is vacuous. The scan has derailed — do not "fix" this by lowering the floor.`,
      ).toBeGreaterThan(20);
    }

    const unclassified = [
      ...new Set(PARITY_COMMANDS.flatMap((file) => [...callSitesIn(file)])),
    ]
      .filter((name) => !CLASSIFIED.has(name))
      .sort();

    expect(
      unclassified,
      `compile.ts / validate.ts call ${unclassified.length} name(s) this file has not classified: ` +
        `${unclassified.join(', ')}.\n` +
        `Every call site must land in exactly one ledger. If it is an artifact-level gate, wire it ` +
        `into BOTH commands and add it to SHARED_NON_REGISTRY_GATES; if it genuinely cannot run ` +
        `read-only, add it to BUILD_ONLY_GATES with a reason; if it is not a gate at all, add it to ` +
        `NOT_A_GATE under the reason that says so. Registering it in ` +
        `packages/lint/src/authoring-rules.ts instead is better than all three — then all THREE ` +
        `authoring commands get it and no roster row is needed.`,
    ).toEqual([]);
  });

  it('compile.ts hand-wires no gate validate.ts is missing', () => {
    const missing = parityGapBetween(sourceOf('compile.ts'), sourceOf('validate.ts'), NOT_A_GATE_NAMES);

    expect(
      missing,
      `os build runs ${missing.length} gate(s) that os validate does not: ${missing.join(', ')}.\n` +
        `Register it in packages/lint/src/authoring-rules.ts so all three authoring commands run ` +
        `it, wire it into validate.ts by hand and add it to SHARED_NON_REGISTRY_GATES, or add it to ` +
        `BUILD_ONLY_GATES with a reason.`,
    ).toEqual([]);
  });

  /**
   * The negative controls for the scan above, on the same pass — a guard that
   * cannot fail is not a guard, and this one replaced a pattern that could not
   * fail for an entire naming family.
   *
   * ⭐ [#18491] The first case is the defect itself, in the shape it would
   * actually arrive in: a gate wired into `compile.ts` and not `validate.ts`,
   * named something the old extractor could not see. Every family here is one
   * this repository already uses or plausibly would; the scan reads none of
   * them, which is the whole claim.
   */
  it('the parity scan sees a gate wired into one command only, whatever it is named', () => {
    const NONE: ReadonlySet<string> = new Set();
    const validateSrc = 'const findings = runAuthoringRules(stack);\n';

    for (const gate of [
      'lintFoo', // the two the old extractor could see …
      'validateFoo',
      'findFoo', // … and the families it could not. `find*` and `check*` are
      'checkFoo', //  both live on this tree today.
      'collectFoo',
      'preflightFoo',
      'assertFoo',
      'auditFoo',
      'ensureFoo',
      'foo',
    ]) {
      const compileSrc = `const findings = runAuthoringRules(stack);\nconst d = ${gate}(stack);\n`;
      expect(
        parityGapBetween(compileSrc, validateSrc, NONE),
        `a gate named ${gate} wired into compile.ts and not validate.ts must be reported`,
      ).toEqual([gate]);
    }

    // … and the same gate in BOTH commands is not a parity gap. Without this
    // the assertions above are satisfied by a scan that reports everything.
    expect(
      parityGapBetween('const d = findFoo(s);\n', 'const d = findFoo(s);\n', NONE),
      'a gate wired into both commands is not a parity gap',
    ).toEqual([]);

    // A build-only gate is excused, and only because it is written down.
    expect(parityGapBetween('buildRuntimeBundle(s);\n', '', NONE)).toEqual([]);
    expect(parityGapBetween('buildSomethingElse(s);\n', '', NONE)).toEqual(['buildSomethingElse']);
  });

  /**
   * ⭐ [#18491] Prose is not wiring. The scan this file used to run matched raw
   * source text, so a command that had STOPPED calling a rostered gate stayed
   * green as long as some comment still wrote the name with a parenthesis after
   * it — a vacuous pass in the same false-clean direction as the naming blind
   * spot, one layer over.
   */
  it('a comment or a string literal is not a wiring', () => {
    const NONE: ReadonlySet<string> = new Set();
    const compileSrc = 'const d = findFoo(stack);\n';

    expect(
      parityGapBetween(compileSrc, '// findFoo(stack) used to run here\n', NONE),
      'a comment naming the gate must not count as validate.ts running it',
    ).toEqual(['findFoo']);
    expect(
      parityGapBetween(compileSrc, "const hint = 'run findFoo(stack) first';\n", NONE),
      'a string naming the gate must not count as validate.ts running it',
    ).toEqual(['findFoo']);
    expect(
      parityGapBetween(compileSrc, '/* findFoo(stack) */\n', NONE),
      'a block comment naming the gate must not count as validate.ts running it',
    ).toEqual(['findFoo']);

    // The mirror, on the predicate the roster's own `both commands run %s`
    // assertions use.
    expect(callSitesOf('// preflightRequiredCapabilities(x)\n').has('preflightRequiredCapabilities')).toBe(false);
    expect(callSitesOf('preflightRequiredCapabilities(x);\n').has('preflightRequiredCapabilities')).toBe(true);

    // Two shapes the scan must get right in the OTHER direction, or it
    // under-reports: a spread-applied call is a call, a property access is not.
    expect(callSitesOf('const a = [...lintUnknownStackKeys(s)];\n').has('lintUnknownStackKeys')).toBe(true);
    expect(callSitesOf('const a = registry.findFoo(s);\n').has('findFoo')).toBe(false);
  });

  it('no ledger entry is stale', () => {
    // A ratchet nobody prunes rots into a permission slip — the same reason
    // BUILD_ONLY_GATES is pruned below. A NOT_A_GATE entry for a name neither
    // command mentions any more is a standing excuse waiting for a gate to be
    // given that name.
    const live = new Set(
      PARITY_COMMANDS.flatMap((file) => [...callSitesIn(file), ...valueImportsOf(sourceOf(file))]),
    );
    const stale = [...NOT_A_GATE_NAMES].filter((name) => !live.has(name)).sort();
    expect(
      stale,
      `NOT_A_GATE entries neither compile.ts nor validate.ts uses any more: ${stale.join(', ')}. ` +
        `Delete them.`,
    ).toEqual([]);

    // Exactly one ledger per name: a name in two of them makes the "classified"
    // test above green while leaving which claim is being made undecidable.
    const buckets: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
      ['SHARED_NON_REGISTRY_GATES', new Set(SHARED_NON_REGISTRY_GATES)],
      ['BUILD_ONLY_GATES', new Set(Object.keys(BUILD_ONLY_GATES))],
      ['NOT_A_GATE', NOT_A_GATE_NAMES],
    ];
    const doubled = [...CLASSIFIED].filter(
      (name) => buckets.filter(([, set]) => set.has(name)).length > 1,
    );
    expect(doubled, `classified in more than one ledger: ${doubled.join(', ')}`).toEqual([]);
  });

  /**
   * ⚠️ [#18491] The bounds of the scan, asserted rather than written down and
   * hoped for. The scan reads bare-identifier call sites in the command's own
   * source, so three shapes would hide a gate from it. None is present today,
   * and each is refused here so that introducing one is a RED — a decision
   * someone makes on purpose — instead of a silent return to the blind spot
   * this file was just repaired for.
   */
  it('the command sources use no call shape this scan cannot read', () => {
    for (const file of PARITY_COMMANDS) {
      const src = sourceOf(file);
      const code = codeOnly(src);

      expect(
        /\bimport\s+\*\s+as\b/.test(code),
        `${file} uses a namespace import. A gate reached as \`ns.gate()\` is a property access, ` +
          `which this scan deliberately does not count — import the gate by name.`,
      ).toBe(false);
      expect(
        /(?<![.\w$])import\s*\(/.test(code),
        `${file} uses a dynamic import. A gate resolved at runtime has no call site this file can ` +
          `read — import it statically.`,
      ).toBe(false);
      expect(
        /(?<![.\w$])require\s*\(/.test(code),
        `${file} uses require(). Same reason as the dynamic import above.`,
      ).toBe(false);

      // The import parse must have consumed EVERY import statement: a
      // statement it skipped drops names from the classification demand, which
      // is silent in the wrong direction.
      const values = valueImportsOf(src);
      expect(
        importsConsumed.get(src),
        `${file}: the import parse consumed ${importsConsumed.get(src)} of ${importStatementCount(src)} ` +
          `import statements, so some imported names are invisible to the ledgers.`,
      ).toBe(importStatementCount(src));

      // And every value import is either called here or written down. This is
      // what closes the last shape: a gate handed on as a value
      // (`list.map(gate)`) rather than called, which has no `gate(` call site
      // at all. `formatUnknownAuthoringKey` is exactly that shape today.
      const unaccounted = [...values]
        .filter((name) => !callSitesIn(file).has(name) && !CLASSIFIED.has(name))
        .sort();
      expect(
        unaccounted,
        `${file} imports ${unaccounted.length} value(s) it never calls and this file has not ` +
          `classified: ${unaccounted.join(', ')}. An imported gate that is handed on as a value ` +
          `instead of called still runs — classify it.`,
      ).toEqual([]);
    }
  });


  it('every BUILD_ONLY_GATES entry is still called by the build', () => {
    // A ratchet nobody prunes rots into a permission slip.
    const stale = Object.keys(BUILD_ONLY_GATES).filter((g) => !calls('compile.ts', g));
    expect(stale, `BUILD_ONLY_GATES entries compile.ts no longer calls: ${stale.join(', ')}`).toEqual([]);
  });

  /**
   * The same drift, one layer down and easier to miss: not "does this command
   * run the gate" but "does it LISTEN to what the gate says". The ADR-0087 D2
   * conversion pass runs inside `normalizeStackInput` on ALL THREE authoring
   * commands, so all three always converted — but only `os validate` passed an
   * `onConversionNotice` sink, so the others silently discarded every
   * deprecation notice. A notice is the one warning an old-shape author gets
   * before the conversion retires and their metadata stops loading, and five
   * conversions are live today.
   *
   * ⭐ [#12297] `lint.ts` was MISSING FROM THIS LOOP, and that is why the gap
   * survived #11772: the loop named the two commands the card in hand was
   * about, so closing `os build` left `os lint` — the third command the #4409
   * registry holds to this same bar, and the one whose docblock above already
   * claims "it covers `os lint` too" — unguarded and, as measured, unwired.
   * A guard that enumerates a subset of the class it describes reports green
   * for the members it forgot. The list is the class now, not the card.
   *
   * Source-level for the same reason as the gate check above: it fails when the
   * sink is dropped, which is the moment it is cheap to fix.
   */
  it('all three authoring commands pass a conversion-notice sink to normalizeStackInput', () => {
    for (const file of AUTHORING_COMMANDS) {
      const src = sourceOf(file);
      const call = src.match(/normalizeStackInput\([\s\S]{0,400}?\)\s*;/);
      expect(call, `${file} must call normalizeStackInput`).not.toBeNull();
      expect(
        call![0].includes('onConversionNotice'),
        `${file} calls normalizeStackInput without an onConversionNotice sink, so every ADR-0087 ` +
          `D2 deprecation notice it raises is discarded. Pass a sink and surface the notices ` +
          `(mirror the other command).`,
      ).toBe(true);
    }
  });

  /**
   * The same drift again, one step past the sink: not "does this command hear
   * the notice" but "does it SAY THE SAME THING once it has one".
   *
   * ⭐ [#13743] The sink guard above is blind here by construction. It asserts
   * each command PASSES an `onConversionNotice` sink; once all three had one,
   * each rendered the sentence from its own verbatim copy of the template, held
   * equal by convention alone. A reword in one command diverged it from the
   * other two and EVERY GATE STAYED GREEN — including this file, which is the
   * one place that would have been expected to notice.
   *
   * That sentence is close to a contract: a conversion asks the author for
   * nothing at load, so the notice is the ONLY warning they get before the
   * conversion retires and their metadata stops loading. An author who runs two
   * of the three commands over one tree must be told the same thing in the same
   * words.
   *
   * The rule is therefore structural rather than comparative — the three
   * copies are gone, and what is asserted is that they cannot come back: every
   * authoring command renders through the ONE formatter, and none of them
   * spells the sentence out inline. Comparing three literals for equality would
   * have locked today's three copies together while leaving a fourth free to
   * appear; requiring the single source forecloses both.
   */
  it('all three authoring commands render the conversion notice through ONE formatter', () => {
    // Positive control FIRST: the sentence must still exist in the formatter.
    // Without this, deleting `formatConversionNotice` and every inline copy
    // would satisfy every "no inline copy" assertion below — a rule that is
    // green precisely when the notice has been silenced.
    const formatter = readFileSync(join(UTILS_DIR, 'format.ts'), 'utf8');
    expect(
      /export function formatConversionNotice\b/.test(formatter),
      'src/utils/format.ts must export formatConversionNotice — if it moved, move this guard with it.',
    ).toBe(true);
    expect(
      formatter.includes(NOTICE_PROSE),
      `src/utils/format.ts no longer carries the notice wording ("${NOTICE_PROSE}"), so the ` +
        `assertions below would pass vacuously on a CLI that says nothing at all.`,
    ).toBe(true);

    for (const file of AUTHORING_COMMANDS) {
      expect(
        calls(file, 'formatConversionNotice'),
        `${file} must render its ADR-0087 D2 conversion notices with formatConversionNotice() ` +
          `from src/utils/format.ts. The three commands dispose of the string differently — ` +
          `os build and os lint print it, os validate pushes it into the --strict warnings list ` +
          `— but they must SAY the same thing, so the sentence has exactly one source.`,
      ).toBe(true);
      expect(
        sourceOf(file).includes(NOTICE_PROSE),
        `${file} spells the ADR-0087 D2 conversion notice out inline instead of calling ` +
          `formatConversionNotice(). That is the #13743 divergence: this sentence is the only ` +
          `warning an old-shape author gets before the conversion retires and their metadata ` +
          `stops loading, and a copy here drifts from the other commands silently. Edit the ` +
          `wording in src/utils/format.ts, where all three read it.`,
      ).toBe(false);
    }
  });
});
