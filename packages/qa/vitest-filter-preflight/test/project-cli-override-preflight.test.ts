// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The transcription, the discrimination and the silence (#18788).
 *
 * `project-cli-override-preflight.ts` stands on one transcribed fact — the
 * closed allowlist of CLI option names vitest carries into a project config —
 * and refuses a run when a timeout override falls outside it. Three things can
 * rot, and each has its own case below:
 *
 *  1. **The transcription drifts from vitest.** The first case reads the array
 *     back out of the INSTALLED runner and asserts equality, so a vitest bump
 *     that edits `cliOverrides` reddens here instead of quietly changing what
 *     eight packages refuse. ⛔ It FAILS when the extraction finds nothing
 *     rather than skipping: "could not run" is a failure, not a pass (AGENTS.md,
 *     Route & surface ownership §3) — which is this whole card's subject.
 *  2. **The detector stops discriminating.** A detector that refused every
 *     timeout-shaped flag would break `--testTimeout`, which is on the allowlist
 *     and does reach the projects. Every refusal case here is paired with a
 *     pass case, and the real `parseCLI` is passed in unaltered so the
 *     structural typing of `TimeoutCliOptions` is pinned rather than assumed.
 *  3. **The healthy run stops being silent.** `renderInertOverrideNotice`
 *     returning the empty string is the contract that keeps an ordinary run
 *     byte-identical, exactly as it is for the sibling preflight in this package.
 *
 * ⛔ What this file deliberately does NOT assert: that `--hookTimeout` is in
 * fact inert in a real `projects` package. That is a BEHAVIOUR of a config load
 * and is measured where it lives, against a real vitest child, in
 * `packages/cli/test/hook-timeout-override-refusal.test.ts` — which also carries
 * that leg's own controls.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { parseCLI } from 'vitest/node';
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT_OVERRIDE_OPTIONS,
  PROJECT_CLI_OVERRIDES,
  inertTimeoutOverrides,
  renderInertOverrideNotice,
  runProjectCliOverridePreflight,
} from '../src/project-cli-override-preflight.js';

const require = createRequire(import.meta.url);

/** An argv as `process.argv` presents it: `[execPath, script, ...args]`. */
const argv = (...args: string[]): string[] => ['/node', '/vitest', ...args];

/**
 * vitest's OWN `cliOverrides` array, read out of the installed runner.
 *
 * ⚠️ This climbs into `node_modules`, which is an installed dependency rather
 * than a repo source input — the one escape `check:cross-package-test-inputs`
 * deliberately does not flag. The chunk's filename carries a content hash, so
 * it is found by shape and not named.
 */
function installedProjectCliOverrides(): string[] {
  const chunks = join(dirname(require.resolve('vitest/package.json')), 'dist', 'chunks');
  const candidates = readdirSync(chunks).filter((f) => /^cli-api\..*\.js$/.test(f));
  const found: string[][] = [];
  for (const file of candidates) {
    const match = readFileSync(join(chunks, file), 'utf8').match(
      /const cliOverrides = \[([\s\S]*?)\]\s*\.reduce/,
    );
    if (match) found.push([...match[1].matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]));
  }
  // ⛔ Loudly, never a skip: with no reading there is nothing to compare, and a
  // green here would vouch for a transcription nobody checked.
  if (found.length !== 1) {
    throw new Error(
      `expected exactly one \`cliOverrides\` array in ${chunks} (searched ` +
        `${candidates.length} cli-api chunk(s), found ${found.length}). vitest's ` +
        'bundle shape changed — re-read `resolveProjects` and update both this ' +
        'reader and PROJECT_CLI_OVERRIDES.',
    );
  }
  return found[0];
}

describe('the transcription is held against its source', () => {
  it('equals the `cliOverrides` array in the installed vitest, order included', () => {
    const installed = installedProjectCliOverrides();

    expect(installed.length).toBeGreaterThan(0);
    expect([...PROJECT_CLI_OVERRIDES]).toEqual(installed);
  });

  it('places the three timeout knobs on the two sides the module depends on', () => {
    // Not a restatement of the constant: this is the premise the whole refusal
    // rests on, and it is asserted against the INSTALLED array above.
    const installed = installedProjectCliOverrides();

    expect(installed).toContain('testTimeout');
    expect(installed).not.toContain('hookTimeout');
    expect(installed).not.toContain('teardownTimeout');
    expect([...TIMEOUT_OVERRIDE_OPTIONS]).toEqual([
      'testTimeout',
      'hookTimeout',
      'teardownTimeout',
    ]);
  });
});

