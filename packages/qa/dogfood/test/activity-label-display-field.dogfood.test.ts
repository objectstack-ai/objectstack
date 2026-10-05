// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21878] An activity row names its record by the record's ADR-0079 title, on
// a real boot, through the REST doors.
//
// ## The composition
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, SQL driver, REST and
// auth layers, plus `AuditPlugin`, whose CRUD mirror writes the rows from REST
// writes and whose read seams serve them. Two synthetic objects:
//
//   - a customer object titled only by `company_name` — no `name` field and no
//     `nameField`, the shape an AI-built object takes;
//   - an object with `name` (and a `title` beside it), labelled as it always was.
//
// ## What is asserted
//
// - The create and update rows about a customer carry its company name as the
//   record label; a customer whose title is empty is labelled by its id.
// - The `name` object is labelled by `name`, not by its `title`.
// - #21081's masking holds on the resolved field: a reader a permission set
//   withholds `company_name` from is served the customer's rows without the
//   label, and the control reader is served it.
//
// The scene is proven engaged before anything is believed (`assertArmed`): the
// rows exist at rest, and the data plane serves the withheld reader the
// customer without `company_name` and the control with it.
//
// Fixtures are synthetic. ⚠️ No test title states a value.
// `@objectstack/plugin-audit` resolves through its BUILT output here (a
// ledgered pair in `scripts/check-test-source-alias.mjs`), so a verdict on a
// change to it is a verdict on its last build.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { assertArmed, armedWhen } from './armed.js';

const CUSTOMER = 'ald_customer';
const NAMED = 'ald_named';
const SYS = { context: { isSystem: true } } as const;

/** Synthetic values. */
const V = {
  company: 'ALDCOMPANYONE61',
  companyRenamed: 'ALDCOMPANYTWO62',
  name: 'ALDNAME63',
  title: 'ALDTITLE64',
};

const Customer = ObjectSchema.create({
  name: CUSTOMER,
  label: 'ALD Customer',
  pluralLabel: 'ALD Customers',
  sharingModel: 'public_read_write',
  fields: {
    company_name: Field.text({ label: 'Company Name' }),
    phone: Field.phone({ label: 'Phone' }),
    status: Field.select(['active', 'lost'], { label: 'Status' }),
  },
});
const Named = ObjectSchema.create({
  name: NAMED,
  label: 'ALD Named',
  pluralLabel: 'ALD Named',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name' }),
    title: Field.text({ label: 'Title' }),
  },
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.activity-label-display-field',
    namespace: 'ald',
    version: '0.0.0',
    type: 'app',
    name: 'Activity Label Display Field Fixture',
    description: 'An object titled only by company_name and an object titled by name, mirrored on the activity timeline.',
  },
  objects: [Customer, Named],
});

const objectGrants = Object.fromEntries(
  [CUSTOMER, NAMED].map((o) => [o, { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false }]),
);
const grants = { ...objectGrants, sys_activity: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } };
const baselineSet = PermissionSetSchema.parse({ name: 'ald_baseline', label: 'ALD baseline', objects: grants });
const withholdSet = PermissionSetSchema.parse({
  name: 'ald_withhold_set',
  label: 'ALD withhold',
  objects: grants,
  fields: { [`${CUSTOMER}.company_name`]: { readable: false, editable: false } },
});

/** Each principal, and the sets it holds. */
const PRINCIPALS: Record<'writer' | 'withheld' | 'control', string[]> = {
  writer: [baselineSet.name],
  withheld: [withholdSet.name],
  control: [baselineSet.name],
};

type Row = Record<string, any>;
const rowsOf = (body: any): Row[] => body?.records ?? body?.data ?? (Array.isArray(body) ? body : []);
const recordOf = (body: any): Row => body?.record ?? body;
const idOfBody = (body: any): string => String(body?.id ?? body?.record?.id ?? '');

