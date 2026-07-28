// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `os validate` is documented — and relied on by CI setups — as the READ-ONLY
 * SUPERSET of the gates `os build` runs: same checks, no artifact emitted. That
 * contract has no enforcement, so it drifted (#3782): four authoring lints
 * (`lintFlowPatterns`, `lintLivenessProperties`, `lintAutonumberFormats`,
 * `lintViewRefs`) were wired into `compile.ts` only. Two of them already emitted
 * `severity: 'error'`, so `os validate` reported a clean stack that `os build`
 * then rejected — the precise failure the contract exists to prevent.
 *
 * The drift was invisible because every OTHER gate is a `@objectstack/lint`
 * import shared by both files, while these four are CLI-local `../utils/lint-*`
 * modules that only `compile.ts` ever imported.
 *
 * This is a source-level gate rather than a behavioural one on purpose: it fails
 * when a gate is ADDED to the build without being added to validate, which is
 * the moment the mistake is cheap to fix — not later, when some app trips it.
 */

const COMMANDS_DIR = join(__dirname, '..', 'src', 'commands');

/**
 * Gates `os build` may legitimately run that `os validate` does not.
 *
 * Adding an entry here is a deliberate assertion that the check CANNOT be made
 * read-only (it needs the emitted artifact, the bundler, the filesystem output).
 * A gate that merely *reads* the parsed stack does not belong here — wire it
 * into `validate.ts` instead. Empty today, and that is the healthy state.
 */
const BUILD_ONLY_GATES: readonly string[] = [];

/** Every `lintFoo(`/`validateFoo(` call site in a command's source. */
function gateCallsIn(file: string): Set<string> {
  const src = readFileSync(join(COMMANDS_DIR, file), 'utf8');
  const calls = src.match(/\b(?:lint|validate)[A-Z]\w*(?=\s*\()/g) ?? [];
  return new Set(calls);
}

describe('os validate is the read-only superset of os build (#3782)', () => {
  it('runs every gate compile.ts runs', () => {
    const compileGates = gateCallsIn('compile.ts');
    const validateGates = gateCallsIn('validate.ts');

    // Guard the guard: if the extraction regex silently stops matching, the
    // set-difference below passes vacuously and the gate goes quietly dead.
    expect(compileGates.size).toBeGreaterThan(10);

    const missing = [...compileGates]
      .filter((g) => !validateGates.has(g))
      .filter((g) => !BUILD_ONLY_GATES.includes(g))
      .sort();

    expect(
      missing,
      `os build runs ${missing.length} gate(s) that os validate does not, so a stack ` +
        `can pass 'os validate' and fail 'os build': ${missing.join(', ')}.\n` +
        `Wire each into packages/cli/src/commands/validate.ts (mirroring the severity ` +
        `handling in compile.ts), or — only if it genuinely cannot run without emitting ` +
        `an artifact — add it to BUILD_ONLY_GATES in this file with a reason.`,
    ).toEqual([]);
  });

  it('runs the four CLI-local authoring lints that regressed in #3782', () => {
    const validateGates = gateCallsIn('validate.ts');

    for (const gate of [
      'lintFlowPatterns',
      'lintLivenessProperties',
      'lintAutonumberFormats',
      'lintViewRefs',
    ]) {
      expect(validateGates.has(gate), `validate.ts must call ${gate}`).toBe(true);
    }
  });
});
