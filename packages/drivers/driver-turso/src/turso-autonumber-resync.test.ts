// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5495] The Turso faces, held against each other on the autonumber re-seed.
 *
 * `TursoDriver extends SqlDriver` but picks its engine from the `url` it was
 * constructed with, and #6203 is the shape where that costs a fix half its
 * reach: one driver, two answers. So both faces are stated here rather than
 * one being assumed from the other.
 *
 *  - **LOCAL (and replica, same local engine)** inherits `SqlDriver.create` and
 *    with it the re-seed. Asserted below on rows.
 *  - **REMOTE** overrides `create` to `RemoteTransport.create`, which builds
 *    its own `INSERT` and never enters `fillAutoNumberFields` at all — so it
 *    neither has this defect nor receives this fix. That is not a gap this card
 *    closes: on that face `auto_number` is only a column-type mapping
 *    (`remote-transport.ts` maps it to `TEXT`) and no sequence machinery exists
 *    to be stale. It is stated here so the boundary is on the record, and the
 *    boundary is pinned as an ASSERTION rather than a comment, so that wiring
 *    autonumber into the remote transport later cannot silently inherit this
 *    file's green.
 *
 * # ⚠️ [#6944 → #21113] What that pin says now — rewritten twice, never deleted
 *
 * When this file was written the remote face was SILENTLY ABSENT: a create
 * resolved and left NULL in the slot. The pin below said exactly that —
 * `RemoteTransport` carries no autonumber surface at all. #6944 carried out
 * triage's disposition B and made that face refuse LOUDLY instead
 * (`NOT_IMPLEMENTED`/501), raised on `TursoDriver` rather than on the
 * transport, because `RemoteTransport.create(object, data)` cannot see a
 * field type. #21113 then opened the appetite door disposition B had kept shut
 * (measured demand on the hosted product) and made that face ISSUE the number
 * — again on `TursoDriver`, for the same reason, from the same persistent
 * `_objectstack_sequences` counter this file's LOCAL half re-seeds.
 *
 * So the shape moved ABSENT → EXPLICITLY REFUSED → GENERATED, and at each step
 * this pin had two wrong options and one right one:
 *
 *   - DELETE it — and lose the only guard that stops a half-implementation
 *     landing quietly inside the transport;
 *   - LEAVE it unchanged — and keep a green assertion whose surrounding claim
 *     is no longer the whole truth.
 *
 * It is therefore rewritten to pin BOTH halves of the fact as it now stands:
 * the transport still carries no autonumber surface (the original guard,
 * verbatim), and the driver now issues the number AND re-seeds on this face
 * too — the very defect this file is about, which the remote face "neither had
 * nor received" while it issued nothing. The generation's own suite is
 * `turso-remote-autonumber-generation.test.ts`; what belongs here is only the
 * boundary this file's LOCAL half is held against, and the remote half of the
 * same re-seed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TursoDriver } from './index.js';
import { makeLibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

describe('[#5495] TursoDriver autonumber re-seed', () => {
  let driver: TursoDriver;

  beforeEach(async () => {
    driver = new TursoDriver({ url: ':memory:' });
    expect(driver.transportMode).toBe('local');
    await driver.initObjects([
      {
        name: 'crm_case',
        fields: {
          organization_id: { type: 'string' },
          case_number: { type: 'autonumber', format: 'CASE-{00000}', unique: true },
          title: { type: 'string' },
        },
      } as any,
    ]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('LOCAL: serves the create on the first attempt after a seed replay lands above the counter', async () => {
    const knex = (driver as any).knex;

    await driver.create('crm_case', { organization_id: 'orgA', title: 'first' }, { bypassTenantAudit: true });

    const rows = [];
    for (let n = 2; n <= 30; n++) {
      rows.push({ id: `s${n}`, organization_id: 'orgA', case_number: `CASE-${String(n).padStart(5, '0')}`, title: `seed ${n}` });
    }
    await knex('crm_case').insert(rows);

    const created = await driver.create(
      'crm_case',
      { organization_id: 'orgA', title: 'after the seeds' },
      { bypassTenantAudit: true },
    );
    expect(created.case_number).toBe('CASE-00031');
  });

  it('REMOTE: the transport still has no autonumber machinery of its own', async () => {
    const remote = new TursoDriver({ url: 'libsql://example.turso.io', authToken: 'placeholder' });
    expect(remote.transportMode).toBe('remote');

    // The boundary, stated as a fact about the code rather than about a live
    // connection: `RemoteTransport` has no autonumber surface at all. Neither
    // #6944 nor #21113 added one — both acted one layer up, on the driver,
    // which hands the transport a row already carrying its number — so this
    // half is unchanged, and it remains what a future half-implementation
    // inside the transport has to go through.
    const transportSurface = Object.getOwnPropertyNames(
      Object.getPrototypeOf((remote as any).remoteTransport),
    );
    expect(transportSurface.some((m) => /autonumber|sequence/i.test(m))).toBe(false);
  });

  it('REMOTE: [#21113] and the driver issues the number on this face too — and re-seeds it after a seed replay', async () => {
    // The other half of the same boundary, and the half that moved twice.
    // Needs a client because generation reads `autoNumberFields`, which only
    // remote schema-sync populates — the same registration `find()` depends on.
    const stub = makeLibsqlSqliteStub();
    const remote = new TursoDriver({
      url: 'libsql://example.turso.io',
      client: stub as never,
    });
    await remote.connect();
    await remote.initObjects([
      {
        name: 'crm_case',
        fields: {
          organization_id: { type: 'string' },
          case_number: { type: 'autonumber', format: 'CASE-{00000}', unique: true },
          title: { type: 'string' },
        },
      } as any,
    ]);

    const first = await remote.create('crm_case', { organization_id: 'orgA', title: 'first' });
    expect(first.case_number).toBe('CASE-00001');

    // The LOCAL half's scenario, on the remote face: rows 2..30 land by a path
    // that never enters `fillAutoNumberFields`, so the counter sits at 1 while
    // the table holds 30. The next create is served, at 31, on the first call.
    const insert = stub.raw.prepare(
      'insert into "crm_case" ("id", "organization_id", "case_number", "title") values (?, ?, ?, ?)',
    );
    for (let n = 2; n <= 30; n++) insert.run(`bypass-${n}`, 'orgA', `CASE-${String(n).padStart(5, '0')}`, `row ${n}`);

    const created = await remote.create('crm_case', { organization_id: 'orgA', title: 'after the replay' });
    expect(created.case_number).toBe('CASE-00031');

    await remote.disconnect();
  });
});
