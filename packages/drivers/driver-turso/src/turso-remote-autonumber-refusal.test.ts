// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6944] `auto_number` on the Turso REMOTE face: refused loudly, not written
 * as NULL — and the other two faces untouched.
 *
 * # The defect this replaces
 *
 * `TursoDriver` picks its transport from `url`. Local and embedded-replica
 * inherit `SqlDriver`'s write path and issue record numbers from the persistent
 * `_objectstack_sequences` table; remote overrides the write path to
 * `RemoteTransport`, which builds its own INSERT and never enters
 * `fillAutoNumberFields`. Measured on `main` @ `2f3e79351`, before this change:
 *
 * ```
 * REMOTE create      -> RESOLVED case_number=null
 * REMOTE bulkCreate  -> RESOLVED [null, null]
 * REMOTE upsert      -> RESOLVED case_number=null
 * LOCAL  create      -> RESOLVED case_number="CASE-00001"
 * ```
 *
 * Nothing upstream catches it: `supports.autonumber` is `true` on this face
 * (inherited via `...super.supports`), so the engine defers generation to the
 * driver and never runs its own fallback. A driver face that boots and silently
 * fails to deliver a declared capability is the shape #3724 ruled on, and triage
 * applied that ruling here on 2026-08-09: **disposition B — explicit refusal**.
 * Implementing autonumber on the remote transport (A) is deferred for want of
 * measured demand, not forgotten.
 *
 * # Where the refusal is raised, and why not one layer down
 *
 * `RemoteTransport.create(object, data)` takes no schema and caches none, so it
 * cannot tell an `auto_number` column from any other `TEXT` one — measured
 * (arity 2; `syncSchema` reads a schema and keeps nothing). `TursoDriver` can:
 * `registerRemoteFieldMetadata` → `registerExternalObject` classifies fields at
 * remote schema-sync time and populates `autoNumberFields`, measured live in
 * remote mode. So the refusal is raised on the driver, the layer that holds the
 * knowledge, rather than reached for from the one that does not.
 *
 * # ⚠️ Every refusal case asserts `code` AND `status`
 *
 * ADR-0112, and #6144: this refusal is one we author, and a bare
 * `rejects.toThrow()` would be satisfied by any error at all — including the
 * `Error` a future refactor throws for an unrelated reason. `NOT_IMPLEMENTED` /
 * 501 is the class, on the same two-class taxonomy this package already applies
 * to aggregate functions (#5907) and date buckets (#6212): `autonumber` is a
 * field type `@objectstack/spec` declares and this driver's other faces
 * generate, so the caller made no mistake and the gap is the backend's.
 *
 * # [#6203] Three faces, because a fix that lands on one is two answers
 *
 * The local and replica blocks are not decoration. The refusal must not leak
 * onto a face that generates numbers correctly, and "the base class was not
 * touched" is not on its own an answer about a class that OVERRIDES `create`,
 * `bulkCreate` and `upsert` to route by transport mode.
 *
 * # Reverse verification — direction predicted BEFORE it was run
 *
 * Prediction: with the refusal removed, every case in the REMOTE refusal block
 * fails through the harness's "it resolved" branch (the un-fixed code never
 * threw — it wrote NULL), NOT on a `code`/`status` comparison; the pass-through
 * block, the residue pin and all three faces' generate/merge controls stay
 * green, since none of them depends on the refusal existing.
 *
 * Measured with `refuseUngeneratableRemoteAutonumber`'s body emptied
 * (`return;`) — `8 failed | 923 passed` across the package, and the prediction
 * held:
 *
 *   - this file's REMOTE block goes 0/6, every failure through "it resolved";
 *   - the two rewritten boundary pins (`turso-autonumber-resync.test.ts`,
 *     `turso-autonumber-batch-resync.test.ts`) fail the same way, which is the
 *     point of rewriting rather than deleting them — they now go red for the
 *     defect too;
 *   - the 11 cases outside the REMOTE block stay green, confirming they pin
 *     facts true on both sides of the change and would survive a future
 *     re-implementation of A.
 *
 * One detail not predicted and worth keeping: the reverted suite does not merely
 * go red, it REPRINTS the defect — every failure message carries the resolved
 * row with `"case_number":null` (or `""` for the empty-string case) inside it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { TursoDriver } from './index.js';
