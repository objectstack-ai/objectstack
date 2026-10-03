// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21113] `auto_number` on the Turso REMOTE face: ISSUED, from the same
 * persistent counter the other two faces draw from — and the other two faces
 * untouched.
 *
 * # The history this file carries
 *
 * This is the #7089 refusal suite (`turso-remote-autonumber-refusal.test.ts`),
 * converted, not deleted. Its first life pinned #6944's disposition B: a remote
 * write that left an `auto_number` slot empty was refused `NOT_IMPLEMENTED`/501
 * before any statement was built, because `RemoteTransport` builds its own
 * `INSERT` and never entered `fillAutoNumberFields`. Measured on `main` @
 * `2f3e79351`, before the refusal, the slot was written NULL:
 *
 * ```
 * REMOTE create      -> RESOLVED case_number=null
 * REMOTE bulkCreate  -> RESOLVED [null, null]
 * REMOTE upsert      -> RESOLVED case_number=null
 * LOCAL  create      -> RESOLVED case_number="CASE-00001"
 * ```
 *
 * Triage left disposition A — implement autonumber on remote — behind the
 * appetite door "for want of measured demand", and recorded that
 * `supports.autonumber` stays `true` on this face until A ships. The demand was
 * then measured on the hosted product (objectstack-ai/cloud#2531: a hosted
 * tenant, whose database is on this transport, could not create a HotCRM
 * account — `POST /api/v1/data/crm_account` answered 501). So A shipped, and
 * every refusal case below became the generation case it was holding the
 * place of. The three-face structure, the controls and the layer pins are the
 * refusal suite's own, kept because the questions they answer did not change.
 *
 * # What is pinned, and against what
 *
 * - **Generation on every leg** (`create`, `bulkCreate`, the no-id `upsert`,
 *   the id-bearing `upsert` that INSERTS — the leg #7099 recorded as writing
 *   NULL), on a real SQLite wearing the `@libsql/client` interface, so every
 *   assertion reads a row that landed, not a statement string.
 * - **One semantics** (#6203): the local face and the remote face of the SAME
 *   database file draw from ONE `_objectstack_sequences` row under one
 *   `key_hash`, and read a seeded value's counter by one rule — suffix
 *   included (#6468) — because the shared `SqlDriver` members are CALLED, not
 *   copied. A `{field}` token the row leaves empty is refused by the same
 *   sentence on both faces, since it is the same code.
 * - **The #5495 re-seed** reaches this face: rows landed above the counter by
 *   a bypass path cost one internal retry, not a 409.
 * - **The legacy table shape** is refused, loudly, with `code` AND `status`,
 *   and nothing is written.
 * - **Still untouched**: a caller-supplied number, `update()`, an object with
 *   no `auto_number` field, and the local and replica faces.
 *
 * Cross-process atomicity — two writers in two processes — is
 * `turso-remote-autonumber-concurrency.test.ts`'s pin, since it needs real
 * processes rather than the single-threaded stub this file runs on.
 *
 * # Reverse verification — direction predicted BEFORE it was run
 *
 * ① Merge-leg exclusion dropped (the transport ignores `insertOnlyColumns`).
 *    Predicted: exactly the MERGE pins go red — the merged row comes back
 *    carrying the fresh reservation instead of `CASE-00042` — while every
 *    insert-leg pin stays green, since an over-eager merge set changes
 *    nothing about an insert.
 * ② Warm-path statement made non-atomic (read `last_value`, then write it
 *    back + 1, as two statements). Predicted: NOTHING in this file goes red —
 *    the stub serialises by construction — which is exactly why the
 *    concurrency pin lives in its own file on real processes.
 * The measured outcomes are recorded in the PR.
 */

import { describe, it, expect, afterAll, afterEach, assert } from 'vitest';
import { createClient } from '@libsql/client';
import type { DriverOptions } from '@objectstack/spec/data';
import { TursoDriver } from './index.js';
import { RemoteTransport } from './remote-transport.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import { replicaFiles } from './replica-file.testkit.js';

// A replica is a local FILE: the constructor refuses one on `:memory:`. The
// same testkit hands out the shared file the two-face block opens twice.
const dbFiles = replicaFiles();
afterAll(() => dbFiles.removeAll());

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const NUMBERED_OBJECT = {
  name: 'crm_case',
  fields: {
    organization_id: { type: 'string' },
    case_number: { type: 'autonumber', format: 'CASE-{00000}', unique: true },
    title: { type: 'string' },
  },
};

/** The control: same shape, no record number. */
const PLAIN_OBJECT = {
  name: 'crm_note',
  fields: { organization_id: { type: 'string' }, title: { type: 'string' } },
};

/** A format whose counter does NOT end the value (#6468): the suffix is read, not folded into the number. */
const SUFFIXED_OBJECT = {
  name: 'ticket',
  fields: { ticket_no: { type: 'autonumber', format: '{000}-{YYYY}' }, title: { type: 'string' } },
};

/** A format that interpolates a row field: an empty one is refused, not rendered into the wrong scope. */
const FIELD_SCOPED_OBJECT = {
  name: 'po',
  fields: { dept: { type: 'string' }, po_no: { type: 'autonumber', format: '{dept}-{000}' } },
};

const ALL_OBJECTS = [NUMBERED_OBJECT, PLAIN_OBJECT, SUFFIXED_OBJECT, FIELD_SCOPED_OBJECT];

/** `renderAutonumber` reads date tokens in UTC when no business timezone is given. */
const YYYY = String(new Date().getUTCFullYear());

const open: TursoDriver[] = [];

afterEach(async () => {
  while (open.length) await open.pop()!.disconnect().catch(() => {});
});

async function makeRemote() {
  const stub = makeLibsqlSqliteStub();
  const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
  open.push(driver);
  await driver.connect();
  expect(driver.transportMode).toBe('remote');
  await driver.initObjects(ALL_OBJECTS as any);
  return { driver, stub };
}

async function makeLocal() {
  const driver = new TursoDriver({ url: ':memory:' });
  open.push(driver);
  expect(driver.transportMode).toBe('local');
  await driver.initObjects([NUMBERED_OBJECT as any]);
  return driver;
}

/**
 * The third face. `syncUrl` is what makes it `replica`; the sync itself is
 * switched off because this suite is about the write path, not about the
 * network the embedded replica talks to.
 */
async function makeReplica() {
  const stub = makeLibsqlSqliteStub();
  const driver = new TursoDriver({
    url: dbFiles.next(),
    syncUrl: 'libsql://probe.turso.io',
    client: stub as never,
    sync: { onConnect: false, intervalSeconds: 0 },
  });
  open.push(driver);
  await driver.connect();
  expect(driver.transportMode).toBe('replica');
  await driver.initObjects([NUMBERED_OBJECT as any]);
  return driver;
}

const rowCount = (stub: LibsqlSqliteStub, table: string, where = '1=1', args: unknown[] = []) =>
  (stub.raw.prepare(`select count(*) as c from "${table}" where ${where}`).all(...args) as Array<{ c: number }>)[0].c;

/**
 * The counter rows on disk. The table is created the first time a number is
 * reserved, so "no table yet" is the strongest form of "nothing was reserved"
 * and answers `[]` rather than throwing.
 */
const sequenceRows = (stub: LibsqlSqliteStub): Array<Record<string, unknown>> => {
  const present = stub.raw
    .prepare(`select name from sqlite_master where type = 'table' and name = '_objectstack_sequences'`)
    .all();
  if (present.length === 0) return [];
  return stub.raw.prepare('select * from "_objectstack_sequences"').all() as Array<Record<string, unknown>>;
};

describe('[#21113] REMOTE: a record number this face now issues', () => {
  it('create — the first number, then the next, from the persistent counter', async () => {
    const { driver, stub } = await makeRemote();
    const first = await driver.create('crm_case', { organization_id: 'orgA', title: 'first' });
    const second = await driver.create('crm_case', { organization_id: 'orgA', title: 'second' });
    expect(first.case_number).toBe('CASE-00001');
    expect(second.case_number).toBe('CASE-00002');
    // On disk, not only on the returned row.
    expect(rowCount(stub, 'crm_case', '"case_number" = ?', ['CASE-00001'])).toBe(1);
    expect(rowCount(stub, 'crm_case', '"case_number" = ?', ['CASE-00002'])).toBe(1);
    // And the counter is a ROW in the database, in the key_hash shape, not a
    // number held by this process.
    const seq = sequenceRows(stub);
    expect(seq).toHaveLength(1);
    expect(seq[0]).toMatchObject({ object: 'crm_case', field: 'case_number', tenant_id: 'orgA', scope: '', last_value: 2 });
    expect(String(seq[0].key_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('bulkCreate — every row numbered, in order', async () => {
    const { driver } = await makeRemote();
    const rows = await driver.bulkCreate('crm_case', [
      { organization_id: 'orgA', title: 'b1' },
      { organization_id: 'orgA', title: 'b2' },
    ]);
    expect((rows as any[]).map((r) => r.case_number)).toEqual(['CASE-00001', 'CASE-00002']);
  });

  it('bulkCreate — an explicit number in the batch is kept, and the next empty slot continues ABOVE it', async () => {
    // The bootstrap from the data table's MAX: the explicit row lands first,
    // the cold counter scans the table, and the generated row follows it
    // rather than starting a second sequence at 1.
    const { driver } = await makeRemote();
    const rows = await driver.bulkCreate('crm_case', [
      { organization_id: 'orgA', title: 'imported', case_number: 'CASE-00007' },
      { organization_id: 'orgA', title: 'needs one' },
    ]);
    expect((rows as any[]).map((r) => r.case_number)).toEqual(['CASE-00007', 'CASE-00008']);
  });

  it('upsert with no id and no conflict keys — an insert, numbered', async () => {
    const { driver } = await makeRemote();
    const row = await driver.upsert('crm_case', { organization_id: 'orgA', title: 'u1' });
    expect(row.case_number).toBe('CASE-00001');
  });

  it('an empty string is an empty slot, exactly as `fillAutoNumberFields` reads it', async () => {
    const { driver } = await makeRemote();
    const row = await driver.create('crm_case', { organization_id: 'orgA', title: 'blank', case_number: '' });
    expect(row.case_number).toBe('CASE-00001');
  });

  it('an explicit null is an empty slot too', async () => {
    const { driver } = await makeRemote();
    const row = await driver.create('crm_case', { organization_id: 'orgA', title: 'nulled', case_number: null });
    expect(row.case_number).toBe('CASE-00001');
  });

  it('[#7099] an id-bearing upsert that INSERTS gets its number — the leg that used to land NULL', async () => {
    // Under the refusal this leg was the declared residue: it carried an id,
    // so it might merge, so it was not refused — and when it inserted, the
    // slot landed NULL and a warning said so. Now the number is reserved
    // before the statement and the insert leg carries it. No warning: there
    // is nothing left to report.
    const { driver, stub } = await makeRemote();
    const warnings: string[] = [];
    const sink = (driver as unknown as { logger: { warn: (msg: string) => void } }).logger;
    const realWarn = sink.warn;
    sink.warn = (msg: string) => { warnings.push(String(msg)); };
    try {
      const inserted = await driver.upsert('crm_case', {
        id: 'never-seen',
        organization_id: 'orgA',
        title: 'inserted by upsert',
      });
      expect(inserted.case_number).toBe('CASE-00001');
      expect(rowCount(stub, 'crm_case', '"id" = ? and "case_number" = ?', ['never-seen', 'CASE-00001'])).toBe(1);
      expect(warnings.filter((m) => /auto_number/.test(m))).toEqual([]);
    } finally {
      sink.warn = realWarn;
    }
  });

  it('the caller never sees its own object mutated by the number', async () => {
    const { driver } = await makeRemote();
    const data = { organization_id: 'orgA', title: 'untouched input' };
    const row = await driver.create('crm_case', data);
    expect(row.case_number).toBe('CASE-00001');
    expect(data).toEqual({ organization_id: 'orgA', title: 'untouched input' });
  });
});

describe('[#21113] REMOTE: what is deliberately left as it was', () => {
  it('a caller-supplied number is written unchanged — the seed replay / import path', async () => {
    const { driver } = await makeRemote();
    const row = await driver.create('crm_case', {
      organization_id: 'orgA',
      title: 'imported',
      case_number: 'CASE-09999',
    });
    expect(row.case_number).toBe('CASE-09999');
  });

  it('a batch that carries all its own numbers is written unchanged', async () => {
    const { driver, stub } = await makeRemote();
    const rows = await driver.bulkCreate('crm_case', [
      { organization_id: 'orgA', title: 'i1', case_number: 'CASE-00101' },
      { organization_id: 'orgA', title: 'i2', case_number: 'CASE-00102' },
    ]);
    expect((rows as any[]).map((r) => r.case_number)).toEqual(['CASE-00101', 'CASE-00102']);
    // Nothing was reserved for rows that brought their own numbers.
    expect(sequenceRows(stub)).toEqual([]);
  });

  it('[#7011] an id-bearing upsert MERGES and keeps the number already in the column', async () => {
    const { driver, stub } = await makeRemote();
    await driver.create('crm_case', {
      id: 'fixed1',
      organization_id: 'orgA',
      title: 'seeded',
      case_number: 'CASE-00042',
    });
    const merged = await driver.upsert('crm_case', { id: 'fixed1', organization_id: 'orgA', title: 'edited' });
    expect(merged.case_number).toBe('CASE-00042');
    expect(merged.title).toBe('edited');
    expect(rowCount(stub, 'crm_case')).toBe(1);
    // The reservation the merge did not use is a GAP in the sequence, never a
    // renumbering — the local face's rule (#7011), byte for byte: the counter
    // bootstrapped from the seeded 42, reserved 43 for the merge, and the next
    // insert takes 44.
    const next = await driver.create('crm_case', { organization_id: 'orgA', title: 'after the merge' });
    expect(next.case_number).toBe('CASE-00044');
  });

  it('[#7011] an explicit payload number does not renumber a merged row either', async () => {
    const { driver } = await makeRemote();
    await driver.create('crm_case', { id: 'fixed4', organization_id: 'orgA', title: 'seeded', case_number: 'CASE-00042' });
    const merged = await driver.upsert('crm_case', { id: 'fixed4', organization_id: 'orgA', title: 'renumber?', case_number: 'CASE-00099' });
    expect(merged.case_number).toBe('CASE-00042');
    expect(merged.title).toBe('renumber?');
  });

  it('update never needed a number and is untouched', async () => {
    const { driver } = await makeRemote();
    await driver.create('crm_case', {
      id: 'fixed2',
      organization_id: 'orgA',
      title: 'seeded',
      case_number: 'CASE-00043',
    });
    const updated = await driver.update('crm_case', 'fixed2', { title: 'renamed' });
    // [commit 2200f8ec8] `update()` declares its not-found arm; a seeded id must answer the row.
    assert(updated !== null, 'update on a seeded id answered the not-found arm');
    expect(updated.case_number).toBe('CASE-00043');
    expect(updated.title).toBe('renamed');
  });

  it('an object with no auto_number field is written exactly as before, and reserves nothing', async () => {
    const { driver, stub } = await makeRemote();
    const row = await driver.create('crm_note', { organization_id: 'orgA', title: 'n' });
    expect(typeof row.id).toBe('string');
    expect(row.title).toBe('n');
    const note = await driver.upsert('crm_note', { id: 'note1', organization_id: 'orgA', title: 'u' });
    expect(note.title).toBe('u');
    expect(sequenceRows(stub)).toEqual([]);
  });
});

describe('[#6203] one semantics: the shared SqlDriver rules, called on both faces of one database', () => {
  /**
   * The same database FILE, opened twice: once by the local face (Knex over
   * better-sqlite3), once by the remote face (`@libsql/client`'s native `file:`
   * client, which is libSQL itself — the engine a Turso endpoint runs). What
   * this pins is that the two faces compute ONE counter identity and ONE
   * bootstrap, so their numbers interleave on one row instead of colliding
   * from two.
   */
  async function makeSharedPair(objects: unknown[]) {
    const url = dbFiles.next();
    const local = new TursoDriver({ url });
    open.push(local);
    expect(local.transportMode).toBe('local');
    await local.initObjects(objects as any);

    const client = createClient({ url });
    const remote = new TursoDriver({ url: 'libsql://probe.turso.io', client });
    open.push(remote);
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.initObjects(objects as any);
    return { local, remote };
  }

  it('numbers issued by the local face and by the remote face on the same database do not collide', async () => {
    const { local, remote } = await makeSharedPair([NUMBERED_OBJECT]);
    const opts: DriverOptions = { bypassTenantAudit: true };
    const a = await local.create('crm_case', { organization_id: 'orgA', title: 'local 1' }, opts);
    const b = await remote.create('crm_case', { organization_id: 'orgA', title: 'remote 1' });
    const c = await local.create('crm_case', { organization_id: 'orgA', title: 'local 2' }, opts);
    const d = await remote.create('crm_case', { organization_id: 'orgA', title: 'remote 2' });
    expect([a, b, c, d].map((r) => r.case_number)).toEqual(['CASE-00001', 'CASE-00002', 'CASE-00003', 'CASE-00004']);

    // ONE counter row, under the key the local face computes.
    const knex = (local as any).knex;
    const rows = await knex('_objectstack_sequences').select('*');
    expect(rows).toHaveLength(1);
    expect(rows[0].key_hash).toBe((local as any).sequenceKeyHash('crm_case', 'orgA', 'case_number', ''));
    expect(Number(rows[0].last_value)).toBe(4);
  });

  it('the tenant bucket is the same rule: a different organization is a different counter on both faces', async () => {
    const { local, remote } = await makeSharedPair([NUMBERED_OBJECT]);
    const opts: DriverOptions = { bypassTenantAudit: true };
    expect((await local.create('crm_case', { organization_id: 'orgA', title: 'a' }, opts)).case_number).toBe('CASE-00001');
    expect((await remote.create('crm_case', { organization_id: 'orgB', title: 'b' })).case_number).toBe('CASE-00001');
    expect((await local.create('crm_case', { organization_id: 'orgB', title: 'b2' }, opts)).case_number).toBe('CASE-00002');
    expect((await remote.create('crm_case', { organization_id: 'orgA', title: 'a2' })).case_number).toBe('CASE-00002');
    const knex = (local as any).knex;
    const rows = await knex('_objectstack_sequences').select('tenant_id', 'last_value').orderBy('tenant_id');
    expect(rows.map((r: any) => [r.tenant_id, Number(r.last_value)])).toEqual([['orgA', 2], ['orgB', 2]]);
  });

  it('[#6468] a seeded value whose counter does not END the value is read by the shared rule on the remote face', async () => {
    // `{000}-{YYYY}` renders `005-2026`: the counter is 5, the suffix is the
    // year. Concatenating every digit would read 52026 and the next remote
    // number would jump to 52027 — the two-wrong-answers defect #6468 closed
    // by sharing `readAutonumberCounter`. Both faces answer 6.
    const { local, remote } = await makeSharedPair([SUFFIXED_OBJECT]);
    await remote.create('ticket', { title: 'seeded', ticket_no: `005-${YYYY}` });
    expect((await remote.create('ticket', { title: 'r' })).ticket_no).toBe(`006-${YYYY}`);
    expect((await local.create('ticket', { title: 'l' })).ticket_no).toBe(`007-${YYYY}`);
  });

  it('a `{field}` token the row leaves empty is refused by the same sentence on both faces, and nothing is written', async () => {
    const { remote } = await makeSharedPair([FIELD_SCOPED_OBJECT]);
    const stubbed = await makeRemote();
    const local = await makeLocal();
    await local.initObjects([FIELD_SCOPED_OBJECT as any]);

    const message = async (write: () => Promise<unknown>) =>
      write().then(
        (row) => { throw new Error(`expected a refusal, got ${JSON.stringify(row)}`); },
        (e) => (e as Error).message,
      );
    const onRemote = await message(() => remote.create('po', { po_no: '' }));
    const onLocal = await message(() => local.create('po', { po_no: '' }, { bypassTenantAudit: true }));
    expect(onRemote).toContain('Cannot generate autonumber "po.po_no" (format "{dept}-{000}"): referenced field(s) [dept] are empty on the record.');
    expect(onRemote).toBe(onLocal);

    // The refusal is raised before any statement: no row, no counter row.
    const onStub = await message(() => stubbed.driver.create('po', { po_no: '' }));
    expect(onStub).toBe(onRemote);
    expect(rowCount(stubbed.stub, 'po')).toBe(0);
    expect(sequenceRows(stubbed.stub)).toEqual([]);

    // The control: with the field set, the scope renders and the number lands.
    expect((await remote.create('po', { dept: 'OPS' })).po_no).toBe('OPS-001');
    expect((await remote.create('po', { dept: 'OPS' })).po_no).toBe('OPS-002');
    expect((await remote.create('po', { dept: 'HR' })).po_no).toBe('HR-001');
  });
});

describe('[#5495] the collision re-seed reaches the remote face', () => {
  const landByBypass = (stub: LibsqlSqliteStub, from: number, to: number) => {
    const insert = stub.raw.prepare(
      'insert into "crm_case" ("id", "organization_id", "case_number", "title") values (?, ?, ?, ?)',
    );
    for (let n = from; n <= to; n++) insert.run(`bypass-${n}`, 'orgA', `CASE-${String(n).padStart(5, '0')}`, `row ${n}`);
  };

  it('create — served on the first call after a seed replay lands above the counter', async () => {
    const { driver, stub } = await makeRemote();
    await driver.create('crm_case', { organization_id: 'orgA', title: 'first' });
    expect(sequenceRows(stub)[0].last_value).toBe(1);
    // Rows 2..30 land by a path that never enters `fillAutoNumberFields`, so
    // the counter sits at 1 while the table holds 30.
    landByBypass(stub, 2, 30);

    const created = await driver.create('crm_case', { organization_id: 'orgA', title: 'after the replay' });
    expect(created.case_number).toBe('CASE-00031');
    expect(rowCount(stub, 'crm_case', '"case_number" = ?', ['CASE-00031'])).toBe(1);
    expect(rowCount(stub, 'crm_case')).toBe(31);
    // The counter was moved FORWARD to the observed MAX, then issued from.
    expect(sequenceRows(stub)[0].last_value).toBe(31);
  });

  it('bulkCreate — the same, one row at a time', async () => {
    const { driver, stub } = await makeRemote();
    await driver.create('crm_case', { organization_id: 'orgA', title: 'first' });
    landByBypass(stub, 2, 10);
    const rows = await driver.bulkCreate('crm_case', [
      { organization_id: 'orgA', title: 'b1' },
      { organization_id: 'orgA', title: 'b2' },
    ]);
    expect((rows as any[]).map((r) => r.case_number)).toEqual(['CASE-00011', 'CASE-00012']);
    expect(rowCount(stub, 'crm_case')).toBe(12);
  });

  it('a duplicate on a value the CALLER typed is still the caller\'s 409 — never retried, never re-seeded', async () => {
    const { driver, stub } = await makeRemote();
    await driver.create('crm_case', { organization_id: 'orgA', title: 'first', case_number: 'CASE-00500' });
    const err = await driver
      .create('crm_case', { organization_id: 'orgA', title: 'dup', case_number: 'CASE-00500' })
      .then(
        (row) => { throw new Error(`expected a unique violation, got ${JSON.stringify(row)}`); },
        (e) => e as Error,
      );
    expect(err.message).toMatch(/UNIQUE constraint failed/i);
    expect(rowCount(stub, 'crm_case')).toBe(1);
    expect(sequenceRows(stub)).toEqual([]);
  });
});

describe('[#21113] REMOTE: a sequences table in the legacy shape is refused, not keyed by a second rule', () => {
  it('DATABASE_ERROR/500 before any row is written, and not cached as "ensured"', async () => {
    const stub = makeLibsqlSqliteStub();
    // A pre-`key_hash` table, as a local face older than the current shape
    // left it. The remote face cannot migrate it (no Knex connection) and must
    // not key by the legacy `(object, tenant_id, field)` rule beside the
    // shared one.
    stub.raw.prepare(
      'create table "_objectstack_sequences" ("object" text not null, "tenant_id" text not null, "field" text not null, "last_value" integer not null default 0)',
    ).run();
    const driver = new TursoDriver({ url: 'libsql://probe.turso.io', client: stub as never });
    open.push(driver);
    await driver.connect();
    await driver.initObjects([NUMBERED_OBJECT as any]);

    const refusalOf = () =>
      driver.create('crm_case', { organization_id: 'orgA', title: 'first' }).then(
        (row) => { throw new Error(`expected a refusal, got ${JSON.stringify(row)}`); },
        (e) => e as WireBearingError,
      );
    const err = await refusalOf();
    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.status).toBe(500);
    expect(err.message).toContain(
      'The sequence-counter table "_objectstack_sequences" on this database predates the key_hash shape, and the Turso REMOTE transport does not migrate it',
    );
    expect(rowCount(stub, 'crm_case')).toBe(0);
    // The legacy table is left exactly as found.
    const columns = (stub.raw.prepare('pragma table_info("_objectstack_sequences")').all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns).toEqual(['object', 'tenant_id', 'field', 'last_value']);
    // A second write probes again and refuses again — the refusal was not
    // pinned on the process as a verdict.
    const again = await refusalOf();
    expect(again.code).toBe('DATABASE_ERROR');
    expect(again.status).toBe(500);

    // The control: a caller-supplied number never needs the counter and is
    // written through, legacy table or not.
    const imported = await driver.create('crm_case', { organization_id: 'orgA', title: 'imported', case_number: 'CASE-00007' });
    expect(imported.case_number).toBe('CASE-00007');
  });
});

describe('[#6203] the other faces are untouched', () => {
  it('LOCAL still issues the number', async () => {
    const local = await makeLocal();
    const row = await local.create(
      'crm_case',
      { organization_id: 'orgA', title: 'l' },
      { bypassTenantAudit: true },
    );
    expect(row.case_number).toBe('CASE-00001');
  });

  it('LOCAL bulkCreate and upsert still issue numbers', async () => {
    const local = await makeLocal();
    const rows = await local.bulkCreate(
      'crm_case',
      [
        { organization_id: 'orgA', title: 'b1' },
        { organization_id: 'orgA', title: 'b2' },
      ],
      { bypassTenantAudit: true },
    );
    expect((rows as any[]).map((r) => r.case_number)).toEqual(['CASE-00001', 'CASE-00002']);

    const upserted = await local.upsert(
      'crm_case',
      { organization_id: 'orgA', title: 'u' },
      undefined,
      { bypassTenantAudit: true },
    );
    expect(upserted.case_number).toBe('CASE-00003');
  });

  it('REPLICA — the third face — still issues the number', async () => {
    const replica = await makeReplica();
    const row = await replica.create(
      'crm_case',
      { organization_id: 'orgA', title: 'r' },
      { bypassTenantAudit: true },
    );
    expect(row.case_number).toBe('CASE-00001');
  });
});

describe('[#21113] the layer the number is issued on, pinned', () => {
  it('RemoteTransport still cannot see a field type, so it is not the one that issues', () => {
    // `create(object, data)` — two parameters, neither of them a schema — and
    // the class caches nothing from `syncSchema`. The refusal was raised one
    // layer up for this reason, and generation happens one layer up for the
    // same reason: the transport receives a row that already carries its
    // number. Kept as an assertion so a future schema-bearing signature or an
    // autonumber member on the transport makes the decision reviewable again.
    expect(RemoteTransport.prototype.create.length).toBe(2);
    expect(Object.getOwnPropertyNames(RemoteTransport.prototype).some((m) => /autonumber|sequence/i.test(m)))
      .toBe(false);
  });

  it('TursoDriver DOES see it, in remote mode, and the capability bit is now TRUE rather than knowingly false', async () => {
    const { driver } = await makeRemote();
    const cfgs = (driver as any).autoNumberFields['crm_case'];
    expect(cfgs).toHaveLength(1);
    expect(cfgs[0]).toMatchObject({ name: 'case_number', format: 'CASE-{00000}' });
    // The bit that makes the engine defer to this driver rather than run its
    // own in-memory fallback. It stayed `true` through the refusal era and
    // flipped WITH the implementation, as triage recorded it would.
    expect((driver.supports as any).autonumber).toBe(true);
  });
});
