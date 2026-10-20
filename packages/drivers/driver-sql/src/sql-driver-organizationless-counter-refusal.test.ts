// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0131 D9, stage 8d — the autonumber counter's organization-less bucket on
 * a tenant table is retired.
 *
 * Under 17.x a row on a tenant table that carried no organization drew its
 * number from the `__global__` counter, a second counter beside the
 * organization's own that could not see it. The engine now derives or refuses
 * every such write; this file pins the driver's own half, which a caller
 * writing through the driver directly reaches: refused before anything is
 * minted or written, wherever the driver registered the organization object.
 *
 * Pinned beside it, the two places `__global__` stays the counter key: an
 * object with no tenant column, and a composition with no organization object
 * (a lean embedding), where no organization can exist.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SqlDriver } from './index.js';
import { asPre18TenantColumn } from './pre-18-tenant-column.testkit.js';
import {
  ORGANIZATIONLESS_COUNTER_REFUSAL_CODE,
  ORGANIZATIONLESS_COUNTER_REFUSAL_STATUS,
} from './organizationless-counter-refusal.js';

const ORG = 'org_8d_counter';

const ORGANIZATION_OBJECT = { name: 'sys_organization', tenancy: { enabled: false }, fields: { name: { type: 'text' } } };

const CASE_OBJECT = {
  name: 'crm_case',
  fields: {
    subject: { type: 'text' },
    organization_id: { type: 'text' },
    case_number: { type: 'autonumber', format: 'CASE-{0000}' },
  },
};

const CATALOG_OBJECT = {
  name: 'catalog_entry',
  tenancy: { enabled: false },
  fields: {
    label: { type: 'text' },
    organization_id: { type: 'text' },
    entry_number: { type: 'autonumber', format: 'ENT-{0000}' },
  },
};

const open: SqlDriver[] = [];

async function bootDriver(objects: any[]): Promise<SqlDriver> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  open.push(driver);
  await driver.initObjects(objects);
  return driver;
}

const sequences = async (driver: SqlDriver) =>
  ((await (driver as any).knex('_objectstack_sequences').select('object', 'tenant_id', 'last_value')) as any[]).map(
    (r) => ({ object: String(r.object), tenant: String(r.tenant_id), lastValue: Number(r.last_value) }),
  );

const rowCount = async (driver: SqlDriver, table: string) =>
  Number(((await (driver as any).knex(table).count({ n: '*' })) as any[])[0].n);

afterEach(async () => {
  while (open.length) await open.pop()?.disconnect();
});

describe('[ADR-0131 D9, 8d] the counter refuses an organization-less row on a tenant table', () => {
  it('create(): refused with the engine twin code, nothing minted and nothing written', async () => {
    const driver = await bootDriver([ORGANIZATION_OBJECT, CASE_OBJECT]);

    let refusal: any;
    try {
      await driver.create('crm_case', { subject: 'no organization' });
    } catch (e) {
      refusal = e;
    }
    expect(refusal, 'the organization-less create was accepted').toBeDefined();
    expect(refusal.code).toBe(ORGANIZATIONLESS_COUNTER_REFUSAL_CODE);
    expect(refusal.code).toBe('ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED');
    expect(refusal.status).toBe(ORGANIZATIONLESS_COUNTER_REFUSAL_STATUS);
    expect(refusal.message).toMatch(/^Autonumber 'crm_case\.case_number' was REFUSED/);

    expect(await rowCount(driver, 'crm_case')).toBe(0);
    expect(await sequences(driver)).toEqual([]);
  });

  it('bulkCreate(): one organization-less row refuses the batch, nothing written', async () => {
    const driver = await bootDriver([ORGANIZATION_OBJECT, CASE_OBJECT]);

    await expect(
      driver.bulkCreate('crm_case', [
        { subject: 'carries one', organization_id: ORG },
        { subject: 'carries none' },
      ]),
    ).rejects.toMatchObject({ code: ORGANIZATIONLESS_COUNTER_REFUSAL_CODE, status: 500 });

    expect(await rowCount(driver, 'crm_case')).toBe(0);
  });

  it('a row that carries its organization — on the record or as the tenantId option — draws from that organization', async () => {
    const driver = await bootDriver([ORGANIZATION_OBJECT, CASE_OBJECT]);

    const onRecord = await driver.create('crm_case', { subject: 'on the record', organization_id: ORG });
    const onOption = await driver.create('crm_case', { subject: 'as the option' }, { tenantId: ORG } as any);

    expect(onRecord.case_number).toBe('CASE-0001');
    expect(onOption.case_number).toBe('CASE-0002');
    expect(await sequences(driver)).toEqual([{ object: 'crm_case', tenant: ORG, lastValue: 2 }]);
  });

  it('an object with NO tenant column keeps the installation counter, `__global__`', async () => {
    const driver = await bootDriver([ORGANIZATION_OBJECT, CATALOG_OBJECT]);

    const first = await driver.create('catalog_entry', { label: 'one' });
    expect(first.entry_number).toBe('ENT-0001');
    expect(await sequences(driver)).toEqual([{ object: 'catalog_entry', tenant: '__global__', lastValue: 1 }]);
  });

  it('a composition with no organization object (a lean embedding) keeps `__global__` on a tenant table', async () => {
    const driver = await bootDriver([CASE_OBJECT]);
    // The organization-less row itself lands only where the tenant column is
    // nullable — a table built before 18.x (ADR-0131 D1 makes a fresh one NOT
    // NULL, so a lean embedding's fresh table refuses it at the database). The
    // counter's bucket is this case's subject, so the table is that store's.
    await asPre18TenantColumn(driver, 'crm_case');

    const first = await driver.create('crm_case', { subject: 'lean embedding' });
    expect(first.case_number).toBe('CASE-0001');
    expect(await sequences(driver)).toEqual([{ object: 'crm_case', tenant: '__global__', lastValue: 1 }]);
  });
});
