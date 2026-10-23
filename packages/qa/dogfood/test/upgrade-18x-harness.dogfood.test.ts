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
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isOrganizationOwnershipBootRefusal } from '@objectstack/runtime';
import { ORGANIZATION_OWNERSHIP_SHAPE_GENERATION } from '@objectstack/spec/system';
import type { VerifyStack } from '@objectstack/verify';
import { columnsOf, type FixtureManifest } from './upgrade-harness/fixture-manifest.js';
import { FIXTURE_NAMES, FIXTURE_PEOPLE, bootFixture } from './upgrade-harness/populate-fixture.js';
import { loadSqlIntoSqlite } from './upgrade-harness/sqlite-text-dump.js';
import { OWNERSHIP_MARKER, SERVED_ENV, runOwnershipCeremony, runSchemaPlan } from './upgrade-harness/ceremony.js';

const FIXTURE = new URL('./upgrade-harness/fixture-18.0/', import.meta.url);
const MARKER = OWNERSHIP_MARKER;
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

/** The ceremony on `file`, as an operator runs it (`runOwnershipCeremony`). */
function ceremony(dir: string, file: string, tag: string): Record<string, unknown> {
  return runOwnershipCeremony(dir, file, tag);
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
    expect(refusal!.message).not.toMatch(/on a 17\.x release|stay on 17|every 18\.0/);
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

// [#24884] R2 from the GA: a database the published 18.0.0 created
// (`upgrade-harness/fixture-18.0.0/`, generated from the
// `@objectstack/cli@18.0.0` tag) is birth-marked, so it needs no ceremony.
// HEAD's schema plan over it holds no destructive change, HEAD boots it with
// no refusal and serves its people and its task, and once HEAD has stopped
// every 18.0.0 row of every reshaped table is still there with its key
// columns. 18.0.0's own shape is the baseline: a tenant column still nullable,
// and the COALESCE form of a unique index over it. A later step that reshapes
// either owes this database a migration, and this leg is where it shows.
//
// [ADR-0131 D1; ruling record 6328195425, letter A] The ceremony stays
// voluntary on it, and `os migrate plan` says so: its advisory lists every
// tenant column still nullable, as one the ceremony tightens, apart from the
// residue it leaves. After the ceremony only that residue is listed, and the
// shard this release rotated in NOT NULL is reported so by the ceremony. A
// fresh store of this release lists nothing.
const GA_FIXTURE = new URL('./upgrade-harness/fixture-18.0.0/', import.meta.url);

/** The physical tables of `file` whose `organization_id` is nullable. */
function nullableOrganizationTables(file: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare(
      `SELECT m.name AS name FROM sqlite_master m JOIN pragma_table_info(m.name) p
        WHERE m.type = 'table' AND p.name = 'organization_id' AND p."notnull" = 0 ORDER BY m.name`,
    ).all() as Array<{ name: string }>).map((r) => r.name);
  } finally {
    db.close();
  }
}

/** The tables carrying a column named `organization_id` that are no tenant column of what HEAD declares. */
const NOT_A_TENANT_COLUMN = [
  // Retired, its table left in place by ruling: no object declares it (the unmanaged-table section lists it).
  'sys_notification_subscription',
  // tenancy.enabled: false: better-auth's provider relation, not the tenancy anchor.
  'sys_sso_provider',
];

const isShard = (table: string): boolean => /__r\d{6,8}$/.test(table);
const gaManifest = JSON.parse(readFileSync(new URL('manifest.json', GA_FIXTURE), 'utf8')) as FixtureManifest;
const gaFixtureSql = readFileSync(new URL('database.sql', GA_FIXTURE), 'utf8');

