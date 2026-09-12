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
 * Gates that are NOT registry rules (they need the filesystem or the emitted
 * artifact) and that both commands must therefore wire by hand.
 *
 * Adding a gate to `compile.ts` means adding it here and to `validate.ts`, or
 * to `BUILD_ONLY_GATES` below with a reason. There is no third option — that is
 * the whole point of the file.
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

/** Every `lintFoo(`/`validateFoo(` call site in a command's source. */
function gateCallsIn(file: string): Set<string> {
  const calls = sourceOf(file).match(/\b(?:lint|validate)[A-Z]\w*(?=\s*\()/g) ?? [];
  return new Set(calls);
}

/** Is `name` invoked anywhere in this command's source? */
const calls = (file: string, name: string) => new RegExp(String.raw`\b${name}\s*\(`).test(sourceOf(file));

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

  it('compile.ts hand-wires no gate validate.ts is missing', () => {
    const compileGates = gateCallsIn('compile.ts');
    const validateGates = gateCallsIn('validate.ts');

    // Non-vacuity: the extraction must still find the pre-parse key lints.
    expect(compileGates.size).toBeGreaterThan(0);

    const missing = [...compileGates]
      .filter((g) => !validateGates.has(g))
      .filter((g) => !(g in BUILD_ONLY_GATES))
      .sort();

    expect(
      missing,
      `os build runs ${missing.length} gate(s) that os validate does not: ${missing.join(', ')}.\n` +
        `Register it in packages/lint/src/authoring-rules.ts so all three authoring commands run ` +
        `it, wire it into validate.ts by hand and add it to SHARED_NON_REGISTRY_GATES, or add it to ` +
        `BUILD_ONLY_GATES with a reason.`,
    ).toEqual([]);
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