import { RemoteTransport } from './remote-transport.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/** The first sentence of the refusal, spelled out rather than imported (#5240). */
const REFUSAL_SENTENCE = (object: string, field: string, path: string) =>
  `Object "${object}" declares auto_number field(s) [${field}] left empty for this ${path}, ` +
  `and the Turso REMOTE transport does not generate record numbers.`;

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
  await driver.initObjects([NUMBERED_OBJECT as any, PLAIN_OBJECT as any]);
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
    url: ':memory:',
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

const rowCount = (stub: LibsqlSqliteStub, table: string) =>
  (stub.raw.prepare(`select count(*) as c from "${table}"`).all() as Array<{ c: number }>)[0].c;

/**
 * Run a remote write that must be refused, and prove it cost nothing: the
 * refusal happens before the statement is built, so no row may appear and no
 * statement may reach the client — the rule every other refusal on this path
 * already follows.
 */
async function refusalOf(
  stub: LibsqlSqliteStub,
  write: () => Promise<unknown>,
): Promise<WireBearingError> {
  const before = rowCount(stub, 'crm_case');
  const executed: unknown[] = [];
  const realExecute = stub.execute.bind(stub);
  stub.execute = async (s: unknown) => {
    executed.push(s);
    return realExecute(s);
  };
  try {
    const resolved = await write();
    throw new Error(
      `expected the remote face to refuse, but it resolved with ${JSON.stringify(resolved)}`,
    );
  } catch (e) {
    const err = e as WireBearingError;
    if (err.message.startsWith('expected the remote face to refuse')) throw err;
    expect(executed).toEqual([]);
    expect(rowCount(stub, 'crm_case')).toBe(before);
    return err;
  } finally {
    stub.execute = realExecute;
  }
}

describe('[#6944] REMOTE: a record number this face cannot issue is refused', () => {
  it('create — NOT_IMPLEMENTED/501, nothing written', async () => {
    const { driver, stub } = await makeRemote();
    const err = await refusalOf(stub, () =>
      driver.create('crm_case', { organization_id: 'orgA', title: 'first' }),
    );
    expect(err.code).toBe('NOT_IMPLEMENTED');
    expect(err.status).toBe(501);
    expect(err.message).toContain(REFUSAL_SENTENCE('crm_case', 'case_number', 'create'));
  });

  it('bulkCreate — refused for the whole batch, no partial write', async () => {
    const { driver, stub } = await makeRemote();
    const err = await refusalOf(stub, () =>
      driver.bulkCreate('crm_case', [
        { organization_id: 'orgA', title: 'b1' },
        { organization_id: 'orgA', title: 'b2' },
      ]),
    );
    expect(err.code).toBe('NOT_IMPLEMENTED');
    expect(err.status).toBe(501);
    expect(err.message).toContain(REFUSAL_SENTENCE('crm_case', 'case_number', 'bulkCreate'));
  });

  it('bulkCreate — one numbered row among explicit ones still refuses the batch', async () => {
    const { driver, stub } = await makeRemote();
    const err = await refusalOf(stub, () =>
      driver.bulkCreate('crm_case', [
        { organization_id: 'orgA', title: 'imported', case_number: 'CASE-00007' },
        { organization_id: 'orgA', title: 'needs one' },
      ]),
    );
    expect(err.code).toBe('NOT_IMPLEMENTED');
    expect(err.status).toBe(501);
  });

  it('upsert with no id and no conflict keys — provably an insert, so refused', async () => {
    const { driver, stub } = await makeRemote();
    const err = await refusalOf(stub, () =>
      driver.upsert('crm_case', { organization_id: 'orgA', title: 'u1' }),
    );
    expect(err.code).toBe('NOT_IMPLEMENTED');
    expect(err.status).toBe(501);
    expect(err.message).toContain(REFUSAL_SENTENCE('crm_case', 'case_number', 'upsert'));
  });

  it('an empty string is an empty slot, exactly as `fillAutoNumberFields` reads it', async () => {
    const { driver, stub } = await makeRemote();
    const err = await refusalOf(stub, () =>
      driver.create('crm_case', { organization_id: 'orgA', title: 'blank', case_number: '' }),
    );
    expect(err.code).toBe('NOT_IMPLEMENTED');
    expect(err.status).toBe(501);
  });

  it('an explicit null is an empty slot too', async () => {
    const { driver, stub } = await makeRemote();
    const err = await refusalOf(stub, () =>
      driver.create('crm_case', { organization_id: 'orgA', title: 'nulled', case_number: null }),
    );
    expect(err.code).toBe('NOT_IMPLEMENTED');
    expect(err.status).toBe(501);
  });
});

