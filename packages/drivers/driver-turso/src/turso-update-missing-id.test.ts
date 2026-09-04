// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14428] `RemoteTransport.update()` answers a missing id with `null`, so ONE
 * `TursoDriver` gives ONE answer to "update a row that is not there".
 *
 * # What was broken
 *
 * The door read:
 *
 *   return rows[0] || { id, ...data };
 *
 * `UPDATE … WHERE "id" = ?` matching nothing, then `SELECT * … WHERE "id" = ?`
 * returning nothing, still handed back a row: the caller's payload with the id
 * stapled on. The LOCAL face of the same driver (`SqlDriver.update`, reached
 * through `TursoDriver.update`'s `super` branch) answered `null` for the same
 * miss. One driver, two answers, chosen by `isRemote` — the divergence class
 * this package has already paid for in #5769, #5903, #6203 and #8413.
 *
 * Since #13878 (PR #14434) `IDataDriver.update()` declares
 * `Promise[Record[string, unknown] | null]`, so the fabricated row is not a
 * second way of satisfying the declaration — it is the value the declaration
 * distinguishes from. Maintainer ruling 2026-09-03, posture A (`null`, not
 * throw: a throw would have been a THIRD posture on top of the two this
 * collapses).
 *
 * # Why THIS file rather than cases in the remote suite
 *
 * #6203's lesson, which this package has paid for twice: a posture that
 * differs by face cannot fail a per-face suite. A divergence shows up as one
 * file red and the other green, in whichever order someone reads them. The
 * divergence itself is the defect, so the divergence is what is pinned — same
 * driver, same missing id, both faces, one assertion.
 *
 * The card measured that NO landed test pinned the miss posture on this driver
 * (`turso-driver.test.ts:138,731` and
 * `turso-remote-autonumber-refusal.test.ts:369` all read `update()` results
 * over rows that EXIST), so every pin here is net-new coverage.
 *
 * # The pins, and what each alone would miss
 *
 *  - **The transport miss pin** is the defect at its source.
 *  - **The positive control** beside it is what stops the fix from being
 *    "return `null` always" — a transport that had simply dropped the read-back
 *    would pass the miss pin and break every update that works.
 *  - **The write-still-issued pin**: the `UPDATE` statement still goes out and
 *    still affects zero rows. A "fix" that short-circuited by reading FIRST
 *    would answer `null` correctly and silently stop writing.
 *  - **The `bulkUpdate` pin** is the one the card found as DEAD CODE:
 *    `if (updated) results.push(updated)` is the cross-driver skip convention
 *    `SqlDriver.bulkUpdate` follows, and on this transport `updated` could
 *    never be falsy, so a batch over N missing ids answered N invented rows.
 *    Its mixed batch also proves the skip is per row, not all-or-nothing.
 *  - **The parity pin** holds the two `TursoDriver` faces against each other.
 *    Without it, a future revert of one face alone leaves both single-face
 *    suites green.
 *  - **The pass-through pin** covers the seam that needed no edit:
 *    `TursoDriver.update()`'s remote branch wraps the transport result in
 *    `formatRemoteRow`, whose `row && typeof row === 'object'` guard already
 *    admits `null`. That guard is load-bearing now in a way it was not before,
 *    and nothing else would notice if it were "simplified" away.
 *  - **The type pin** reads the transport's declared return type, the shape
 *    #13878's `memory-update-declared-null.test.ts` established.
 *
 * # Reverse verification — predicted direction, then what was OBSERVED
 *
 * Predicted: restoring `return rows[0] || { id, ...data };` reds the transport
 * miss pin, the no-fabrication pin, the `bulkUpdate` pin, the parity pin and
 * the pass-through pin. The positive control, the write-still-issued pin, the
 * parity positive control and the fixture premise stay GREEN — they exercise
 * arms the revert does not touch.
 *
 * ⚠️ The type pin is NOT on either list, and that is the point of writing this
 * paragraph from the measurement rather than from the shape of the fix. The
 * mutation restores an EXPRESSION; the declared return type stays
 * `Promise[Record[string, unknown] | null]`, so `Equals` still holds and the
 * const cannot red. Nothing here fails at compile time, and all ten cases run.
 * The parity pin is likewise ONE assertion over both faces, not two halves that
 * can red independently — that indivisibility is the whole reason it exists.
 *
 * Observed, with the mutation proved on disk (injected text counted, deleted
 * text absent) and the restore proved by a `git hash-object` match against the
 * HEAD blob: `Test Files 1 failed (1)`, `Tests 5 failed | 5 passed (10)`. The
 * five reds, by name: `resolves null when no row carries that id`,
 * `fabricates nothing — the id is not stapled onto the payload`,
 * `bulkUpdate() SKIPS the missing ids`, `PARITY — one missing id, two faces,
 * one answer`, and `the remote branch passes 'null' through formatRemoteRow
 * untouched`. The five greens: `pins the declared return type`, `seeded the
 * fixture (the premise)`, `still ISSUES the write`, `POSITIVE CONTROL` and
 * `PARITY POSITIVE CONTROL`.
 *
 * ⚠️ One measured trap for whoever runs that verification: the LOCAL face
 * arrives here through the BUILT `@objectstack/driver-sql` (this package
 * resolves the workspace dependency to its `dist`, and there is no vitest alias
 * to `src`), so a source edit there changes nothing until that package is
 * rebuilt. The transport and `TursoDriver` themselves ARE this package's `src`.
 */

import { describe, it, expect, beforeEach, afterEach, assert } from 'vitest';

import { RemoteTransport } from './remote-transport.js';
import { TursoDriver } from './turso-driver.js';
import { asLibsqlClient, makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

/** `any` defeats ordinary assignability checks; this is the standard detector. */
type IsAny<T> = 0 extends 1 & T ? true : false;
/** Exact (mutual, non-`any`) type equality. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type TransportUpdate = Awaited<ReturnType<RemoteTransport['update']>>;

const transportUpdateIsAny: IsAny<TransportUpdate> = false;
const transportUpdateIsContract: Equals<TransportUpdate, Record<string, unknown> | null> = true;

/** The card's object: one row that exists, one id that names nothing. */
const TASK = {
  name: 'task',
  fields: {
    title: { type: 'string' },
    owner: { type: 'string' },
  },
} as const;

describe('[#14428] RemoteTransport.update() on a missing id', () => {
  let stub: LibsqlSqliteStub;
  let transport: RemoteTransport;

  beforeEach(() => {
    stub = makeLibsqlSqliteStub();
    stub.raw.prepare('CREATE TABLE "task" (id TEXT PRIMARY KEY, title TEXT, owner TEXT)').run();
    stub.raw.prepare(`INSERT INTO "task" (id, title, owner) VALUES ('t1', 'before', 'u1')`).run();
    transport = new RemoteTransport();
    transport.setClient(asLibsqlClient(stub));
  });

  afterEach(() => {
    stub.close();
  });

  it('pins the declared return type', () => {
    expect([transportUpdateIsAny, transportUpdateIsContract]).toEqual([false, true]);
  });

  it('seeded the fixture (the premise)', () => {
    expect(stub.raw.prepare('SELECT id FROM "task" ORDER BY id').all()).toEqual([{ id: 't1' }]);
  });

  it('resolves null when no row carries that id', async () => {
    const result = await transport.update('task', 'no-such-id', { title: 'edited' });

    expect(result).toBeNull();
    // The narrowing the declared type demands of every caller.
    expect(result === null ? 'absent' : result.title).toBe('absent');
  });

  it('fabricates nothing — the id is not stapled onto the payload', async () => {
    const result = await transport.update('task', 'no-such-id', { title: 'edited', owner: 'u9' });

    // The exact shape the old fallback produced, named so the pin forbids the
    // thing rather than only wanting its absence.
    expect(result).not.toMatchObject({ id: 'no-such-id' });
    expect(Object.keys((result as Record<string, unknown> | null) ?? {})).toEqual([]);
  });

  it('still ISSUES the write — and it lands on zero rows, creating none', async () => {
    await transport.update('task', 'no-such-id', { title: 'edited' });

    // A miss must not become an insert, and the row that exists must be
    // untouched by an update aimed at a different id.
    expect(stub.raw.prepare('SELECT id, title FROM "task" ORDER BY id').all()).toEqual([
      { id: 't1', title: 'before' },
    ]);
  });

  it('POSITIVE CONTROL — an id that DOES exist still returns the updated row', async () => {
    const result = await transport.update('task', 't1', { title: 'after' });

    expect(result).not.toBeNull();
    expect(result!.id).toBe('t1');
    expect(result!.title).toBe('after');
    expect(stub.raw.prepare(`SELECT title FROM "task" WHERE id = 't1'`).all()).toEqual([{ title: 'after' }]);
  });

  it('bulkUpdate() SKIPS the missing ids — `if (updated)` is no longer dead code', async () => {
    stub.raw.prepare(`INSERT INTO "task" (id, title, owner) VALUES ('t2', 'before', 'u2')`).run();

    const results = await transport.bulkUpdate('task', [
      { id: 't1', data: { title: 'after-1' } },
      { id: 'gone-a', data: { title: 'ghost-a' } },
      { id: 't2', data: { title: 'after-2' } },
      { id: 'gone-b', data: { title: 'ghost-b' } },
    ]);

    // Two rows exist, two ids name nothing: two results, not four.
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toEqual(['t1', 't2']);
    expect(results.map((r) => r.title)).toEqual(['after-1', 'after-2']);
    // The skip is per row, not all-or-nothing: the writes that could land did.
    expect(stub.raw.prepare('SELECT id, title FROM "task" ORDER BY id').all()).toEqual([
      { id: 't1', title: 'after-1' },
      { id: 't2', title: 'after-2' },
    ]);
  });
});

describe('[#14428] both TursoDriver faces answer a missing id the same way', () => {
  let local: TursoDriver;
  let remote: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeEach(async () => {
    local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    await local.initObjects([{ ...TASK, fields: { ...TASK.fields } }]);
    await local.create('task', { id: 't1', title: 'before', owner: 'u1' }, { bypassTenantAudit: true });

    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://update-miss.turso.io', client: asLibsqlClient(stub) });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.initObjects([{ ...TASK, fields: { ...TASK.fields } }]);
    await remote.create('task', { id: 't1', title: 'before', owner: 'u1' }, { bypassTenantAudit: true });
  });

  afterEach(async () => {
    await local.disconnect();
    await remote.disconnect();
    stub.close();
  });

  it('PARITY — one missing id, two faces, one answer', async () => {
    const localMiss = await local.update('task', 'no-such-id', { title: 'edited' });
    const remoteMiss = await remote.update('task', 'no-such-id', { title: 'edited' });

    expect(localMiss).toBeNull();
    expect(remoteMiss, 'local/remote divergence on the not-found arm').toEqual(localMiss);
  });

  it('PARITY POSITIVE CONTROL — one id that exists, two faces, both return the row', async () => {
    const localHit = await local.update('task', 't1', { title: 'after' });
    const remoteHit = await remote.update('task', 't1', { title: 'after' });

    // [#14438] `update()` declares its not-found arm on both faces; the positive
    // control asserts the row arm before reading it (a narrowing assertion, not a `!`).
    assert(localHit !== null, 'local face answered the not-found arm for an existing id');
    assert(remoteHit !== null, 'remote face answered the not-found arm for an existing id');
    expect(localHit.id).toBe('t1');
    expect(remoteHit.id).toBe('t1');
    expect(localHit.title).toBe('after');
    expect(remoteHit.title).toBe('after');
  });

  it('the remote branch passes `null` through `formatRemoteRow` untouched', async () => {
    // `TursoDriver.update()`'s remote branch is
    // `this.formatRemoteRow(object, await this.remoteTransport!.update(...))`,
    // and `formatRemoteRow` guards `row && typeof row === 'object'`. That guard
    // needed no edit for this card — which is exactly why it needs a pin: it is
    // load-bearing now, and nothing else would fail if it were removed as
    // "defensive". `typeof null === 'object'`, so an unguarded `formatOutput`
    // would reach a null row here.
    const result = await remote.update('task', 'absent', { title: 'edited' });
    expect(result).toBeNull();
  });
});
