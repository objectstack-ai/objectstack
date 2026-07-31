// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Structural wiring guard for the suite's whole reason to exist (#3583 §5 D5).
//
// ## Why a test and not a comment
//
// The defect this catches is not a wrong result — it is a MISSING CALL, and a
// missing call produces no failing assertion anywhere. Every command's own
// tests pass, the rule's unit tests pass, and the only symptom is that
// `os validate`, `os lint` and `os compile` disagree about the same stack.
//
// That is not hypothetical. `validateReadonlyFlowWrites` was hand-wired into
// `validate` and `compile` and never into `lint` from #3425 until #4394 — and
// because it GATES (`flow-update-readonly-field` is an `error`), `os lint`
// spent that whole time returning clean for stacks `os compile` refuses. The
// suite's own header had been naming it as the standing proof of the drift the
// suite exists to end, which is a comment doing a test's job. #4394 removed
// that instance; this file removes the failure MODE, so the next rule cannot
// repeat it silently (#4384).
//
// ## The invariant
//
// `os lint` ⊇ `os compile`'s gate set. `lint` is the cheap pre-flight and
// `compile` is the gate; a green `lint` followed by a red `compile` makes the
// pre-flight worthless — and for an agent it is worse than worthless, because
// the remaining options are re-verifying everything (slow) or learning to
// distrust the signal (dangerous).
//
// ## Why it scans source
//
// vitest inlines imports through its transform, so a spy on `@objectstack/lint`
// cannot prove which symbols a command file actually reaches for — the same
// reason `lazy-deps.test.ts` scans `src/` rather than probing a module cache.
// Behavioural coverage of what the suite CONTAINS lives in
// `@objectstack/lint`'s `reference-integrity-suite.test.ts`; this file guards
// only the seam between that suite and the three call sites.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { REFERENCE_INTEGRITY_RULES } from '@objectstack/lint';

const commandsDir = dirname(fileURLToPath(import.meta.url));

/** The three commands that must hold a stack to the same author-time bar. */
const AUTHORING_COMMANDS = ['validate.ts', 'lint.ts', 'compile.ts'] as const;

const sourceOf = (file: string) => readFileSync(join(commandsDir, file), 'utf8');

describe('reference-integrity wiring (#3583 §5 D5, #4384)', () => {
  it.each(AUTHORING_COMMANDS)('%s runs the suite', (file) => {
    expect(sourceOf(file)).toMatch(/\bvalidateReferenceIntegrity\s*\(/);
  });

  // The regression itself. A second, per-rule call site is how a rule ends up
  // on two commands out of three, and it always starts with importing that rule
  // by name — so the import is what this asserts on. Catching the call instead
  // would miss the window between adding the import and adding the second call.
  it.each(AUTHORING_COMMANDS)('%s does not import a suite member directly', (file) => {
    const source = sourceOf(file);
    const reached = REFERENCE_INTEGRITY_RULES.map((r) => r.name).filter((name) =>
      new RegExp(
        String.raw`^\s*import\s[^;]*\b${name}\b[^;]*from\s*['"]@objectstack/lint['"]`,
        'm',
      ).test(source),
    );
    expect(
      reached,
      `${file} imports suite member(s) directly — run them via validateReferenceIntegrity instead, ` +
        `or all three commands will drift the way validateReadonlyFlowWrites did (#4394)`,
    ).toEqual([]);
  });

  // Guards the guard: were the suite ever emptied or the export renamed, the
  // assertions above would pass vacuously while checking nothing.
  it('the suite is non-empty, so the assertions above are not vacuous', () => {
    expect(REFERENCE_INTEGRITY_RULES.length).toBeGreaterThan(0);
    // The rule whose absence from `os lint` is the reason this file exists.
    expect(REFERENCE_INTEGRITY_RULES.map((r) => r.name)).toContain('validateReadonlyFlowWrites');
  });
});