describe('[#6944] REMOTE: what is deliberately NOT refused', () => {
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
    const { driver } = await makeRemote();
    const rows = await driver.bulkCreate('crm_case', [
      { organization_id: 'orgA', title: 'i1', case_number: 'CASE-00101' },
      { organization_id: 'orgA', title: 'i2', case_number: 'CASE-00102' },
    ]);
    expect((rows as any[]).map((r) => r.case_number)).toEqual(['CASE-00101', 'CASE-00102']);
  });

  it('an id-bearing upsert MERGES and keeps the number already in the column', async () => {
    const { driver } = await makeRemote();
    await driver.create('crm_case', {
      id: 'fixed1',
      organization_id: 'orgA',
      title: 'seeded',
      case_number: 'CASE-00042',
    });
    const merged = await driver.upsert('crm_case', { id: 'fixed1', organization_id: 'orgA', title: 'edited' });
    expect(merged.case_number).toBe('CASE-00042');
    expect(merged.title).toBe('edited');
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
    expect(updated.case_number).toBe('CASE-00043');
    expect(updated.title).toBe('renamed');
  });

  it('an object with no auto_number field is written exactly as before', async () => {
    const { driver } = await makeRemote();
    const row = await driver.create('crm_note', { organization_id: 'orgA', title: 'n' });
    expect(typeof row.id).toBe('string');
    expect(row.title).toBe('n');
  });

  it('[known residue, not fixed] an id-bearing upsert that INSERTS still writes NULL', async () => {
    // Stated as an assertion rather than a comment so it cannot quietly become
    // untrue in either direction. `RemoteTransport.upsert` emits
    // `INSERT … ON CONFLICT DO UPDATE`, and whether that statement merges or
    // inserts is knowable only after it runs — a round trip this refusal exists
    // to avoid. So the leg stays open, on the same deferred half (A) as the rest
    // of remote autonumber generation.
    const { driver } = await makeRemote();
    const inserted = await driver.upsert('crm_case', {
      id: 'never-seen',
      organization_id: 'orgA',
      title: 'inserted by upsert',
    });
    expect(inserted.case_number).toBeNull();
  });
});

describe('[#6203] the refusal does not leak onto the faces that generate', () => {
  it('LOCAL still issues the number', async () => {
    const local = await makeLocal();
    const row = await local.create(
      'crm_case',
      { organization_id: 'orgA', title: 'l' },
      { bypassTenantAudit: true } as any,
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
      { bypassTenantAudit: true } as any,
    );
    expect((rows as any[]).map((r) => r.case_number)).toEqual(['CASE-00001', 'CASE-00002']);

    const upserted = await local.upsert(
      'crm_case',
      { organization_id: 'orgA', title: 'u' },
      undefined,
      { bypassTenantAudit: true } as any,
    );
    expect(upserted.case_number).toBe('CASE-00003');
  });

  it('REPLICA — the third face — still issues the number', async () => {
    const replica = await makeReplica();
    const row = await replica.create(
      'crm_case',
      { organization_id: 'orgA', title: 'r' },
      { bypassTenantAudit: true } as any,
    );
    expect(row.case_number).toBe('CASE-00001');
  });
});

describe('[#6944] the layer the refusal is raised on, pinned', () => {
  it('RemoteTransport cannot see a field type, so it cannot be the one to refuse', () => {
    // `create(object, data)` — two parameters, neither of them a schema — and
    // the class caches nothing from `syncSchema`. This is the measurement that
    // decided the layer, kept as an assertion so a future schema-bearing
    // signature makes the decision reviewable again rather than stale.
    expect(RemoteTransport.prototype.create.length).toBe(2);
    expect(Object.getOwnPropertyNames(RemoteTransport.prototype).some((m) => /autonumber|sequence/i.test(m)))
      .toBe(false);
  });

  it('TursoDriver DOES see it, in remote mode, which is why it can', async () => {
    const { driver } = await makeRemote();
    const cfgs = (driver as any).autoNumberFields['crm_case'];
    expect(cfgs).toHaveLength(1);
    expect(cfgs[0]).toMatchObject({ name: 'case_number', format: 'CASE-{00000}' });
    // And the capability bit that makes the engine defer to this driver rather
    // than fill the slot itself is still `true` here — which is precisely why a
    // silent skip had nothing upstream to catch it.
    expect((driver.supports as any).autonumber).toBe(true);
  });
});
