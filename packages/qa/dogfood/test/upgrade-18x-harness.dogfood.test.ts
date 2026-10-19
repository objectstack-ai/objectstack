// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24522] The 18.x line's upgrade harness, RESTATED by 18.x step 6 (ruling
// records 6266750393, 6269955919 and 6270035914 on the v18 epic): a database
// an 18.0 install created takes the upgrade ceremony and then boots THIS
// commit with its data (R2), and so does a v17-shaped one (R3). The ceremony
// is open now, and the boot guard recognises a database by its birth marker:
// 18.0 wrote none, so an 18.0 database is refused until the ceremony has
// certified it at this release's ownership shape generation.
//
// The fixture (`upgrade-harness/fixture-18.0/`) is a showcase install of the
// 18.0 code after real use — sign-ups, an invitation, settings with a secret, a
// flow credential, the declared webhook customized and delivering, a runtime
// sharing rule, a share link, record activity — dumped to SQL text, with a
// manifest of every row of the tables steps 1–7 reshape. Regenerate it with
// `node scripts/gen-upgrade-harness-fixture.mjs --ref <ref>`; the manifest
// records the ref and commit it came from.
//
// What is asserted, on a fresh copy of the fixture:
//
//   1. R2, restated: HEAD refuses it at boot, composed the way `os serve`
//      composes it, naming the ceremony — and the refused boot writes no
//      marker.
//   1b. `os migrate organization-ownership` — the real binary, in the
//      showcase's directory — plans it and applies that plan, and the marker
//      verifies at this release's shape generation.
//   1c. HEAD then boots over it, and nothing refuses it.
//   2. It serves the fixture's data: the fixture's people sign in with their
//      18.0 passwords and read the fixture's own task.
//   2b. The fixture's declared webhook — customized in 18.0 only by switching
//      it on — now answers from its declaration, switched on by the activation
//      row the ceremony wrote: one delivery per task change, naming the
//      declaration.
//   3. Once HEAD has stopped, every 18.0 row of every reshaped table is where
//      the ceremony put it, with its key columns: kept in place, moved to its
//      sibling (identity mail, the global audit rows), re-sourced (the
//      deliveries), or deleted as a copy of a declaration (the webhook) — and
//      `organization_id` dropped where the table became deployment-level, NOT
//      NULL where it stayed.
//   4. R3, restated: the same fixture with one v17 trait added — a physical
//      `organization_id` on `sys_metadata`, an object that declares none — is
//      refused at boot with the guard's code, takes the ceremony, and boots.
//
// ⛔ Additive change passes: a row HEAD's boot ADDS (an activity shard, a
// seeder's row) is not a failure, so counts are compared as "at least", and
// every fixture row is looked up by id.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isOrganizationOwnershipBootRefusal } from '@objectstack/runtime';
import { ORGANIZATION_OWNERSHIP_SHAPE_GENERATION } from '@objectstack/spec/system';
import type { VerifyStack } from '@objectstack/verify';
import { columnsOf, type FixtureManifest } from './upgrade-harness/fixture-manifest.js';
import { FIXTURE_NAMES, FIXTURE_PEOPLE, bootFixture } from './upgrade-harness/populate-fixture.js';
import { loadSqlIntoSqlite } from './upgrade-harness/sqlite-text-dump.js';

const FIXTURE = new URL('./upgrade-harness/fixture-18.0/', import.meta.url);
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));
const CLI_ROOT = dirname(createRequire(import.meta.url).resolve('@objectstack/cli/package.json'));
const CLI_BIN = join(CLI_ROOT, 'bin', 'run.js');
const MARKER = 'adr-0131-organization-ownership';
const manifest = JSON.parse(readFileSync(new URL('manifest.json', FIXTURE), 'utf8')) as FixtureManifest;
const fixtureSql = readFileSync(new URL('database.sql', FIXTURE), 'utf8');

/** The guard's refusal down a failed boot's `cause` chain (the kernel wraps a failed `start()`). */
function refusalIn(error: unknown): unknown {
  for (let e = error, depth = 0; !!e && typeof e === 'object' && depth < 8; e = (e as { cause?: unknown }).cause, depth++) {
    if (isOrganizationOwnershipBootRefusal(e)) return e;
  }
  return undefined;
}

/** A boot of HEAD over `file`; the stack, or the error that stopped it. */
async function tryBoot(file: string): Promise<{ stack?: VerifyStack; error?: unknown }> {
  try {
    return { stack: await bootFixture(file) };
  } catch (error) {
    return { error };
  }
}

