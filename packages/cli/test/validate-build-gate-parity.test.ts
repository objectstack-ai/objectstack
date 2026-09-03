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
  lowerCallables:
    'Lowers inline `function` handlers to string refs so they survive JSON.stringify. It exists to ' +
    'produce the artifact; there is nothing to lower when nothing is emitted.',
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

describe('os validate is the read-only superset of os build (#3782, #4409)', () => {
  it('both commands run the shared authoring-rule registry', () => {
    for (const file of ['compile.ts', 'validate.ts']) {
      expect(calls(file, 'runAuthoringRules'), `${file} must run the authoring-rule registry`).toBe(true);
    }
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