describe(`[#24884] an 18.0.0 database (fixture from ${gaManifest.ref} @ ${gaManifest.sha.slice(0, 12)}) boots HEAD with no refusal and no destructive drift`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-upgrade-18-0-0-'));
  const file = join(dir, 'ga.db');
  let stack: VerifyStack | undefined;

  beforeAll(() => {
    loadSqlIntoSqlite(gaFixtureSql, file);
  });

  afterAll(async () => {
    await stack?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('the fixture is an 18.0.0 database: birth-marked, and covering every reshaped table', () => {
    for (const t of gaManifest.reshaped) expect(t.count, `${t.table} holds rows in the fixture`).toBeGreaterThan(0);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const marker = db.prepare('SELECT details FROM sys_migration WHERE id = ?').get(MARKER) as { details?: unknown } | undefined;
      expect(JSON.parse(String(marker?.details)).birth).toMatchObject({ shapeGeneration: 1, platformVersion: '18.0.0' });
    } finally {
      db.close();
    }
  });

  it('HEAD\'s schema plan over it holds no destructive change', () => {
    const plan = runSchemaPlan(file);
    expect(plan.changes.filter((c) => c.category === 'destructive'), 'destructive drift').toEqual([]);
  }, 320_000);

  it('[ADR-0131 D1] HEAD\'s schema plan lists its nullable tenant columns as an advisory naming the ceremony, and as no drift', () => {
    const plan = runSchemaPlan(file, SERVED_ENV);
    const advisory = plan.nullableTenantColumns;
    if (advisory.status !== 'read') throw new Error(`the advisory did not read: ${advisory.detail}`);
    expect(advisory.remedy).toBe('os migrate organization-ownership');
    const nullable = nullableOrganizationTables(file);
    const listed = advisory.columns.map((c) => c.table);
    // Every nullable tenant column, and only those: the two that are no tenant column are the difference.
    expect(nullable.filter((t) => !listed.includes(t))).toEqual(NOT_A_TENANT_COLUMN);
    expect(listed.filter((t) => !nullable.includes(t))).toEqual([]);
    expect(advisory.columns.every((c) => c.column === 'organization_id')).toBe(true);
    // The ceremony tightens all of them but its residue, each marked with why.
    const leaves = advisory.columns.filter((c) => c.ceremony === 'leaves');
    expect(leaves.map((c) => c.table).filter((t) => !isShard(t))).toEqual(['sys_email_template']);
    expect(leaves.every((c) => typeof c.reason === 'string' && c.reason.length > 0)).toBe(true);
    expect(advisory.columns.filter((c) => c.ceremony === 'tightens').length).toBeGreaterThan(50);
    // Advisory, not drift: no change names a tenant column's nullability.
    expect(plan.changes.filter((c) => c.column === 'organization_id' && c.kind === 'nullability_mismatch')).toEqual([]);
  }, 320_000);

  it('HEAD boots it with no refusal, and serves the fixture\'s people and task', async () => {
    const booted = await tryBoot(file);
    stack = booted.stack;
    expect(refusalIn(booted.error), String((booted.error as Error | undefined)?.message)).toBeUndefined();
    expect(booted.error, String((booted.error as Error | undefined)?.stack ?? booted.error)).toBeUndefined();
    const adminTok = await stack!.signIn(FIXTURE_PEOPLE.admin.email, FIXTURE_PEOPLE.admin.password);
    expect(await stack!.signIn(FIXTURE_PEOPLE.memberA.email, FIXTURE_PEOPLE.memberA.password)).toBeTruthy();
    const res = await stack!.apiAs(adminTok, 'GET', '/data/showcase_task');
    expect(res.status).toBe(200);
    expect(rowsOf(await res.json()).map((r) => String(r?.title))).toContain(`${FIXTURE_NAMES.task} — edited`);
  }, 240_000);

  // [ADR-0131 D8] Its settings rows carry their organization, and no reach
  // reads a row written with none: they still answer, through the admin's
  // Setup door and for a process-wide reader that names no organization (the
  // email brand name, the anonymous runtime config), which reads as the one
  // organization D9 derives.
  it('[ADR-0131 D8] its settings still answer: through the Setup door, and for a reader that names no organization', async () => {
    expect(stack, 'HEAD is booted').toBeDefined();
    const adminTok = await stack!.signIn(FIXTURE_PEOPLE.admin.email, FIXTURE_PEOPLE.admin.password);
    const res = await stack!.raw('/api/settings/branding', { headers: { Authorization: `Bearer ${adminTok}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { values: Record<string, { value: unknown; source: string }> } };
    expect(body.data.values.workspace_name).toMatchObject({ value: FIXTURE_NAMES.workspaceName, source: 'tenant' });

    const settings = stack!.kernel.getService('settings') as {
      get(namespace: string, key: string, ctx?: object): Promise<{ value: unknown; source: string }>;
    };
    expect(await settings.get('branding', 'workspace_name', {})).toMatchObject({ value: FIXTURE_NAMES.workspaceName, source: 'tenant' });
    expect(await settings.get('localization', 'timezone', {})).toMatchObject({ value: 'UTC', source: 'tenant' });
  }, 120_000);

  it('every 18.0.0 row of every reshaped table is still there, with its key columns', async () => {
    await stack?.stop();
    stack = undefined;
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      for (const t of gaManifest.reshaped) {
        for (const fixtureRow of t.rows) {
          const id = String(fixtureRow.id);
          const now = t.physical
            .map((physical) => db.prepare(`SELECT * FROM "${physical}" WHERE id = ?`).get(id) as Record<string, unknown> | undefined)
            .find(Boolean);
          expect(now, `${t.table} row ${id} is kept`).toBeDefined();
          const kept = Object.fromEntries(t.keyColumns.map((c) => [c, now![c] === null || now![c] === undefined ? null : String(now![c])]));
          expect(kept, `${t.table} row ${id}`).toEqual(fixtureRow);
        }
      }
    } finally {
      db.close();
    }
  });

  it('[ADR-0131 D1] after the voluntary ceremony the advisory lists only the residue it leaves, and the ceremony reports HEAD\'s shard NOT NULL', () => {
    expect(stack, 'HEAD has stopped before the ceremony reads the file').toBeUndefined();
    const ceremonied = join(dir, 'ga.ceremonied.db');
    copyFileSync(file, ceremonied);
    const report = runOwnershipCeremony(dir, ceremonied, 'ga-voluntary', SERVED_ENV) as {
      complete?: boolean;
      steps?: Array<{ step: string; summary: Record<string, number>; notes: string[] }>;
    };
    expect(report.complete).toBe(true);
    const notNull = report.steps!.find((s) => s.step === 'not-null')!;
    // The shard HEAD's boot rotated in was created NOT NULL: nothing to do, never "unsupported".
    expect(notNull.summary.alreadyNotNull, JSON.stringify(notNull)).toBeGreaterThanOrEqual(1);
    expect(notNull.notes.filter((n) => /created with \S+ nullable column/.test(n))).toEqual([]);

    const plan = runSchemaPlan(ceremonied, SERVED_ENV);
    const advisory = plan.nullableTenantColumns;
    if (advisory.status !== 'read') throw new Error(`the advisory did not read: ${advisory.detail}`);
    expect(advisory.columns.filter((c) => c.ceremony === 'tightens'), 'a column the ceremony would still tighten').toEqual([]);
    const residue = advisory.columns.map((c) => c.table);
    expect(residue.filter((t) => !isShard(t))).toEqual(['sys_email_template']);
    expect(residue.filter(isShard).length, residue.join(', ')).toBeGreaterThanOrEqual(1);
    expect(residue.sort()).toEqual(nullableOrganizationTables(ceremonied).filter((t) => !NOT_A_TENANT_COLUMN.includes(t)));
  }, 900_000);

  it('[ADR-0131 D1] a fresh store of HEAD lists no nullable tenant column', async () => {
    const fresh = join(dir, 'fresh.db');
    const booted = await bootFixture(fresh);
    await booted.stop();
    const plan = runSchemaPlan(fresh, SERVED_ENV);
    expect(plan.nullableTenantColumns).toEqual({ status: 'read', adr: 'ADR-0131 D1', remedy: 'os migrate organization-ownership', columns: [] });
    // Its only nullable `organization_id` is the opt-out, which is no tenant column.
    expect(nullableOrganizationTables(fresh)).toEqual(['sys_sso_provider']);
  }, 320_000);
});
