// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24522] The 18.x line's upgrade harness: a database an 18.0 install created
// upgrades to THIS commit, boots, and keeps its data (R2), and a v17-shaped one
// is still refused (R3). Ruling record 6266750393 on the v18 epic makes R2 a
// check every PR on the line passes before it merges.
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
//   1. HEAD boots over it, composed the way `os serve` composes it — the
//      ownership boot guard included — and nothing refuses it.
//   2. It serves the fixture's data: the fixture's people sign in with their
//      18.0 passwords and read the fixture's own task.
//   3. Once HEAD has stopped, every reshaped table still holds every row the
//      fixture gave it, with the same key columns (`organization_id` among
//      them): a step that moved, deleted or re-stamped 18.0 rows outside the
//      upgrade ceremony goes red here, naming the table and the row.
//   4. The same fixture with one v17 trait added — a physical `organization_id`
//      on `sys_metadata`, an object that declares none — is refused at boot
//      with the guard's code. Until step 6 opens the ceremony that is the
//      answer a v17 database gets; step 6 rewrites this case, by name.
//
// ⛔ Additive change passes: a row HEAD's boot ADDS (an activity shard, a
// seeder's row) is not a failure, so counts are compared as "at least", and
// every fixture row is looked up by id.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isOrganizationOwnershipBootRefusal } from '@objectstack/runtime';
import type { VerifyStack } from '@objectstack/verify';
import { columnsOf, keyRowsOf, type FixtureManifest } from './upgrade-harness/fixture-manifest.js';
import { FIXTURE_NAMES, FIXTURE_PEOPLE, bootFixture } from './upgrade-harness/populate-fixture.js';
import { loadSqlIntoSqlite } from './upgrade-harness/sqlite-text-dump.js';

const FIXTURE = new URL('./upgrade-harness/fixture-18.0/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', FIXTURE), 'utf8')) as FixtureManifest;
const fixtureSql = readFileSync(new URL('database.sql', FIXTURE), 'utf8');

/** The guard's refusal down a failed boot's `cause` chain (the kernel wraps a failed `start()`). */
function refusalIn(error: unknown): unknown {
  for (let e = error, depth = 0; !!e && typeof e === 'object' && depth < 8; e = (e as { cause?: unknown }).cause, depth++) {
    if (isOrganizationOwnershipBootRefusal(e)) return e;
  }
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsOf = (body: any): any[] => (Array.isArray(body) ? body : (body?.records ?? body?.data ?? []));

describe(`[#24522] an 18.0 database (fixture from ${manifest.ref} @ ${manifest.sha.slice(0, 12)}) upgrades to HEAD and keeps its data`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'dogfood-upgrade-18x-'));
  const file = join(dir, 'upgraded.db');
  let stack: VerifyStack | undefined;
  let bootError: unknown;

  beforeAll(async () => {
    loadSqlIntoSqlite(fixtureSql, file);
    try {
      stack = await bootFixture(file);
    } catch (error) {
      bootError = error;
    }
  }, 240_000);

  afterAll(async () => {
    await stack?.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('the fixture covers every reshaped table (a vacuous fixture is no harness)', () => {
    for (const t of manifest.reshaped) expect(t.count, `${t.table} holds rows in the fixture`).toBeGreaterThan(0);
  });

  it('1. HEAD boots over the 18.0 database, and no ownership refusal stops it', () => {
    const refusal = refusalIn(bootError);
    expect(refusal, `the ownership boot guard refused the 18.0 database: ${String((refusal as Error | undefined)?.message)}`).toBeUndefined();
    expect(bootError, `the boot failed: ${String((bootError as Error | undefined)?.stack ?? bootError)}`).toBeUndefined();
  });

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

  it('3. every reshaped table keeps every 18.0 row, with its key columns, once HEAD has stopped', async () => {
    await stack?.stop();
    stack = undefined;
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      for (const t of manifest.reshaped) {
        for (const physical of t.physical) {
          const cols = columnsOf(db, physical);
          expect(cols.length, `${physical} still exists`).toBeGreaterThan(0);
          for (const c of t.keyColumns) expect(cols, `${physical}.${c} still exists`).toContain(c);
        }
        const now = keyRowsOf(db, t.physical, t.keyColumns);
        const byId = new Map(now.map((r) => [r.id, r]));
        expect(now.length, `${t.table}: ${now.length} rows now, ${t.count} in the fixture`).toBeGreaterThanOrEqual(t.count);
        for (const row of t.rows) expect(byId.get(row.id), `${t.table} row ${row.id}`).toEqual(row);
      }
    } finally {
      db.close();
    }
  });

  it('4. R3: the same database with a v17 trait is still refused at boot, with the guard\'s code', async () => {
    const v17 = join(dir, 'v17-shaped.db');
    loadSqlIntoSqlite(fixtureSql, v17);
    const db = new DatabaseSync(v17);
    try {
      expect(columnsOf(db, 'sys_metadata'), 'the 18.0 fixture carries no organization column on sys_metadata').not.toContain('organization_id');
      db.exec('ALTER TABLE sys_metadata ADD COLUMN organization_id TEXT');
    } finally {
      db.close();
    }
    let error: unknown;
    try {
      const refused = await bootFixture(v17);
      await refused.stop();
    } catch (e) {
      error = e;
    }
    const refusal = refusalIn(error);
    expect(refusal, 'the v17-shaped database was refused by the ownership boot guard').toBeDefined();
    expect((refusal as { tables?: string[] }).tables).toContain('sys_metadata');
  }, 240_000);
});