/**
 * The ceremony on `file`, as an operator runs it: the plan, then the apply of
 * that reviewed plan file — the real binary, in the showcase's directory, so it
 * composes what the deployment serves. The apply report.
 */
function ceremony(dir: string, file: string, tag: string): Record<string, unknown> {
  const run = (args: string[]) => spawnSync(process.execPath, [
    CLI_BIN, 'migrate', 'organization-ownership', '--database-url', `file:${file}`, ...args,
  ], { cwd: SHOWCASE_DIR, encoding: 'utf8', timeout: 300_000, env: { ...process.env, NO_COLOR: '1' } });
  const planFile = join(dir, `${tag}-plan.json`);
  const plan = run(['--out', planFile]);
  expect(plan.status, `the plan: ${plan.stdout}\n${plan.stderr}`).toBe(0);
  const reportFile = join(dir, `${tag}-apply.json`);
  const apply = run(['--apply', '--plan-file', planFile, '--backup-taken', '--out', reportFile, '--json']);
  expect(apply.status, `the apply: ${apply.stdout}\n${apply.stderr}`).toBe(0);
  return JSON.parse(readFileSync(reportFile, 'utf8')) as Record<string, unknown>;
}

/** The ceremony's marker on `file`: verified, blocking 0, at this release's generation. */
function expectCertified(file: string): void {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const marker = db.prepare('SELECT verified_at, blocking, details FROM sys_migration WHERE id = ?').get(MARKER) as
      | { verified_at: unknown; blocking: unknown; details: unknown }
      | undefined;
    expect(marker?.verified_at, 'the ceremony verified its marker').toBeTruthy();
    expect(Number(marker?.blocking)).toBe(0);
    expect(JSON.parse(String(marker?.details)).checkpoint?.shapeGeneration).toBe(ORGANIZATION_OWNERSHIP_SHAPE_GENERATION);
  } finally {
    db.close();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsOf = (body: any): any[] => (Array.isArray(body) ? body : (body?.records ?? body?.data ?? []));

describe(`[#24522] an 18.0 database (fixture from ${manifest.ref} @ ${manifest.sha.slice(0, 12)}) takes the ceremony, upgrades to HEAD and keeps its data`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-upgrade-18x-'));
  const file = join(dir, 'upgraded.db');
  /**
   * The ceremony's output, copied once it verified, and booted. A refused boot
   * lives on in this process, its SQLite driver never torn down, and a later
   * boot over the SAME path can meet its stale image (measured on the
   * boot-refusal-order dogfood); booting the copied bytes is the operator's
   * sequence — the refused `os serve` process has exited.
   */
  const migrated = join(dir, 'upgraded.migrated.db');
  let stack: VerifyStack | undefined;
  let refusedError: unknown;
  let bootError: unknown;
  let report: Record<string, unknown> | undefined;

  beforeAll(async () => {
    loadSqlIntoSqlite(fixtureSql, file);
    const refused = await tryBoot(file);
    await refused.stack?.stop();
    refusedError = refused.error ?? new Error('the 18.0 database booted without the ceremony');
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('the fixture covers every reshaped table (a vacuous fixture is no harness)', () => {
    for (const t of manifest.reshaped) expect(t.count, `${t.table} holds rows in the fixture`).toBeGreaterThan(0);
  });

  it('1. R2, restated: HEAD refuses the 18.0 database at boot, naming the ceremony, and writes no marker', () => {
    const refusal = refusalIn(refusedError) as { message?: string } | undefined;
    expect(refusal, `the boot was not refused by the ownership guard: ${String((refusedError as Error)?.stack ?? refusedError)}`).toBeDefined();
    expect(refusal!.message).toContain('os migrate organization-ownership');
    expect(refusal!.message).not.toMatch(/17\.x/);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      expect(db.prepare('SELECT id FROM sys_migration WHERE id = ?').all(MARKER)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('1b. R2, restated: the ceremony plans and applies it, and certifies it at this release\'s shape generation', () => {
    report = ceremony(dir, file, 'r2');
    expect(report.complete).toBe(true);
    expect(report.blocking).toBe(0);
    expectCertified(file);
    copyFileSync(file, migrated);
  }, 640_000);

  it('1c. R2, restated: HEAD then boots over it, and no ownership refusal stops it', async () => {
    expect(report, 'the ceremony ran').toBeDefined();
    const booted = await tryBoot(migrated);
    stack = booted.stack;
    bootError = booted.error;
    const refusal = refusalIn(bootError);
    expect(refusal, `the ownership boot guard refused the migrated database: ${String((refusal as Error | undefined)?.message)}`).toBeUndefined();
    expect(bootError, `the boot failed: ${String((bootError as Error | undefined)?.stack ?? bootError)}`).toBeUndefined();
  }, 240_000);

  it('2. it serves the 18.0 data: the fixture\'s people sign in, and the fixture\'s task is there', async () => {
    expect(stack).toBeDefined();
    const adminTok = await stack!.signIn(FIXTURE_PEOPLE.admin.email, FIXTURE_PEOPLE.admin.password);
    const memberTok = await stack!.signIn(FIXTURE_PEOPLE.memberA.email, FIXTURE_PEOPLE.memberA.password);
    expect(memberTok).toBeTruthy();
    const res = await stack!.apiAs(adminTok, 'GET', '/data/showcase_task');
    expect(res.status).toBe(200);
    const titles = rowsOf(await res.json()).map((r) => String(r?.title));
    expect(titles).toContain(`${FIXTURE_NAMES.task} — edited`);
  });

  // [18.x step 5a] The fixture's mirror of `showcase_task_changed` was only
  // switched on in 18.0 (customized by its `active` alone), so the ceremony
  // kept that switch as the declaration's activation row and deleted the
  // copy. The declaration now answers, once: a reader that still served the
  // row would deliver a second time.
  it('2b. the fixture\'s declared webhook dispatches exactly once on a task change, from its declaration', async () => {
    expect(stack).toBeDefined();
    const adminTok = await stack!.signIn(FIXTURE_PEOPLE.admin.email, FIXTURE_PEOPLE.admin.password);
    const hooks = rowsOf(await (await stack!.apiAs(adminTok, 'GET', `/data/sys_webhook?name=${FIXTURE_NAMES.webhook}`)).json())
      .filter((h) => h?.name === FIXTURE_NAMES.webhook);
    expect(hooks, 'the 18.0 copy is gone').toEqual([]);
    const deliveries = async () => rowsOf(await (await stack!.apiAs(adminTok, 'GET', '/data/sys_http_delivery?limit=500')).json())
      .filter((d) => d?.source === 'webhook');
    const before = new Set((await deliveries()).map((d) => String(d.id)));

    const projects = rowsOf(await (await stack!.apiAs(adminTok, 'GET', '/data/showcase_project')).json());
    const created = await stack!.apiAs(adminTok, 'POST', '/data/showcase_task', {
      title: 'Upgrade harness task (HEAD)',
      project: projects[0]?.id,
    });
    expect(created.status, await created.clone().text()).toBeLessThan(300);

    // The enqueue runs off the write path: wait for the first new row, then a
    // settle window in which a second (double) delivery would land too.
    let fresh: any[] = [];
    for (let i = 0; i < 50 && fresh.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
      fresh = (await deliveries()).filter((d) => !before.has(String(d.id)));
    }
    await new Promise((r) => setTimeout(r, 1000));
    fresh = (await deliveries()).filter((d) => !before.has(String(d.id)));
    expect(fresh.map((d) => d.ref_id), 'one delivery, from the declaration').toEqual([`declared:${FIXTURE_NAMES.webhook}`]);
  });

  it('3. every 18.0 row of every reshaped table is where the ceremony put it, with its key columns', async () => {
    await stack?.stop();
    stack = undefined;
    const db = new DatabaseSync(migrated, { readOnly: true });
    try {
      // Where a row may be now: its own table, or the deployment-level sibling it moved to.
      const SIBLING: Record<string, string> = { sys_email: 'sys_identity_email', sys_setting_audit: 'sys_platform_setting_audit' };
      // Tables that became deployment-level: their organization column is gone.
      const DEPLOYMENT_LEVEL = new Set(['sys_secret', 'sys_flow_credential']);
      const rowById = (table: string, id: string): Record<string, unknown> | undefined =>
        db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
      const project = (row: Record<string, unknown>, cols: readonly string[]): Record<string, string | null> =>
        Object.fromEntries(cols.map((c) => [c, row[c] === null || row[c] === undefined ? null : String(row[c])]));
      for (const t of manifest.reshaped) {
        for (const fixtureRow of t.rows) {
          const id = String(fixtureRow.id);
          if (t.table === 'sys_webhook') {
            // The declared webhook's copy: deleted, its switch kept as the declaration's activation row.
            for (const physical of t.physical) expect(rowById(physical, id), `sys_webhook copy ${id} is deleted`).toBeUndefined();
            continue;
          }
          const home = t.physical.find((physical) => rowById(physical, id));
          const moved = !home && SIBLING[t.table] ? SIBLING[t.table] : undefined;
          const now = home ? rowById(home, id) : moved ? rowById(moved, id) : undefined;
          expect(now, `${t.table} row ${id} is kept${SIBLING[t.table] ? ` or moved to ${SIBLING[t.table]}` : ''}`).toBeDefined();
          const cols = moved || DEPLOYMENT_LEVEL.has(t.table) ? t.keyColumns.filter((c) => c !== 'organization_id') : t.keyColumns;
          const expected = { ...project(fixtureRow, cols) };
          if (t.table === 'sys_http_delivery') expected.ref_id = `declared:${FIXTURE_NAMES.webhook}`;
          expect(project(now!, cols), `${t.table} row ${id}`).toEqual(expected);
        }
      }
      // The identity mail and the global audit rows moved; tenant mail and tenant audit stayed.
      const reset = manifest.reshaped.find((t) => t.table === 'sys_email')!.rows;
      expect(reset.filter((r) => rowById('sys_identity_email', String(r.id))).length, 'the reset mail moved').toBeGreaterThan(0);
      expect(reset.filter((r) => rowById('sys_email', String(r.id))).length, 'the invitation mail stayed').toBeGreaterThan(0);
      expect(db.prepare(`SELECT COUNT(*) AS n FROM sys_setting_audit WHERE scope = 'global'`).get()).toEqual({ n: 0 });
      // The webhook's switch, kept.
      expect(db.prepare(`SELECT active FROM sys_metadata_activation WHERE metadata_type = 'webhook' AND name = ?`).get(FIXTURE_NAMES.webhook)).toEqual({ active: 1 });
      // Deployment-level tables lost the column; the tenant tables hold it NOT NULL.
      for (const table of DEPLOYMENT_LEVEL) expect(columnsOf(db, table), table).not.toContain('organization_id');
      const notNull = (table: string): unknown =>
        (db.prepare(`SELECT "notnull" AS nn FROM pragma_table_info(?) WHERE name = 'organization_id'`).get(table) as { nn?: unknown } | undefined)?.nn;
      for (const table of ['sys_email', 'sys_setting_audit', 'sys_share_link', 'sys_member', 'sys_user_permission_set']) {
        expect(notNull(table), `${table}.organization_id is NOT NULL`).toBe(1);
      }
    } finally {
      db.close();
    }
  });

  it('4. R3, restated: the same database with a v17 trait is refused at boot, takes the ceremony, and boots', async () => {
    const v17 = join(dir, 'v17-shaped.db');
    loadSqlIntoSqlite(fixtureSql, v17);
    const db = new DatabaseSync(v17);
    try {
      expect(columnsOf(db, 'sys_metadata'), 'the 18.0 fixture carries no organization column on sys_metadata').not.toContain('organization_id');
      db.exec('ALTER TABLE sys_metadata ADD COLUMN organization_id TEXT');
    } finally {
      db.close();
    }
    const refused = await tryBoot(v17);
    await refused.stack?.stop();
    const refusal = refusalIn(refused.error);
    expect(refusal, 'the v17-shaped database was refused by the ownership boot guard').toBeDefined();
    expect((refusal as { tables?: string[] }).tables).toContain('sys_metadata');

    const v17Report = ceremony(dir, v17, 'r3');
    expect([v17Report.complete, v17Report.blocking]).toEqual([true, 0]);
    expectCertified(v17);
    const check = new DatabaseSync(v17, { readOnly: true });
    try {
      expect(columnsOf(check, 'sys_metadata')).not.toContain('organization_id');
    } finally {
      check.close();
    }
    const v17Migrated = join(dir, 'v17-shaped.migrated.db');
    copyFileSync(v17, v17Migrated);
    const booted = await tryBoot(v17Migrated);
    await booted.stack?.stop();
    expect(refusalIn(booted.error), String((booted.error as Error | undefined)?.message)).toBeUndefined();
    expect(booted.error).toBeUndefined();
  }, 900_000);
});
