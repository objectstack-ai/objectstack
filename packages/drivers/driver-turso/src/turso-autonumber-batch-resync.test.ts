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
 *  - **REMOTE** hands the batch to `RemoteTransport.bulkCreate`, which builds
 *    its own INSERT and never enters `fillAutoNumberFields` — so it has neither
 *    the defect nor the fix. On that face `auto_number` is only a column-type
 *    mapping and no sequence machinery exists to be stale; the absence is
 *    pinned as an ASSERTION rather than a comment, so wiring autonumber into
 *    the remote transport later cannot silently inherit this file's green.
 *    (That gap is #6944's, not this card's.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TursoDriver } from './index.js';

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

  it('REMOTE: the transport that bypasses this path has no autonumber machinery to re-seed', async () => {
    const remote = new TursoDriver({ url: 'libsql://example.turso.io', authToken: 'placeholder' });
    expect(remote.transportMode).toBe('remote');

    // The boundary, stated as a fact about the code rather than about a live
    // connection: `RemoteTransport` has no autonumber surface at all, on the
    // batch path any more than the single-row one. When one is added (#6944),
    // this assertion is what has to be revisited.
    const transportSurface = Object.getOwnPropertyNames(
      Object.getPrototypeOf((remote as any).remoteTransport),
    );
    expect(transportSurface).toContain('bulkCreate');
    expect(transportSurface.some((m) => /autonumber|sequence/i.test(m))).toBe(false);
  });
});
