// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12953 — `os migrate plan` / `os migrate apply` EXIT NON-ZERO when a host
 * `objectstack.config.{ts,js,mjs}` exists but could not be loaded.
 *
 * ## The measurement this inverts
 *
 * After #12938 the pair composes the deployment's own object set. One shape
 * still slipped through: a config that EXISTS and throws while loading — a
 * missing environment variable is the ordinary cause, and ObjectStack Cloud's
 * own control-plane config throws without `AUTH_SECRET`. On that path the
 * commands warned loudly, carried `composition.hostConfigLoaded: false` in
 * `--json`, and **exited 0** over a metadata set that was the data stack plus
 * the platform floor — nine tables, none of them the deployment's. Measured on
 * this fixture before the fix: `plan`, `plan --json`, `apply --yes` and
 * `apply --yes --json` all returned 0.
 *
 * Maintainer ruling 2026-08-29, verbatim 「同意」: a green exit over an
 * UNMEASURED partial metadata set is the false-green a migration tool must
 * never emit, and the population this "regresses" was computing defective
 * plans all along.
 *
 * ## Why a real child process
 *
 * The claim is about EXIT STATUS, and `process.exitCode` set inside a vitest
 * worker is not one — only a process that has actually exited has a status for
 * a shell, a `set -e` script or a container entrypoint to read. That audience
 * is the entire point of the ruling, and it is the one an in-process assertion
 * cannot stand in for. Spawned through `bin/run-dev.js` + tsx, the pattern
 * `migrate-exit-code.e2e.test.ts` and `migrate-plan-exits.e2e.test.ts` already
 * use, so the suite does not depend on `packages/cli/dist` having been built.
 *
 * ## Why all THREE directions are here
 *
 * The ruling pinned the untouched populations as hard as the changed one:
 * config ABSENT keeps today's behaviour, config PRESENT-AND-LOADABLE keeps
 * today's behaviour. Those two are the expensive half — a refusal written as
 * "the composition is incomplete" rather than "the config is present and did
 * not load" turns every config-less project red, and direction 1's assertions
 * all still pass while it does. `absentPlan`/`loadablePlan` below are what
 * fails instead.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI, TSX, childEnv } from './helpers/serve-process.js';

/**
 * The environment variable the unloadable fixture demands.
 *
 * Deliberately namespaced to this test: the fixture must fail for a reason the
 * runner cannot accidentally satisfy, and it is explicitly unset in the child
 * (see {@link runCli}) so an inherited value can never turn direction 1 green.
 */
const REQUIRED_VAR = 'OS_E2E_12953_SECRET';

