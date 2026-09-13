// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17069 — the three authoring commands judge the SAME STACK, on the ADR-0130
 * D4 / option-B shape.
 *
 * `authoring-rule-command-parity.test.ts` next door proves the three commands
 * reach the same verdict about the same rule TABLE. This file proves the other
 * half of the same promise, one layer earlier: that they hand that table the
 * same INPUT. A command can run every rule in the registry and still certify a
 * project clean — if what it hands the registry is an empty stack.
 *
 * ## The defect this file pins
 *
 * A project whose definitions live only in `packages[]` — the ADR-0130 D4
 * artifact shape, no collections at the top level — was judged by `os validate`
 * and `os lint` as if it declared NOTHING. `compile.ts` folds the packages back
 * in through `authoringRuleUnionStack` before it runs the table; neither
 * sibling command imported that helper, so each ran 44 rules over `{}`.
 *
 * Measured through the real binaries on this card's repro, before the fix:
 *
 *     os validate   EXIT=0    ✓ Validation passed
 *     os lint       EXIT=0    (no finding of any severity)
 *     os build      EXIT=1    object-reference-unknown
 *
 * ⭐ The dangling `ob_nowhere` is only the PROBE that makes the blindness
 * visible. The same silence covered every author-time rule, because the input
 * was empty — which is why the fix is the shared fold and not a rule.
 *
 * ## Why this is the p1 direction of the #4409 class
 *
 * #4409 was `os build` publishing what the other two refuse. This is the
 * mirror, and it is worse: `os validate` is the fast inner-loop check an author
 * runs BEFORE shipping, so its clean bill of health on a stack it read nothing
 * of is the strongest false assurance the three commands can give.
 * `content/docs/deployment/validating-metadata.mdx` states the parity as a
 * promise — *"anything that can fail a build fails `os lint` too"* — and on
 * this stack shape the promise was false in the loudest direction.
 *
 * ## Why it is spawned, and why BOTH fixtures are here
 *
 * Spawned because the exit CODE is the contract a CI pipeline reads, and only a
 * real process produces one; `os validate`'s rule run is an expression inside
 * the oclif command body, so there is no exported seam a probe could call
 * instead (the same reason the option-B acceptance pin could not reach it).
 *
 * The CLEAN fixture is not decoration. A fold wired in backwards — or a rule
 * that fires on any `packages[]` at all — would satisfy the failing case alone.
 * The pair asserts what the card actually claims: that the option-B stack is
 * READ, not that it is rejected.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');

/** The three commands the #4409 registry holds to one bar. */
const AUTHORING_COMMANDS = ['validate', 'lint', 'build'] as const;

/** The rule the probe trips, and the path it reports it at. */
const RULE = 'object-reference-unknown';
const RULE_PATH = 'objects[0].fields.ghost.reference';

/**
 * The card's repro verbatim: no top-level `objects`, one `packages[]` entry
 * carrying an object whose `ghost` lookup points at an object that does not
 * exist. Every collection this project declares lives inside `packages[]`.
 */
const optionBStack = (reference: string): Record<string, unknown> => ({
  manifest: { id: 'com.example.ob', name: 'ob', version: '1.0.0', type: 'app', namespace: 'ob' },
  packages: [
    {
      manifest: {
        id: 'com.example.ob',
        name: 'ob',
        version: '1.0.0',
        type: 'app',
        namespace: 'ob',
        objects: [
          {
            name: 'ob_order',
            label: 'Order',
            sharingModel: 'private',
            fields: {
              number: { type: 'text', label: 'Number' },
              ghost: { type: 'lookup', label: 'Ghost', reference },
            },
          },
        ],
      },
    },
  ],
});

interface Run {
  code: number;
  output: string;
}

/**
 * One authoring command over one option-B project, as a shell sees it.
 *
 * A plain literal config with no imports, so it resolves with no `node_modules`
 * next to it — the `authoring-rule-command-parity.test.ts` pattern.
 */
function runCommand(command: string, stack: Record<string, unknown>): Run {
  const dir = mkdtempSync(join(tmpdir(), 'os-union-fold-'));
  try {
    writeFileSync(join(dir, 'objectstack.config.mjs'), `export default ${JSON.stringify(stack, null, 2)};\n`);
    try {
      const stdout = execFileSync(process.execPath, [CLI, command], {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
        // Every spawned child under this directory declares its environment at
        // the call site (#11595).
        env: childEnv({ NO_COLOR: '1' }),
      });
      return { code: 0, output: String(stdout) };
    } catch (error: any) {
      return { code: error.status ?? 1, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('#17069 — os validate and os lint judge the option-B stack, not an empty one', () => {
  it.each(AUTHORING_COMMANDS)(
    'os %s refuses a packages[]-only project whose lookup target does not exist',
    (command) => {
      const run = runCommand(command, optionBStack('ob_nowhere'));
      expect(
        run.code,
        `os ${command} exited ${run.code} on a project whose definitions live only in packages[]. ` +
          `Before #17069 os validate and os lint both exited 0 here — they handed the author-time ` +
          `rule table an EMPTY stack, so all 44 rules reported nothing and the project was certified ` +
          `clean without being read. Hand the table authoringRuleUnionStack(...) as compile.ts does.` +
          `\n--- output ---\n${run.output}`,
      ).toBe(1);
      expect(run.output, `os ${command} refused the stack without naming the rule`).toContain(RULE);
      expect(
        run.output,
        `os ${command} named ${RULE} at a different path than the other doors — the three commands ` +
          `must report one finding one way`,
      ).toContain(RULE_PATH);
    },
    180_000,
  );

  it.each(AUTHORING_COMMANDS)(
    'control: os %s passes the identical option-B project once the lookup resolves',
    (command) => {
      const run = runCommand(command, optionBStack('ob_order'));
      expect(
        run.code,
        `os ${command} exited ${run.code} on a CLEAN option-B project. The fold folds packages[] ` +
          `back in as the rule table's INPUT — it does not make a packages[]-only project fail. ` +
          `Without this control the case above would pass on a command that refuses every ` +
          `multi-package stack.\n--- output ---\n${run.output}`,
      ).toBe(0);
      expect(run.output, `os ${command} reported ${RULE} on a stack whose lookup resolves`).not.toContain(RULE);
    },
    180_000,
  );
});
