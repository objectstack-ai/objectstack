// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * End-to-end acceptance for #6743: `os migrate plan` on a project that has
 * never been started must leave NO database behind — and must print exactly
 * the plan it printed before.
 *
 * #3917 made the boot stop WRITING (no create-table DDL, no seed rows), and
 * `schema-migrate.deferred-ddl.integration.test.ts` pins that half against a
 * database that already exists. The half left over — and the one this file
 * pins — is the OPEN itself: SQLite creates a database file the moment a
 * connection issues its first statement, so a `plan` in a fresh project still
 * produced a 0-table `.objectstack/data/objectstack.db`. A dry run that leaves
 * a file behind also destroys the one signal "this project has no database
 * yet", which every following command reads by asking whether the file exists.
 *
 * Two assertions, and BOTH are load-bearing (the `domain:cli` ruling on the
 * issue is explicit that the fix must not be paid for with the report):
 *
 *   1. **No file.** Not just `objectstack.db` — the `-wal` and `-shm`
 *      companions too, and the `data/` directory itself. A pin that names only
 *      the `.db` path misses two of the three files an interrupted WAL
 *      connection can strand.
 *   2. **Same report.** On a fresh project "every table needs creating" is not
 *      a false report; it is the true answer, and it is what a user most wants
 *      from the first `plan` of a new project. So the pending-work set is
 *      compared against a control boot that DOES create the file, and the
 *      database label is asserted to still name the real target path rather
 *      than the `:memory:` stand-in the probe actually read.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootSchemaStack, type PendingSchemaWork } from './schema-migrate.js';

const ARTIFACT = {
  // #8687: manifest fields under `manifest:` — the flat spelling is refused.
  manifest: { id: 'probe_smoke', name: 'Probe Smoke', version: '0.0.0', type: 'app' },
  objects: [
    { name: 'probe_widget', fields: { name: { type: 'text', required: true }, colour: { type: 'text' } } },
    { name: 'probe_gadget', fields: { label: { type: 'text' } } },
  ],
};

/**
 * The env vars that outrank the unified project default (#6469). Every one of
 * them must be absent or the boot resolves somewhere else entirely and this
 * test silently stops testing anything.
 */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL',
  'DATABASE_URL',
  'TURSO_DATABASE_URL',
  'OS_DATABASE_DRIVER',
  'OS_HOME',
] as const;

describe('os migrate plan on a fresh project — no database is created (#6743)', () => {
  let dir: string;
  let dataDir: string;
  let dbFile: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-probe-'));
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(ARTIFACT));
    // Deliberately NOT created — the whole point is that the boot must not
    // bring it into existence. This is the unified default of #6469.
    dataDir = join(dir, '.objectstack', 'data');
    dbFile = join(dataDir, 'objectstack.db');

    for (const key of OVERRIDING_ENV) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    savedEnv.OS_ARTIFACT_PATH = process.env.OS_ARTIFACT_PATH;
    savedEnv.NODE_ENV = process.env.NODE_ENV;
    process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
    process.env.NODE_ENV = 'production'; // no dev auto-reconcile, no wasm step-down
  });

  afterEach(() => {
    for (const key of OVERRIDING_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    process.env.OS_ARTIFACT_PATH = savedEnv.OS_ARTIFACT_PATH;
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  /** Every path the sqlite target could have brought into existence. */
  function databaseArtifactsOnDisk(): string[] {
    const found: string[] = [];
    for (const path of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
      if (existsSync(path)) found.push(path);
    }
    // Anything else the boot dropped in `data/` counts too — a companion this
    // list does not name is still debris.
    if (existsSync(dataDir)) {
      for (const entry of readdirSync(dataDir)) {
        const full = join(dataDir, entry);
        if (!found.includes(full)) found.push(full);
      }
    }
    return found.sort();
  }

  /** Comparable projection of the plan's "New (additive)" section. */
  function pendingShape(pending: PendingSchemaWork[]): Array<{ table: string; kind: string; columns: number }> {
    return pending
      .map((p) => ({ table: p.table, kind: p.kind, columns: p.columns.length }))
      .sort((a, b) => a.table.localeCompare(b.table));
  }

  it('leaves no .objectstack/data/ at all — file, -wal and -shm alike', async () => {
    expect(existsSync(dataDir)).toBe(false);

    const stack = await bootSchemaStack({
      jsonOutput: false,
      deferSchemaDdl: true,
      readOnlyProbe: true,
      projectRoot: dir,
    });
    try {
      // The plan is computed and non-empty — this is a real run, not a boot
      // that failed early and left nothing behind for uninteresting reasons.
      expect(stack.pendingSchemaWork.length).toBeGreaterThan(0);
      expect(await stack.driver!.detectManagedDrift()).toEqual([]);
    } finally {
      await stack.shutdown();
    }

    expect(databaseArtifactsOnDisk()).toEqual([]);
    // The directory itself is the other half of the write side effect: a
    // `mkdir -p` here would recreate exactly the state whose absence tells the
    // next command that this project has never been started.
    expect(existsSync(dataDir)).toBe(false);
  }, 60_000);

  it('prints the same plan as a boot that does create the file, and still names the real target', async () => {
    const probe = await bootSchemaStack({
      jsonOutput: false,
      deferSchemaDdl: true,
      readOnlyProbe: true,
      projectRoot: dir,
    });
    const probePending = pendingShape(probe.pendingSchemaWork);
    const probeLabel = probe.dbLabel;
    const probeExamined = probe.managedTableCount;
    await probe.shutdown();

    expect(existsSync(dataDir)).toBe(false);

    // Control: the pre-#6743 behaviour, on the same fresh project.
    const control = await bootSchemaStack({
      jsonOutput: false,
      deferSchemaDdl: true,
      projectRoot: dir,
    });
    const controlPending = pendingShape(control.pendingSchemaWork);
    const controlLabel = control.dbLabel;
    const controlExamined = control.managedTableCount;
    await control.shutdown();

    // The control is what proves the fixture is a genuine fresh project: it
    // creates the file this issue is about.
    expect(existsSync(dbFile)).toBe(true);

    expect(probePending).toEqual(controlPending);
    expect(probeExamined).toBe(controlExamined);
    // The one line that would betray the stand-in. `describeDb` reads the
    // driver's DECLARED config, which the driver keeps pointing at the real
    // file even while its Knex instance holds `:memory:`.
    expect(probeLabel).toBe(controlLabel);
    expect(probeLabel).toContain('objectstack.db');
    expect(probeLabel).not.toContain(':memory:');
  }, 60_000);

  it('does NOT arm itself for a boot that will write — os migrate apply keeps its file', async () => {
    // `apply` boots with `deferSchemaDdl` too and then flushes the deferred DDL
    // after the operator confirms. If the absent-file redirect ever became
    // implied by `deferSchemaDdl`, that flush would land in an ephemeral
    // database and the operator's migration would silently evaporate.
    const stack = await bootSchemaStack({
      jsonOutput: false,
      deferSchemaDdl: true,
      projectRoot: dir,
    });
    try {
      const created = await stack.flushSchemaDdl();
      expect(created.length).toBeGreaterThan(0);
    } finally {
      await stack.shutdown();
    }

    expect(existsSync(dbFile)).toBe(true);

    // And the tables really are in the FILE, not in a stand-in that vanished.
    const after = await bootSchemaStack({
      jsonOutput: false,
      deferSchemaDdl: true,
      readOnlyProbe: true,
      projectRoot: dir,
    });
    try {
      expect(after.pendingSchemaWork).toEqual([]);
    } finally {
      await after.shutdown();
    }
  }, 60_000);
});
