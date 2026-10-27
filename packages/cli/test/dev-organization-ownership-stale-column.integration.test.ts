// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26615 — the card's third target, run against the BUILT CLI: a development
 * database with a stale physical `organization_id` column on an object that no
 * longer declares one starts under a plain `os dev`, after the automatic
 * in-place upgrade (ADR-0131 D10, development exception).
 *
 * ## The fixture
 *
 * The shape an 18.0 pre-release left a development database in: the two
 * objects the card names, `sys_flow_credential` (`service-automation`, composed
 * by `requires: ['automation']`) and `sys_secret`, each with the
 * `organization_id` column and the `idx_<table>_organization_id` index the
 * tenant-column injection gave every table before both declared
 * `systemFields: { tenant: false }`; a `sys_secret` row still stamped with the
 * Default Organization (a 17.x write) and a `sys_flow_credential` row with no
 * stamp; and no organization-ownership marker in `sys_migration` (those
 * releases wrote none). It is staged on a database a fresh `os dev` of this tree created, so
 * every other table is the shape this release expects — the guard refuses for
 * the two columns and the absent marker alone.
 *
 * ## What it pins
 *
 * - the refused boot is upgraded in place and the server starts on it: the
 *   verdict line, then the server's own start line;
 * - the stamped value the `sys_secret` drop discards is said before the apply
 *   runs, with its count, and the unstamped table is not named (seat ruling
 *   6446501014: the plan's column-drop fate accounts for the column, so the
 *   upgrade proceeds, loudly);
 * - the two columns are gone, and the marker the guard reads is verified;
 * - the copy taken before the upgrade is kept, with the columns still in it.
 *
 * The card's reported stop (「The upgrade did not run to a report」 with no
 * cause) did not reproduce on this fixture, nor on an authentic HotCRM
 * database of 2026-10-16 under the published 18.2.0; what that path prints now
 * — the ceremony's own refusal, else how it ended and the end of its log — is
 * `src/utils/dev-organization-ownership-upgrade.test.ts`'s subject.
 *
 * ## Spawn shape
 *
 * `bin/run.js` with `NODE_ENV` unset, as `dev-standalone-self-heal` does — the
 * shipped entry, resolving commands from `dist/` (`requireBuiltCli`); `os dev`
 * runs the ceremony through the same entry (`process.argv[1]`). One process
 * group per boot. Every boot runs in `beforeAll` and every `it` reads what it
 * recorded.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  childEnv,
  E2E_SECRET_KEY,
  KERNEL_ASSIGNED_PORT,
  readKernelAssignedPort,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';
import { writeDefineStackConfig } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. */
const CLI = resolve(HERE, '../bin/run.js');

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
/** The parent's line once the first child after the upgrade is listening. */
const UPGRADED_READY = /server started on the upgraded database/;
const BOOT_TIMEOUT_MS = 180_000;
const ALL_BOOTS_TIMEOUT_MS = 2 * (BOOT_TIMEOUT_MS + 30_000);

const STALE = ['sys_flow_credential', 'sys_secret'] as const;
const MARKER = 'adr-0131-organization-ownership';

/** One object, and the automation service whose plugin declares `sys_flow_credential`. */
const SCAFFOLD = {
  manifest: { id: 'com.example.stale-org', namespace: 'stale', version: '1.0.0', type: 'app', name: 'stale' },
  requires: ['automation'],
  objects: [{
    name: 'stale_item',
    label: 'Item',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
};

const groups: ChildProcess[] = [];
let dir: string;
let db: string;
let staged = false;
let upgradeOutput: string | Error = new Error('the upgrade boot was never run');

function hasOrganizationColumn(file: string, table: string): boolean {
  const handle = new Database(file, { readonly: true });
  try {
    return (handle.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).some((c) => c.name === 'organization_id');
  } finally {
    handle.close();
  }
}

/** The pre-release shape: the injected column and its index on both objects, one stamped row, no marker. */
function stagePreReleaseShape(): void {
  const handle = new Database(db);
  try {
    for (const table of STALE) {
      handle.exec(`ALTER TABLE "${table}" ADD COLUMN "organization_id" varchar(255)`);
      handle.exec(`CREATE INDEX "idx_${table}_organization_id" ON "${table}" ("organization_id")`);
    }
    const organization = handle.prepare('SELECT id FROM sys_organization ORDER BY id LIMIT 1').get() as { id: string } | undefined;
    if (!organization) throw new Error('the fresh boot created no Default Organization to stamp the stale row with');
    handle
      .prepare('INSERT INTO sys_secret (id, namespace, key, ciphertext, organization_id) VALUES (?, ?, ?, ?, ?)')
      .run('sec_stale', 'setting', 'stale.key', 'x', organization.id);
    handle
      .prepare('INSERT INTO sys_flow_credential (id, flow_name, state, node_id, credential_key, position, value) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('fc_stale', 'stale_flow', 'active', 'n1', 'token', 'p1', 'secret:sec_stale');
    handle.prepare('DELETE FROM sys_migration WHERE id = ?').run(MARKER);
  } finally {
    handle.close();
  }
}

/**
 * Boot `os dev` until `ready` matches, then stop the whole group and return what it printed.
 * `-p KERNEL_ASSIGNED_PORT` (#24295); nothing here talks to the port.
 */
function bootUntil(ready: RegExp): Promise<string> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(process.execPath, [CLI, 'dev', '--no-watch', '-d', 'file:A.db', '-p', KERNEL_ASSIGNED_PORT], {
      cwd: dir,
      // `childEnv`, never a bare `...process.env` — see its header. `NODE_ENV`
      // unset, so the built entry resolves its commands from `dist/`.
      env: childEnv({
        NO_COLOR: '1',
        OS_CLOUD_URL: 'off',
        OS_DISABLE_CONSOLE: '1',
        OS_SECRET_KEY: E2E_SECRET_KEY,
        OS_TELEMETRY_DB: '0',
        OS_DATABASE_URL: undefined,
        OS_ARTIFACT_URL: undefined,
        OS_ARTIFACT_PATH: undefined,
        OS_MODE: undefined,
        NODE_ENV: undefined,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Own process group: `dev` supervises a `serve` grandchild.
      detached: true,
    });
    groups.push(child);
    let out = '';
    let settled = false;
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) {
        stopGroup(child).then(() => rejectBoot(err), () => rejectBoot(err));
        return;
      }
      // Stop BEFORE the file is read: the boot's own writes are flushed on exit.
      stopGroup(child).then(() => resolveBoot(out), rejectBoot);
    };
    const timer = setTimeout(
      () => finish(new Error(`os dev never printed ${ready}\n--- output ---\n${out.slice(-6000)}`)),
      BOOT_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      out += String(d);
      if (!ready.test(out) || !READY.test(out)) return;
      const bound = readKernelAssignedPort(out, 'os dev');
      finish(bound instanceof Error ? bound : null);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) =>
      finish(new Error(`os dev exited ${String(code)} before ${ready}\n--- output ---\n${out.slice(-6000)}`)),
    );
  });
}

