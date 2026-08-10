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
 * # ⚠️ [#6944] What that pin says now — rewritten, not deleted
 *
 * When this file was written the remote face was SILENTLY ABSENT: a create
 * resolved and left NULL in the slot. The pin below said exactly that —
 * `RemoteTransport` carries no autonumber surface at all. #6944 carried out
 * triage's disposition B and made that face refuse LOUDLY instead
 * (`NOT_IMPLEMENTED`/501), raised on `TursoDriver` rather than on the transport,
 * because `RemoteTransport.create(object, data)` cannot see a field type.
 *
 * So the shape moved from ABSENT to EXPLICITLY REFUSED, and this pin had two
 * wrong options and one right one:
 *
 *   - DELETE it — and lose the only guard that stops a future half-implementation
 *     landing quietly inside the transport;
 *   - LEAVE it unchanged — and keep a green assertion whose surrounding claim,
 *     "that face simply doesn't have this", is no longer the whole truth.
 *
 * It is therefore rewritten to pin BOTH halves of the fact as it now stands: the
 * transport still carries no autonumber surface (the original guard, verbatim),
 * and the driver now answers with a wire identity instead of writing nothing
 * (the new fact). The refusal's own suite is
 * `turso-remote-autonumber-refusal.test.ts`; what belongs here is only the
 * boundary this file's LOCAL half is held against.
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

  it('REMOTE: the transport that bypasses this path still has no autonumber machinery to re-seed', async () => {
    const remote = new TursoDriver({ url: 'libsql://example.turso.io', authToken: 'placeholder' });
    expect(remote.transportMode).toBe('remote');

    // The boundary, stated as a fact about the code rather than about a live
    // connection: `RemoteTransport` has no autonumber surface at all. #6944 did
    // not add one — it refused one layer up — so this half is unchanged, and it
    // remains what a future half-implementation inside the transport has to go
    // through.
    const transportSurface = Object.getOwnPropertyNames(
      Object.getPrototypeOf((remote as any).remoteTransport),
    );
    expect(transportSurface.some((m) => /autonumber|sequence/i.test(m))).toBe(false);
  });

  it('REMOTE: [#6944] and having none, it refuses the create rather than writing nothing', async () => {
    // The other half of the same boundary, and the half that moved. Needs a
    // client because the refusal reads `autoNumberFields`, which only remote
    // schema-sync populates — the same registration `find()` depends on.
    const remote = new TursoDriver({
      url: 'libsql://example.turso.io',
      client: makeLibsqlSqliteStub() as never,
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

    // ⚠️ `code` AND `status`, never a bare `toThrow` (ADR-0112, #6144): the
    // point of this pin is the wire identity, and a bare throw assertion would
    // be satisfied by any error a later refactor happens to raise here.
    const err = await remote
      .create('crm_case', { organization_id: 'orgA', title: 'first' })
      .then(
        (row) => {
          throw new Error(`expected a refusal, got ${JSON.stringify(row)}`);
        },
        (e) => e as Error & { code?: string; status?: number },
      );
    expect(err.code).toBe('NOT_IMPLEMENTED');
    expect(err.status).toBe(501);

    await remote.disconnect();
  });
});
