// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13118 — `os migrate apply` REFUSES BEFORE WRITING ANY DDL when a host
 * `objectstack.config.{ts,js,mjs}` exists but could not be loaded.
 *
 * ## What this inverts, measured on this fixture before the change
 *
 * #12953 ruled the exit STATUS on that path and said nothing about the
 * mutation, so `apply` went on flushing its deferred schema work and applying
 * drift over the reduced object set — and THEN exited non-zero. One run,
 * saying both "this result is UNMEASURED, not in sync" and "…and I changed
 * your schema on that basis". Measured here on `origin/main` before the fix:
 * the refused run created **9 tables** — `sys_metadata`,
 * `sys_metadata_activation`, `sys_metadata_audit`, `sys_metadata_commit`,
 * `sys_metadata_history`, `sys_migration`, `sys_migration_journal`,
 * `sys_secret`, `sys_view_definition` — none of them the deployment's.
 *
 * Maintainer ruling 2026-08-29, verbatim 「同意」, option 2: refuse first, write
 * no DDL, exit non-zero. Option 3 (a flag that lets the mutation through) was
 * refused in the same ruling.
 *
 * ## Why the assertion is a SCHEMA READ and not an exit code
 *
 * The exit code on this path is already non-zero on `origin/main` — #13113
 * shipped it. A test that only checked the status would pass identically
 * before and after this change and would prove nothing new. What changed is
 * whether the database was touched, so that is what is read: `sqlite_master`,
 * through a connection of this test's own, after the command has exited.
 *
 * ⚠️ Deliberately not a hash of the database FILE — SQLite rewrites header
 * bytes on any read-write open, so a file hash reports a difference after a
 * run that only opened the database (`duplicates.integration.test.ts` carries
 * that measurement). What must not change is the SCHEMA.
 *
 * ## The positive control is built in, and it is directions 2 and 3
 *
 * "Zero tables" is worthless as a reading unless the same probe, run the same
 * way, can see tables when tables exist. Directions 2 and 3 are exactly that
 * control: config ABSENT and config LOADABLE both still create the platform
 * floor, through the same command, read by the same helper, in the same run.
 * If `readSchema()` were blind — wrong path, wrong file, a probe that silently
 * connected to an empty in-memory database — those two go red and direction 1
 * stays green. That pairing is the reason all three directions live in ONE
 * file rather than in a file per direction.
 *
 * And they are also the ruling's own scope pins: `absent ⇒ 不变`,
 * `present+loadable ⇒ 不变`. Here "unchanged" now means unchanged in BOTH
 * halves — status and mutation — which is the half #12953 could not state.
 *
 * ## Why a real child process
 *
 * Same reason as `migrate-unloadable-host-config-exit.e2e.test.ts`: the claim
 * is about a command an operator runs, and `process.exitCode` set inside a
 * vitest worker is not an exit status. Spawned through `bin/run-dev.js` + tsx,
 * so the suite does not depend on `packages/cli/dist` having been built.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver } from '@objectstack/driver-sql';
import { CLI, TSX, childEnv } from './helpers/serve-process.js';
import { NO_DDL_EXECUTED_NOTICE } from '../src/utils/schema-migration-plugins.js';

/**
 * The environment variable the unloadable fixture demands.
 *
 * Namespaced to this test and explicitly unset in the child, so the fixture
 * fails for a reason the runner cannot accidentally satisfy — an inherited
 * value would turn direction 1 into direction 3 while every assertion in it
 * kept reading as a pass.
 */
const REQUIRED_VAR = 'OS_E2E_13118_SECRET';

/** Generous: a cold tsx compile of the command tree dominates a ~1 s apply. */
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

/**
 * The tables a project's database actually holds, read with a connection of
 * our own after the command has exited.
 *
 * A MISSING database file answers `[]` without connecting — connecting would
 * CREATE it, which would make this probe a writer and its "no tables" reading
 * a self-fulfilling one.
 */
async function readTables(projectDir: string): Promise<string[]> {
  const dbFile = join(projectDir, '.objectstack', 'data', 'objectstack.db');
  if (!existsSync(dbFile)) return [];
  const probe = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: dbFile },
    useNullAsDefault: true,
  });
  try {
    const rows = await (probe as unknown as { knex: (t: string) => unknown }).knex('sqlite_master')
      .select('type', 'name') as Array<{ type: string; name: string }>;
    return rows
      .filter((r) => r.type === 'table' && !r.name.startsWith('sqlite_'))
      .map((r) => r.name)
      .sort();
  } finally {
    await probe.disconnect();
  }
}

/** A config that is PRESENT and throws while loading — direction 1. */
const UNLOADABLE_CONFIG = [
  `const secret = process.env.${REQUIRED_VAR};`,
  'if (!secret) {',
  `  throw new Error('Missing required environment variable ${REQUIRED_VAR}');`,
  '}',
  '',
  "export default { name: 'unloadable_13118', label: 'Unloadable 13118', objects: [] };",
  '',
].join('\n');