async function stopGroup(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const give = setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
      done();
    }, 15_000);
    child.once('exit', () => { clearTimeout(give); done(); });
    try { process.kill(-child.pid!, 'SIGTERM'); } catch { clearTimeout(give); done(); }
  });
}

function upgraded(): string {
  if (upgradeOutput instanceof Error) throw upgradeOutput;
  return upgradeOutput;
}

/** The copy the upgrade kept: `backups/organization-ownership-<stamp>/` beside the database. */
function backupDir(): string {
  const root = join(dir, 'backups');
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => d.startsWith('organization-ownership-')) : [];
  expect(dirs, `backups: ${dirs.join(', ')}`).toHaveLength(1);
  return join(root, dirs[0]!);
}

beforeAll(async () => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  dir = mkdtempSync(join(tmpdir(), 'os-26615-dev-'));
  writeDefineStackConfig(dir, SCAFFOLD);
  db = join(dir, 'A.db');

  // Boot 1: a fresh `os dev` creates every table this release declares.
  await bootUntil(READY);
  if (!existsSync(db)) return;
  stagePreReleaseShape();
  staged = true;

  // Boot 2: the developer's `os dev` after pulling main — refused, upgraded, started.
  try {
    upgradeOutput = await bootUntil(UPGRADED_READY);
  } catch (error) {
    upgradeOutput = error instanceof Error ? error : new Error(String(error));
  }
}, ALL_BOOTS_TIMEOUT_MS);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('#26615 — `os dev` starts a development database with a stale organization_id on objects that retired it', () => {
  it('the fixture is the pre-release shape: both columns staged', () => {
    expect(staged, 'the fresh boot created no A.db').toBe(true);
  });

  it('⭐ the refused boot is upgraded in place and the server starts on it', () => {
    const output = upgraded();
    expect(output).toContain('organization-ownership boot guard refused this development database');
    expect(output).toContain('Upgraded the development database to the v18 organization ownership.');
    expect(output).not.toContain('The upgrade did not run to a report');
    expect(output).toMatch(UPGRADED_READY);
  });

  it('the stamped value the drop discards is said, with its count, before the apply runs', () => {
    const output = upgraded();
    const said = output.indexOf('sys_secret: the plan drops its retired organization_id column, discarding 1 stamped value(s)');
    expect(said, output.slice(-4000)).toBeGreaterThan(-1);
    expect(said).toBeLessThan(output.indexOf('Upgraded the development database'));
    // The unstamped table discards nothing, so it is not named.
    expect(output).not.toContain('sys_flow_credential: the plan drops');
  });

  it('both stale columns are dropped, and the marker the guard reads is verified', () => {
    upgraded();
    for (const table of STALE) expect(hasOrganizationColumn(db, table), table).toBe(false);
    const handle = new Database(db, { readonly: true });
    try {
      const marker = handle.prepare('SELECT verified_at FROM sys_migration WHERE id = ?').get(MARKER) as
        | { verified_at: string | null }
        | undefined;
      expect(marker?.verified_at, 'no verified organization-ownership marker').toBeTruthy();
      // The rows themselves are kept: only the column the objects retired went.
      expect(handle.prepare('SELECT id FROM sys_secret WHERE id = ?').get('sec_stale')).toBeTruthy();
      expect(handle.prepare('SELECT id FROM sys_flow_credential WHERE id = ?').get('fc_stale')).toBeTruthy();
    } finally {
      handle.close();
    }
  });

  it('the copy taken before the upgrade is kept, with the stale columns still in it', () => {
    upgraded();
    const copy = backupDir();
    expect(readdirSync(copy)).toEqual(expect.arrayContaining(['A.db', 'plan.json', 'apply.json', 'ceremony.log']));
    for (const table of STALE) expect(hasOrganizationColumn(join(copy, 'A.db'), table), table).toBe(true);
  });
});