/** Generous: a cold tsx compile of the command tree dominates a ~1 s plan. */
const RUN_BUDGET_MS = 120_000;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      {
        cwd,
        maxBuffer: 16 * 1024 * 1024,
        // `childEnv` drops the vitest worker family; `REQUIRED_VAR: undefined`
        // removes the variable the fixture needs, which is what makes the
        // config unloadable rather than merely unusual.
        env: childEnv({ NO_COLOR: '1', [REQUIRED_VAR]: undefined }),
      },
      (err, stdout, stderr) => {
        resolvePromise({
          // `err.code` is the real exit status. `null`/undefined means the
          // child was SIGNALLED — a different failure, never reported as 0.
          code: err
            ? (typeof (err as { code?: unknown }).code === 'number'
                ? (err as unknown as { code: number }).code
                : 1)
            : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/** A config that is PRESENT and throws while loading — direction 1. */
const UNLOADABLE_CONFIG = [
  `const secret = process.env.${REQUIRED_VAR};`,
  'if (!secret) {',
  `  throw new Error('Missing required environment variable ${REQUIRED_VAR}');`,
  '}',
  '',
  'export default { name: \'unloadable_e2e\', label: \'Unloadable E2E\', objects: [] };',
  '',
].join('\n');

/** A config that is PRESENT and loads — direction 3. */
const LOADABLE_CONFIG = [
  'export default {',
  "  name: 'loadable_e2e',",
  "  label: 'Loadable E2E',",
  '  objects: [{',
  "    name: 'le_ticket',",
  "    label: 'Ticket',",
  "    fields: { title: { type: 'text', label: 'Title' } },",
  '  }],',
  '};',
  '',
].join('\n');

const dirs: string[] = [];
function project(config: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-12953-e2e-'));
  dirs.push(dir);
  if (config !== null) writeFileSync(join(dir, 'objectstack.config.ts'), config);
  return dir;
}

describe('os migrate plan/apply refuse an unloadable host config (#12953)', () => {
  let unloadablePlan: Run;
  let unloadableApply: Run;
  let absentPlan: Run;
  let absentApply: Run;
  let loadablePlan: Run;
  let loadableApply: Run;

  beforeAll(async () => {
    const unloadable = project(UNLOADABLE_CONFIG);
    const absent = project(null);
    const loadable = project(LOADABLE_CONFIG);

    // Sequential on purpose: each run boots a kernel, and this suite shares a
    // box with whatever else CI is running.
    unloadablePlan = await runCli(['migrate', 'plan', '--json'], unloadable);
    unloadableApply = await runCli(['migrate', 'apply', '--yes', '--json'], unloadable);
    absentPlan = await runCli(['migrate', 'plan', '--json'], absent);
    absentApply = await runCli(['migrate', 'apply', '--yes', '--json'], absent);
    loadablePlan = await runCli(['migrate', 'plan', '--json'], loadable);
    loadableApply = await runCli(['migrate', 'apply', '--yes', '--json'], loadable);
  }, RUN_BUDGET_MS * 6);

  afterAll(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop()!;
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  describe('direction 1 — the config is PRESENT and cannot be loaded', () => {
    it('exits non-zero from `migrate plan`', () => {
      expect(unloadablePlan.code).not.toBe(0);
    });

    it('exits non-zero from `migrate apply` — the ruling named both commands', () => {
      expect(unloadableApply.code).not.toBe(0);
    });

    it('names the config, the underlying failure and the remedy, on stderr', () => {
      for (const run of [unloadablePlan, unloadableApply]) {
        expect(run.stderr).toContain('objectstack.config.ts');
        expect(run.stderr).toContain(`Missing required environment variable ${REQUIRED_VAR}`);
        expect(run.stderr).toMatch(/Remedy:/);
      }
    });

    it('KEEPS the loud warning and the hostConfigLoaded discriminator', () => {
      // Both were pinned by the ruling: consumers (objectstack-ai/cloud#1705)
      // read `hostConfigLoaded`, and a table count cannot replace it — the
      // platform floor lands either way, so the count rises either way.
      //
      // ⚠️ This assertion is only worth its bytes because it can FAIL: the
      // same probe run against direction 2 finds no `composition` block at all
      // (`absentPlan` below asserts exactly that), so a change that dropped the
      // field would turn this red rather than pass on absence.
      for (const run of [unloadablePlan, unloadableApply]) {
        expect(run.stderr).toContain('could not be loaded');
        expect(run.stderr).toContain('UNMEASURED');
        const payload = JSON.parse(run.stdout) as {
          composition?: { hostConfig?: string; hostConfigLoaded?: boolean };
        };
        expect(payload.composition?.hostConfigLoaded).toBe(false);
        expect(payload.composition?.hostConfig).toContain('objectstack.config.ts');
      }
    });

    it('still emits its whole report — the refusal replaces the STATUS, not the document', () => {
      // A refusal that swallowed the plan would take the consumer's signal with
      // it, which is the opposite of what the ruling preserved.
      expect(() => JSON.parse(unloadablePlan.stdout)).not.toThrow();
      expect(() => JSON.parse(unloadableApply.stdout)).not.toThrow();
    });
  });

  describe('direction 2 — there is NO host config: unchanged', () => {
    it('keeps exit 0 for plan and apply', () => {
      expect(absentPlan.code).toBe(0);
      expect(absentApply.code).toBe(0);
    });

    it('emits no composition block and no refusal', () => {
      // `hostConfigLoaded` is false on this shape too (nothing was loaded
      // because there was nothing to load). A refusal keyed on that flag alone
      // fails HERE and nowhere else.
      const payload = JSON.parse(absentPlan.stdout) as Record<string, unknown>;
      expect(payload).not.toHaveProperty('composition');
      expect(absentPlan.stderr).not.toContain('could not be loaded');
      expect(absentPlan.stderr).not.toMatch(/Remedy:/);
      expect(absentApply.stderr).not.toMatch(/Remedy:/);
    });
  });

  describe('direction 3 — the host config LOADS: unchanged', () => {
    it('keeps exit 0 for plan and apply', () => {
      expect(loadablePlan.code).toBe(0);
      expect(loadableApply.code).toBe(0);
    });

    it('reports the config as loaded and emits no refusal', () => {
      const payload = JSON.parse(loadablePlan.stdout) as {
        composition?: { hostConfigLoaded?: boolean };
      };
      expect(payload.composition?.hostConfigLoaded).toBe(true);
      expect(loadablePlan.stderr).not.toMatch(/Remedy:/);
      expect(loadableApply.stderr).not.toMatch(/Remedy:/);
    });
  });
});