/** A config that is PRESENT and loads, and declares a table of its own — direction 3. */
const LOADABLE_CONFIG = [
  'export default {',
  "  name: 'loadable_13118',",
  "  label: 'Loadable 13118',",
  '  objects: [{',
  "    name: 'lo_ticket',",
  "    label: 'Ticket',",
  "    fields: { title: { type: 'text', label: 'Title' } },",
  '  }],',
  '};',
  '',
].join('\n');

const dirs: string[] = [];
function project(config: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'os-13118-e2e-'));
  dirs.push(dir);
  if (config !== null) writeFileSync(join(dir, 'objectstack.config.ts'), config);
  return dir;
}

describe('os migrate apply refuses BEFORE any DDL on an unloadable host config (#13118)', () => {
  let unloadableApply: Run;
  let unloadableTables: string[];
  let absentApply: Run;
  let absentTables: string[];
  let loadableApply: Run;
  let loadableTables: string[];

  beforeAll(async () => {
    const unloadable = project(UNLOADABLE_CONFIG);
    const absent = project(null);
    const loadable = project(LOADABLE_CONFIG);

    // Sequential on purpose: each run boots a kernel, and this suite shares a
    // box with whatever else CI is running.
    unloadableApply = await runCli(['migrate', 'apply', '--yes', '--json'], unloadable);
    unloadableTables = await readTables(unloadable);
    absentApply = await runCli(['migrate', 'apply', '--yes', '--json'], absent);
    absentTables = await readTables(absent);
    loadableApply = await runCli(['migrate', 'apply', '--yes', '--json'], loadable);
    loadableTables = await readTables(loadable);
  }, RUN_BUDGET_MS * 3);

  afterAll(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop()!;
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  });

  describe('direction 1 — config PRESENT and unloadable: non-zero AND zero DDL', () => {
    it('exits non-zero', () => {
      // #13113's half, re-read here only so the next assertion is about a run
      // that did refuse rather than one that quietly succeeded.
      expect(unloadableApply.code).not.toBe(0);
    });

    it('⭐ wrote NO DDL — the database holds no tables at all', () => {
      // This is the whole card. On `origin/main` the same run left 9 tables
      // here. Directions 2 and 3 below prove this probe can see tables.
      expect(unloadableTables).toEqual([]);
    });

    it('says so in the refusal, on stderr, on top of the #12953 wording', () => {
      // The ruling: reuse the ruled wording AND state explicitly that no DDL
      // ran, so an operator does not have to guess whether the database was
      // touched. The notice is imported rather than re-spelled — a copy here
      // would keep passing the day the sentence moves.
      expect(unloadableApply.stderr).toContain('could not be loaded');
      expect(unloadableApply.stderr).toContain('UNMEASURED');
      expect(unloadableApply.stderr).toMatch(/Remedy:/);
      expect(unloadableApply.stderr).toContain(NO_DDL_EXECUTED_NOTICE.trim());
    });

    it('reports the refusal in the --json document too, with nothing applied', () => {
      const payload = JSON.parse(unloadableApply.stdout) as {
        message?: string;
        created?: unknown[];
        applied?: unknown[];
        composition?: { hostConfig?: string; hostConfigLoaded?: boolean };
      };
      expect(payload.message).toBe('refused_unloadable_host_config');
      expect(payload.created).toEqual([]);
      expect(payload.applied).toEqual([]);
      // #12953 kept `hostConfigLoaded` as the machine discriminator its
      // consumers read; the refusal must not take it away with it.
      expect(payload.composition?.hostConfigLoaded).toBe(false);
      expect(payload.composition?.hostConfig).toContain('objectstack.config.ts');
    });
  });

  describe('direction 2 — there is NO host config: unchanged, floor still created', () => {
    it('keeps exit 0', () => {
      expect(absentApply.code).toBe(0);
    });

    it('still CREATES the data stack — and proves the probe can see tables', () => {
      // ⚠️ The data stack, NOT the platform floor. With neither a host config
      // nor a compiled artifact `buildSchemaMigrationPlugins()` composes
      // nothing at all (its own header: "the five-table data stack is the
      // honest answer"), so `PlatformObjectsPlugin` — and with it
      // `sys_migration` — is absent on this shape by design. Written against
      // what the shape actually produces rather than against the floor, which
      // is direction 3's business.
      expect(absentTables.length).toBeGreaterThan(0);
      expect(absentTables).toContain('sys_metadata');
    });

    it('emits no refusal', () => {
      expect(absentApply.stderr).not.toContain('could not be loaded');
      expect(absentApply.stderr).not.toContain(NO_DDL_EXECUTED_NOTICE.trim());
    });
  });

  describe("direction 3 — the host config LOADS: unchanged, the deployment's tables land", () => {
    it('keeps exit 0', () => {
      expect(loadableApply.code).toBe(0);
    });

    it("CREATES the config's own object table as well as the floor", () => {
      expect(loadableTables).toContain('lo_ticket');
      expect(loadableTables).toContain('sys_migration');
    });

    it('emits no refusal', () => {
      expect(loadableApply.stderr).not.toContain('could not be loaded');
      expect(loadableApply.stderr).not.toContain(NO_DDL_EXECUTED_NOTICE.trim());
    });
  });
});