describe('inertTimeoutOverrides, read through vitest’s own parser', () => {
  it('names `--hookTimeout`, which the allowlist drops', () => {
    expect(inertTimeoutOverrides(argv('run', '--hookTimeout=1'), parseCLI)).toEqual(['hookTimeout']);
  });

  it('names `--teardownTimeout`, which the allowlist drops', () => {
    expect(inertTimeoutOverrides(argv('run', '--teardownTimeout=50'), parseCLI)).toEqual([
      'teardownTimeout',
    ]);
  });

  it('⭐ CONTROL — says nothing about `--testTimeout`, which the allowlist carries', () => {
    // The discriminator. A detector that flagged this would be refusing a flag
    // that works, which is a worse outcome than the defect being fixed.
    expect(inertTimeoutOverrides(argv('run', '--testTimeout=1'), parseCLI)).toEqual([]);
  });

  it('⭐ CONTROL — says nothing about an ordinary run', () => {
    expect(inertTimeoutOverrides(argv('run'), parseCLI)).toEqual([]);
    expect(inertTimeoutOverrides(argv('run', 'some-file', '--project', 'unit'), parseCLI)).toEqual(
      [],
    );
  });

  it('reports both, in declared order, when both are named', () => {
    expect(
      inertTimeoutOverrides(argv('run', '--teardownTimeout=2', '--hookTimeout=1'), parseCLI),
    ).toEqual(['hookTimeout', 'teardownTimeout']);
  });

  it('declines — silently — on an argv the parser refuses', () => {
    // `--silent=1` is a value `parseCLI` throws on. ⛔ Guessing past our own
    // parser is the defect this module reports, so the answer is silence.
    expect(() => parseCLI(['vitest', 'run', '--silent=1'], { allowUnknownOptions: true })).toThrow();
    expect(inertTimeoutOverrides(argv('run', '--silent=1', '--hookTimeout=1'), parseCLI)).toEqual(
      [],
    );
  });
});

describe('the notice', () => {
  it('⭐ is the EMPTY STRING when nothing was dropped — the byte-identical contract', () => {
    expect(renderInertOverrideNotice([], '@objectstack/cli')).toBe('');
  });

  it('names the flag, the package and the remedies that were measured', () => {
    const notice = renderInertOverrideNotice(['hookTimeout'], '@objectstack/cli');

    expect(notice).toContain('--hookTimeout');
    expect(notice).toContain('@objectstack/cli');
    expect(notice).toContain('extends: true');
    expect(notice).toContain('beforeAll(fn, 1)');
    // ⛔ The point of the diagnostic, in the text: the run measured nothing.
    expect(notice).toContain('measured nothing');
  });

  it('carries the package it was asked about, never a hardcoded one (#17978)', () => {
    const notice = renderInertOverrideNotice(['hookTimeout'], '@objectstack/runtime');

    expect(notice).toContain('@objectstack/runtime');
    expect(notice).not.toContain('@objectstack/cli');
  });
});

describe('runProjectCliOverridePreflight', () => {
  it('⭐ writes nothing and returns nothing on a clean command line', () => {
    const written: string[] = [];

    const result = runProjectCliOverridePreflight({
      argv: argv('run', '--testTimeout=1'),
      packageName: '@objectstack/cli',
      parse: parseCLI,
      write: (text) => void written.push(text),
    });

    expect(result).toBe('');
    expect(written).toEqual([]);
  });

  it('writes the refusal and then throws, so the run cannot be read as a pass', () => {
    const written: string[] = [];

    expect(() =>
      runProjectCliOverridePreflight({
        argv: argv('run', '--hookTimeout=1'),
        packageName: '@objectstack/cli',
        parse: parseCLI,
        write: (text) => void written.push(text),
      }),
    ).toThrow(/--hookTimeout cannot reach a project config in @objectstack\/cli/);

    expect(written.join('')).toContain('TIMEOUT OVERRIDE CANNOT REACH THIS PACKAGE');
  });

  it('returns the text without throwing only when a caller asks it to', () => {
    const written: string[] = [];

    const result = runProjectCliOverridePreflight({
      argv: argv('run', '--hookTimeout=1'),
      packageName: '@objectstack/cli',
      parse: parseCLI,
      write: (text) => void written.push(text),
      refuse: false,
    });

    expect(result).toContain('TIMEOUT OVERRIDE CANNOT REACH THIS PACKAGE');
    expect(written.join('')).toBe(result);
  });
});