describe('[#21878] an activity row names its record by the ADR-0079 title, with the id as the floor', () => {
  let stack: VerifyStack;
  let ql: any;
  const token: Record<string, string> = {};
  const ids: Record<'customer' | 'customerEmpty' | 'named', string> = {} as never;

  /** The activity rows about `object`/`id` a principal is served through the list door. */
  const servedRows = async (who: keyof typeof PRINCIPALS, object: string, id: string): Promise<Row[]> => {
    const filter = encodeURIComponent(JSON.stringify({ object_name: object, record_id: id }));
    const res = await stack.apiAs(token[who], 'GET', `/data/sys_activity?$filter=${filter}`);
    expect(res.status).toBe(200);
    return rowsOf(await res.json());
  };
  const ofType = (rows: Row[], type: string): Row | undefined => rows.find((r) => r.type === type);

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet, withholdSet],
        fallbackPermissionSet: baselineSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    const idOf = async (object: string, where: Record<string, unknown>) =>
      String((await ql.findOne(object, { where, context: { isSystem: true } }))?.id ?? '');

    for (const who of Object.keys(PRINCIPALS) as Array<keyof typeof PRINCIPALS>) {
      const email = `ald-${who}@verify.test`;
      token[who] = await stack.signUp(email);
      const userId = await idOf('sys_user', { email });
      for (const name of PRINCIPALS[who]) {
        const setId = await idOf('sys_permission_set', { name });
        expect(setId, `fixture permission set ${name} seeded`).toBeTruthy();
        await ql.insert('sys_user_permission_set', { user_id: userId, permission_set_id: setId }, SYS);
      }
    }

    // Every row is written by the real CRUD mirror, from REST writes.
    const post = async (object: string, body: Row) => {
      const res = await stack.apiAs(token.writer, 'POST', `/data/${object}`, body);
      expect(res.status).toBe(201);
      return idOfBody(await res.json());
    };
    ids.customer = await post(CUSTOMER, { company_name: V.company, phone: '+1-555-0100', status: 'active' });
    const update = await stack.apiAs(token.writer, 'PATCH', `/data/${CUSTOMER}/${ids.customer}`, { company_name: V.companyRenamed });
    expect(update.status).toBe(200);
    ids.customerEmpty = await post(CUSTOMER, { company_name: '', phone: '+1-555-0101', status: 'lost' });
    ids.named = await post(NAMED, { name: V.name, title: V.title });

    const dataPlane = async (who: keyof typeof PRINCIPALS) => {
      const res = await stack.apiAs(token[who], 'GET', `/data/${CUSTOMER}/${ids.customer}`);
      const rec = recordOf(await res.json());
      return { status: res.status, companyName: !('company_name' in rec) ? 'absent' : rec.company_name === V.companyRenamed ? 'stored' : 'replaced' };
    };

    await assertArmed([
      armedWhen({
        control: 'the mirror wrote a created row for every record, and an updated row for the renamed customer',
        disarmedBy: 'a mirror that wrote no row would let every label case below read an empty list',
        observe: async () => {
          const types = async (object: string, id: string) =>
            ((await ql.find('sys_activity', { where: { object_name: object, record_id: id }, context: { isSystem: true } })) as Row[])
              .map((r) => r.type).sort().join(',');
          return {
            customer: await types(CUSTOMER, ids.customer),
            customerEmpty: await types(CUSTOMER, ids.customerEmpty),
            named: await types(NAMED, ids.named),
          };
        },
        armed: (o) => o.customer === 'created,updated' && o.customerEmpty === 'created' && o.named === 'created',
        describe: (o) => JSON.stringify(o),
      }),
      armedWhen({
        control: 'the data plane serves the withheld reader the customer without company_name, and the control with it',
        disarmedBy: 'a withholding set that did not resolve would make the masking case measure an unrestricted reader',
        observe: async () => ({ withheld: await dataPlane('withheld'), control: await dataPlane('control') }),
        armed: (o) =>
          o.withheld.status === 200 && o.withheld.companyName === 'absent' &&
          o.control.status === 200 && o.control.companyName === 'stored',
        describe: (o) => JSON.stringify(o),
      }),
    ]);
  }, 180_000);

  afterAll(async () => {
    if (stack) await stack.stop();
  });

  it('a company_name-titled object: the created and updated rows are labelled by the company name', async () => {
    const rows = await servedRows('control', CUSTOMER, ids.customer);
    expect(ofType(rows, 'created')?.record_label).toBe(V.company);
    expect(ofType(rows, 'updated')?.record_label).toBe(V.companyRenamed);
    expect(String(ofType(rows, 'created')?.summary)).toContain(V.company);
  });

  it('an object with name is labelled by name, as before', async () => {
    const rows = await servedRows('control', NAMED, ids.named);
    expect(ofType(rows, 'created')?.record_label).toBe(V.name);
  });

  it('an empty title falls back to the record id', async () => {
    const rows = await servedRows('control', CUSTOMER, ids.customerEmpty);
    expect(ofType(rows, 'created')?.record_label).toBe(ids.customerEmpty);
  });

  it('a reader withheld the resolved title field is served the rows without the label', async () => {
    const rows = await servedRows('withheld', CUSTOMER, ids.customer);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const row of rows) expect(row).not.toHaveProperty('record_label');
    const blob = JSON.stringify(rows);
    expect(blob).not.toContain(V.company);
    expect(blob).not.toContain(V.companyRenamed);
  });
});
