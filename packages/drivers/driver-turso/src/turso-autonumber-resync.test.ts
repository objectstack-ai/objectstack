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
 *    absence is pinned as an ASSERTION rather than a comment, so that wiring
 *    autonumber into the remote transport later cannot silently inherit this
 *    file's green.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TursoDriver } from './index.js';

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

    await driver.create('crm_case', { organization_id: 'orgA', title: 'first' }, { bypassTenantAudit: true } as any);

    const rows = [];
    for (let n = 2; n <= 30; n++) {
      rows.push({ id: `s${n}`, organization_id: 'orgA', case_number: `CASE-${String(n).padStart(5, '0')}`, title: `seed ${n}` });
    }
    await knex('crm_case').insert(rows);

    const created = await driver.create(
      'crm_case',
      { organization_id: 'orgA', title: 'after the seeds' },
      { bypassTenantAudit: true } as any,
    );
    expect(created.case_number).toBe('CASE-00031');
  });

  it('REMOTE: the transport that bypasses this path has no autonumber machinery to re-seed', async () => {
    const remote = new TursoDriver({ url: 'libsql://example.turso.io', authToken: 'placeholder' });
    expect(remote.transportMode).toBe('remote');

    // The boundary, stated as a fact about the code rather than about a live
    // connection: `RemoteTransport` has no autonumber surface at all. When one
    // is added, this assertion is the thing that has to be revisited.
    const transportSurface = Object.getOwnPropertyNames(
      Object.getPrototypeOf((remote as any).remoteTransport),
    );
    expect(transportSurface.some((m) => /autonumber|sequence/i.test(m))).toBe(false);
  });
});
