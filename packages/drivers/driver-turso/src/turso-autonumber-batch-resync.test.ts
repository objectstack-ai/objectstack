// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6943] The Turso faces, held against each other on the batch/upsert re-seed.
 *
 * `TursoDriver extends SqlDriver` but picks its engine from the `url` it was
 * constructed with, and #6203 is the shape where that costs a fix half its
 * reach: one driver, two answers. So both faces are stated here rather than one
 * being assumed from the other — and `bulkCreate` needs saying out loud even
 * more than `create()` did, because Turso **overrides** it (`create` and
 * `upsert` too) rather than merely inheriting: each override routes remote to
 * `RemoteTransport` and everything else to `super`, so "the base class was
 * fixed" is not on its own an answer about this face.
 *
 *  - **LOCAL (and replica, same local engine)** falls through to
 *    `super.bulkCreate` / `super.upsert` and with them the re-seed. Asserted
 *    below on rows.
 *  - **REMOTE** used to hand the batch to `RemoteTransport.bulkCreate`, which
 *    builds its own INSERT and never entered `fillAutoNumberFields` — so it had
 *    neither the defect nor the fix: on that face `auto_number` was only a
 *    column-type mapping and no sequence machinery existed to be stale. The
 *    boundary was pinned as an ASSERTION rather than a comment, so wiring
 *    autonumber into the remote transport later could not silently inherit
 *    this file's green. (That gap was #6944's; #6944 answered it with a
 *    refusal, and #21113 answered it with generation.)
 *
 * # ⚠️ [#6944 → #21113] The pin below was rewritten twice, never deleted
 *
 * This file's REMOTE case pinned an ABSENCE: `RemoteTransport` has no autonumber
 * surface on the batch path any more than on the single-row one, and a remote
 * `bulkCreate` therefore resolved with `[null, null]` in the slots. #6944
 * carried out triage's disposition B and made that face refuse LOUDLY
 * (`NOT_IMPLEMENTED`/501), raised on `TursoDriver` because
 * `RemoteTransport.create(object, data)` cannot see a field type. #21113 then
 * opened the appetite door (measured demand on the hosted product) and made
 * the driver ISSUE the numbers on this face, one row at a time through its own
 * `create` — the transport still sees no field type and still gets a row that
 * already carries its number. The absence half is still true and still worth
 * guarding; "and therefore nothing happens" is not, and neither is "and
 * therefore it refuses".
 *
 * Deleting the pin would remove the guard against a silent half-implementation
 * inside the transport; leaving it untouched would keep a green assertion
 * standing next to a claim that no longer holds. So it keeps the surface probe
 * verbatim and gains the generation AND the re-seed — asserted on `bulkCreate`
 * specifically, because Turso OVERRIDES it, so "`create` generates" is not on
 * its own an answer about this path. The generation's own suite is
 * `turso-remote-autonumber-generation.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TursoDriver } from './index.js';
import { makeLibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';

describe('[#6943] TursoDriver batch/upsert autonumber re-seed', () => {
  let driver: TursoDriver;

  const knex = () => (driver as any).knex;

  const bypassInsert = async (org: string, from: number, to: number) => {
    const rows = [];
    for (let n = from; n <= to; n++) {
      rows.push({ id: `${org}-s${n}`, organization_id: org, case_number: `CASE-${String(n).padStart(5, '0')}`, title: `seed ${n}` });
    }
    await knex()('crm_case').insert(rows);
  };

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

  it('LOCAL: bulkCreate serves a batch that a stale counter used to fail outright', async () => {
    await driver.create('crm_case', { organization_id: 'orgA', title: 'warm' }, { bypassTenantAudit: true });
    await bypassInsert('orgA', 2, 30);

    const created = await driver.bulkCreate(
      'crm_case',
      [
        { organization_id: 'orgA', title: 'b1' },
        { organization_id: 'orgA', title: 'b2' },
      ],
      { bypassTenantAudit: true } as any,
    );

    expect(created.map((r: any) => r.case_number)).toEqual(['CASE-00031', 'CASE-00032']);
  });

  it('LOCAL: upsert serves the insert a stale counter used to refuse', async () => {
    await driver.create('crm_case', { organization_id: 'orgA', title: 'warm' }, { bypassTenantAudit: true });
    await bypassInsert('orgA', 2, 30);

    const upserted = await driver.upsert(
      'crm_case',
      { organization_id: 'orgA', title: 'u1' },
      undefined,
      { bypassTenantAudit: true } as any,
    );

    expect(upserted.case_number).toBe('CASE-00031');
  });

  it('LOCAL: [#7011] a merge-path upsert keeps the existing autonumber', async () => {
    // Turso OVERRIDES `upsert` (remote → RemoteTransport, else `super`), so
    // "the base class was fixed" is not on its own an answer about this face —
    // the local route through `super.upsert` is pinned here.
    const created = await driver.create(
      'crm_case',
      { organization_id: 'orgA', title: 'original' },
      { bypassTenantAudit: true },
    );
    expect(created.case_number).toBe('CASE-00001');

    const merged = await driver.upsert(
      'crm_case',
      { id: created.id, organization_id: 'orgA', title: 'edited' },
      undefined,
      { bypassTenantAudit: true } as any,
    );
    expect(merged.case_number).toBe('CASE-00001');
    expect(merged.title).toBe('edited');
  });

  it('REMOTE: the transport still has no autonumber machinery of its own, on the batch path either', async () => {
    const remote = new TursoDriver({ url: 'libsql://example.turso.io', authToken: 'placeholder' });
    expect(remote.transportMode).toBe('remote');

    // The boundary, stated as a fact about the code rather than about a live
    // connection: `RemoteTransport` has no autonumber surface at all, on the
    // batch path any more than the single-row one. Neither #6944 nor #21113
    // added one — both acted one layer up, on the driver — so this half is
    // unchanged, and it remains what a future half-implementation inside the
    // transport has to go through.
    const transportSurface = Object.getOwnPropertyNames(
      Object.getPrototypeOf((remote as any).remoteTransport),
    );
    expect(transportSurface).toContain('bulkCreate');
    expect(transportSurface.some((m) => /autonumber|sequence/i.test(m))).toBe(false);
  });

  it('REMOTE: [#21113] and the driver numbers the batch on this face too — and re-seeds it after a seed replay', async () => {
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

    const first = await remote.bulkCreate('crm_case', [
      { organization_id: 'orgA', title: 'b1' },
      { organization_id: 'orgA', title: 'b2' },
    ]);
    expect((first as any[]).map((r) => r.case_number)).toEqual(['CASE-00001', 'CASE-00002']);

    // The LOCAL half's scenario, on the remote face: rows 3..10 land by a path
    // that never enters `fillAutoNumberFields`, so the counter sits at 2 while
    // the table holds 10. The next batch is served above it, on the first call.
    const insert = stub.raw.prepare(
      'insert into "crm_case" ("id", "organization_id", "case_number", "title") values (?, ?, ?, ?)',
    );
    for (let n = 3; n <= 10; n++) insert.run(`bypass-${n}`, 'orgA', `CASE-${String(n).padStart(5, '0')}`, `row ${n}`);

    const after = await remote.bulkCreate('crm_case', [
      { organization_id: 'orgA', title: 'b3' },
      { organization_id: 'orgA', title: 'b4' },
    ]);
    expect((after as any[]).map((r) => r.case_number)).toEqual(['CASE-00011', 'CASE-00012']);
    const count = (stub.raw.prepare('select count(*) as c from "crm_case"').all() as Array<{ c: number }>)[0].c;
    expect(count).toBe(12);

    await remote.disconnect();
  });
});
