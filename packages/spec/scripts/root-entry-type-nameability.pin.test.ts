// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Root-entry nameability pin (#11350) — the consumer shape, verbatim.
 *
 * ## The invariant this pins
 *
 * A type that appears structurally in an entry's public declarations must be
 * nameable from that same entry (maintainer ruling 2026-08-23, recorded on
 * #11350). The measured breakage: `defineStack` returns
 * `ObjectStackDefinition`, declared `z.input<typeof
 * ObjectStackDefinitionSchema>` — a generic instantiation the declaration
 * emitter does not preserve as an alias — so an un-annotated
 * `export default defineStack(...)` is emitted as the STRUCTURAL expansion.
 * That expansion mentions `FormFieldInput` / `NavigationItemInput` /
 * `StateNodeConfig`, and until #11350 the root entry did not re-export them,
 * so tsc could only name them through the hash-named internal dist chunk that
 * physically declares them — unaddressable through the package's `exports`
 * map → TS2883 ("likely not portable") in every consumer inferring a type
 * through a root-entry function. Nine build-time configs hit it before the
 * first one was diagnosed (#10868).
 *
 * ## What each program proves
 *
 * - **consumer** — the repro's exact shape: an un-annotated
 *   `export default defineStack(...)`, compiled with `declaration: true`
 *   against the BUILT root entry, resolved the way a real consumer resolves it
 *   (a `node_modules/@objectstack/spec` symlink + the package's own `exports`
 *   map — the same physical resolution a pnpm workspace consumer performs;
 *   measured on #11350: this program produced exactly 3 × TS2883 against the
 *   pre-fix dist and 0 diagnostics against the fixed one). Asserted green.
 *
 *   The program is two files on purpose, mirroring the real consumers: every
 *   one of the nine i18n-extract configs' programs also contains its object
 *   modules, which import `@objectstack/spec/data` — and #11350's control
 *   measured that a program file importing a subpath entry makes that entry's
 *   names NAMEABLE program-wide. `context.ts` reproduces that, which is what
 *   scopes this pin to the ruled three (ui/automation names, reachable only
 *   via the root re-exports under pin). Measured against this same dist: the
 *   MINIMAL one-file program leaks two MORE names through `/data`
 *   (`BaseValidationRuleShape`, `FilterCondition`) that the fixed root entry
 *   still cannot name — deliberately NOT pinned here; that is #11350's
 *   recorded premise delta, filed as #11709 for its own ruling. For the same
 *   reason the program contains no `@objectstack/spec/ui` or `/automation`
 *   import and no direct `import type { FormFieldInput, … }` — any of those
 *   would mask the very symptom under pin. Direct existence of the three root
 *   exports is owned by `api-surface/root.json` + `check:api-surface` instead.
 *
 * - **canary** — the anti-phantom probe. TS2883 is a DECLARATION-EMIT
 *   diagnostic: drop `declaration: true` from the harness profile and the
 *   consumer program goes green forever, regression or no regression — a gate
 *   only ever observed green is indistinguishable from one that matches
 *   nothing. The canary is a hermetic fixture whose only error is also
 *   declaration-emit-only — TS4094, a private member on an exported anonymous
 *   class type (measured: exit 2 with `declaration: true`, exit 0 without) —
 *   so it stays red exactly as long as the harness keeps checking the axis
 *   the pin lives on. Asserted red.
 *
 * ## Dist freshness — an environment-gated measurement, the live-dialect-cell
 * shape
 *
 * The subject under test is `dist/index.d.ts`, not `src/` — the same artifact
 * `check:api-surface` reads, judged by the same staleness rule (#7122/#7181):
 * a stale dist would let a root re-export removed from `src/index.ts` sit
 * green here until the next rebuild.
 *
 * But absence of that artifact is an ENVIRONMENT fact, not a defect: turbo's
 * `test` task depends on `^build` (dependencies only), so the Test Core lane
 * deliberately runs spec's own suite with spec's own dist unbuilt — a throw
 * here reds a whole CI shard for a measurement that lane was never equipped
 * to make (measured on PR #11716's first round: 420/421 files passed, only
 * this file failed, at the old beforeAll throw). So the pin follows
 * `live-dialect-matrix.testkit.ts`'s discipline — REPORTED, never omitted,
 * with no third outcome:
 *
 *   - dist fresh → the two programs run, both modes.
 *   - dist missing/stale, default → a NAMED SKIP whose title carries the
 *     refusal reason ("it was not run" stays readable in the output). Never a
 *     silent pass, never a throw.
 *   - dist missing/stale under `OS_EXPECT_ROOT_NAMEABILITY=1` → a FAILURE
 *     quoting the freshness refusal: that flag is set only by a runner that
 *     declared it builds spec's dts first, so a skip there would be the pin
 *     quietly degrading to never-measured — the #4690 shape.
 *
 * Where it runs for real in CI: the `Type Check · consumer gates` lane
 * (lint.yml `typecheck-consumers`) sets the flag right after its full
 * packages-closure builds, beside `check:api-surface` / `check:skill-examples`
 * — the other consumer-shaped gates that read the built dist.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { inspectDistFreshness } from './lib/dist-freshness';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..');
const RERUN =
  'pnpm --filter @objectstack/spec test scripts/root-entry-type-nameability.pin.test.ts';

/** One tsc program = its fixture files + one tsconfig, in a shared sandbox. */
interface Program {
  files: Record<string, string>;
  tsconfigName: string;
}

const CONSUMER: Program = {
  files: {
    // The repro's shape, verbatim: un-annotated default export of a
    // root-entry inference. Any structural mention the declaration emitter
    // cannot name from within this program turns it red with the leaked name
    // in the output.
    'consumer.ts': `import { defineStack } from '@objectstack/spec';

export default defineStack({ objects: [] });
`,
    // The real programs' shape: the configs' object modules import
    // `@objectstack/spec/data`, making /data's names nameable in-program
    // (#11350's control) — see the docblock for why this scopes the pin.
    'context.ts': `import type { Field } from '@objectstack/spec/data';

export type AuditObjectShape = { fields: Record<string, Field> };
`,
  },
  tsconfigName: 'tsconfig.consumer.json',
};

const CANARY: Program = {
  files: {
    // Declaration-emit-only error: TS4094, private member on an exported
    // anonymous class type. Runs the same compiler profile as the consumer
    // program; red here proves the profile still checks declaration emit.
    'canary.ts': `export const probe = new (class { private x = 1; })();
`,
  },
  tsconfigName: 'tsconfig.canary.json',
};

let sandbox = '';

function writeProgram(program: Program): void {
  for (const [name, source] of Object.entries(program.files)) {
    fs.writeFileSync(path.join(sandbox, name), source);
  }
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      // Load-bearing: TS2883 (and the canary's TS4094) exist only on the
      // declaration-emit axis. `noEmit` keeps the sandbox clean; tsc still
      // runs the declaration emitter's checks when `declaration` is on.
      declaration: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    },
    include: Object.keys(program.files),
  };
  fs.writeFileSync(
    path.join(sandbox, program.tsconfigName),
    JSON.stringify(tsconfig, null, 2),
  );
}

function runTsc(program: Program): { code: number; output: string } {
  const require = createRequire(import.meta.url);
  const tscBin = require.resolve('typescript/bin/tsc');
  const res = spawnSync(
    process.execPath,
    [tscBin, '--pretty', 'false', '-p', path.join(sandbox, program.tsconfigName)],
    { cwd: sandbox, encoding: 'utf-8' },
  );
  return { code: res.status ?? 1, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

/**
 * Read the environment ONCE, at collection time, exactly as
 * `live-dialect-matrix.testkit.ts` reads its cell URLs: the branch below is
 * total — measured when the dist is readable, a named skip or an expected-mode
 * failure when it is not — so there is no third outcome and no throw that
 * could red a lane never equipped to measure this.
 */
const EXPECT_BUILT_DIST = process.env.OS_EXPECT_ROOT_NAMEABILITY === '1';
const FRESHNESS = inspectDistFreshness(PKG_DIR, 'check', RERUN);

if (!FRESHNESS.fresh) {
  describe('root-entry type nameability (#11350)', () => {
    it.skipIf(!EXPECT_BUILT_DIST)(
      `spec's dist declarations are ${FRESHNESS.state} — this pin reads the BUILT root entry; ` +
        `build @objectstack/spec first, then: ${RERUN} (skipped by default; ` +
        `OS_EXPECT_ROOT_NAMEABILITY=1 turns this into a failure)`,
      () => {
        expect.fail(
          `OS_EXPECT_ROOT_NAMEABILITY=1 while spec's dist declarations are ${FRESHNESS.state}: ` +
            `this runner declared it builds spec's dts before the suite, so this pin must not ` +
            `be skipped (a skip here would be the pin quietly degrading to never-measured, #4690).\n` +
            FRESHNESS.message,
        );
      },
    );
  });
} else {
  describe('root-entry type nameability (#11350)', () => {
    beforeAll(() => {
      sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'os-root-nameability-'));
      // A real consumer's resolution, physically: a node_modules symlink into
      // the built package, so tsc walks the package's own `exports` map and
      // lands on `dist/index.d.ts` — the same realpath a pnpm workspace
      // symlink produces (the #11350 measurement fired TS2883 through exactly
      // this layout).
      const scope = path.join(sandbox, 'node_modules', '@objectstack');
      fs.mkdirSync(scope, { recursive: true });
      fs.symlinkSync(PKG_DIR, path.join(scope, 'spec'), 'dir');

      writeProgram(CONSUMER);
      writeProgram(CANARY);
    });

    afterAll(() => {
      if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
    });

    it('an un-annotated `export default defineStack(...)` declaration-emits clean against the built root entry', () => {
      const { code, output } = runTsc(CONSUMER);
      expect(
        code,
        `expected 0 diagnostics; a TS2883 naming a dist chunk means a type the root entry's ` +
          `public declarations mention structurally is no longer nameable from the root entry ` +
          `(re-export it from src/index.ts — see #11350). tsc said:\n${output}`,
      ).toBe(0);
      expect(output).not.toMatch(/error TS\d+/);
    });

    it('canary: the harness profile still checks the declaration-emit axis', () => {
      const { code, output } = runTsc(CANARY);
      expect(
        code,
        `the canary fixture's declaration-emit error disappeared — if the harness profile ` +
          `lost \`declaration: true\`, the consumer pin above is green no matter what leaks. ` +
          `tsc said:\n${output}`,
      ).not.toBe(0);
      // Measured: TS4094 ("Property 'x' of exported anonymous class type may
      // not be private or protected"). Pin the TS4xxx declaration-emit family +
      // the message's substance rather than the bare number, so a
      // compiler-version renumbering does not false-red this line.
      expect(output).toMatch(/error TS4\d{2,3}: .*private/);
    });
  });
}
