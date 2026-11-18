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
import { catalogPermissionSet } from './catalog-permission-set.js';

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
        expect(await catalogPermissionSet(ql, name), `fixture permission set ${name} served by the security catalog`).toBeTruthy();
        await ql.insert('sys_user_permission_set', { user_id: userId, permission_set: name }, SYS);
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

// ── a label naming a referenced record by its title ─────────────────────────
//
// An object titled by a lookup is labelled by the referenced record's title.
// On a real boot, through the list door and the by-id door: a reader whose
// permission set withholds the target's title field is served the rows without
// the label and without a summary naming it, and keeps the record id; the
// control reader is served the title. Armed first: the data plane serves the
// withheld reader the target without its title field and the control with it,
// and the rows at rest carry the title.

const REF_TARGET = 'ald_ref_target';
const REF_TITLED = 'ald_ref_titled';
const REF_TITLE = 'ALDREFTITLE65';

const RefTarget = ObjectSchema.create({
  name: REF_TARGET,
  label: 'ALD Ref Target',
  pluralLabel: 'ALD Ref Targets',
  sharingModel: 'public_read_write',
  nameField: 'code_name',
  fields: {
    name: Field.text({ label: 'Name' }),
    code_name: Field.text({ label: 'Code Name' }),
  },
});
const RefTitled = ObjectSchema.create({
  name: REF_TITLED,
  label: 'ALD Ref Titled',
  pluralLabel: 'ALD Ref Titled',
  sharingModel: 'public_read_write',
  nameField: 'target',
  fields: {
    name: Field.text({ label: 'Name' }),
    target: Field.lookup(REF_TARGET, { label: 'Target' }),
  },
});

const refFixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.activity-label-reference-title',
    namespace: 'ald',
    version: '0.0.0',
    type: 'app',
    name: 'Activity Label Reference Title Fixture',
    description: 'An object titled by a lookup, mirrored on the activity timeline.',
  },
  objects: [RefTarget, RefTitled],
});

const refGrants = {
  ...Object.fromEntries(
    [REF_TARGET, REF_TITLED].map((o) => [o, { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false }]),
  ),
  sys_activity: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
};
const refBaselineSet = PermissionSetSchema.parse({ name: 'ald_ref_baseline', label: 'ALD ref baseline', objects: refGrants });
const refWithholdSet = PermissionSetSchema.parse({
  name: 'ald_ref_withhold_set',
  label: 'ALD ref withhold',
  objects: refGrants,
  fields: { [`${REF_TARGET}.code_name`]: { readable: false, editable: false } },
});
const REF_PRINCIPALS: Record<'writer' | 'withheld' | 'control', string[]> = {
  writer: [refBaselineSet.name],
  withheld: [refWithholdSet.name],
  control: [refBaselineSet.name],
};

describe('an activity label naming a referenced record by its title is served only to a reader served that title field', () => {
  let stack: VerifyStack;
  let ql: any;
  const token: Record<string, string> = {};
  let targetId = '';
  let recordId = '';

  const listed = async (who: keyof typeof REF_PRINCIPALS): Promise<Row[]> => {
    const filter = encodeURIComponent(JSON.stringify({ object_name: REF_TITLED, record_id: recordId }));
    const res = await stack.apiAs(token[who], 'GET', `/data/sys_activity?$filter=${filter}`);
    expect(res.status).toBe(200);
    return rowsOf(await res.json());
  };
  const byId = async (who: keyof typeof REF_PRINCIPALS, id: string): Promise<Row> => {
    const res = await stack.apiAs(token[who], 'GET', `/data/sys_activity/${id}`);
    expect(res.status).toBe(200);
    return recordOf(await res.json());
  };

  beforeAll(async () => {
    stack = await bootStack(refFixtureStack as unknown as Parameters<typeof bootStack>[0], {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, refBaselineSet, refWithholdSet],
        fallbackPermissionSet: refBaselineSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    const idOf = async (object: string, where: Record<string, unknown>) =>
      String((await ql.findOne(object, { where, context: { isSystem: true } }))?.id ?? '');

    for (const who of Object.keys(REF_PRINCIPALS) as Array<keyof typeof REF_PRINCIPALS>) {
      const email = `ald-ref-${who}@verify.test`;
      token[who] = await stack.signUp(email);
      const userId = await idOf('sys_user', { email });
      for (const name of REF_PRINCIPALS[who]) {
        expect(await catalogPermissionSet(ql, name), `fixture permission set ${name} served by the security catalog`).toBeTruthy();
        await ql.insert('sys_user_permission_set', { user_id: userId, permission_set: name }, SYS);
      }
    }

    const post = async (object: string, body: Row) => {
      const res = await stack.apiAs(token.writer, 'POST', `/data/${object}`, body);
      expect(res.status).toBe(201);
      return idOfBody(await res.json());
    };
    targetId = await post(REF_TARGET, { name: 'target', code_name: REF_TITLE });
    recordId = await post(REF_TITLED, { name: 'titled', target: targetId });
    const update = await stack.apiAs(token.writer, 'PATCH', `/data/${REF_TITLED}/${recordId}`, { name: 'titled again' });
    expect(update.status).toBe(200);

    const targetAs = async (who: keyof typeof REF_PRINCIPALS) => {
      const res = await stack.apiAs(token[who], 'GET', `/data/${REF_TARGET}/${targetId}`);
      const rec = recordOf(await res.json());
      return { status: res.status, title: !('code_name' in rec) ? 'absent' : rec.code_name === REF_TITLE ? 'stored' : 'replaced' };
    };

    await assertArmed([
      armedWhen({
        control: 'the mirror wrote a created and an updated row, each labelled by the referenced record\'s title',
        disarmedBy: 'a row labelled by an id would let every case below pass without a title to withhold',
        observe: async () =>
          ((await ql.find('sys_activity', { where: { object_name: REF_TITLED, record_id: recordId }, context: { isSystem: true } })) as Row[])
            .map((r) => `${r.type}:${r.record_label === REF_TITLE}`).sort().join(','),
        armed: (o) => o === 'created:true,updated:true',
        describe: (o) => o,
      }),
      armedWhen({
        control: 'the data plane serves the withheld reader the target without its title field, and the control with it',
        disarmedBy: 'a withholding set that did not resolve would make the withheld case measure an unrestricted reader',
        observe: async () => ({ withheld: await targetAs('withheld'), control: await targetAs('control') }),
        armed: (o) =>
          o.withheld.status === 200 && o.withheld.title === 'absent' &&
          o.control.status === 200 && o.control.title === 'stored',
        describe: (o) => JSON.stringify(o),
      }),
    ]);
  }, 180_000);

  afterAll(async () => {
    if (stack) await stack.stop();
  });

  it('a reader withheld the referenced title field is served the rows without the label or a summary naming it, list and by id', async () => {
    const rows = await listed('withheld');
    expect(rows.map((r) => r.type).sort()).toEqual(['created', 'updated']);
    for (const row of rows) {
      expect(row).not.toHaveProperty('record_label');
      expect(row).not.toHaveProperty('summary');
      expect(row.record_id).toBe(recordId);
      expect(JSON.stringify(await byId('withheld', row.id))).not.toContain(REF_TITLE);
    }
    expect(JSON.stringify(rows)).not.toContain(REF_TITLE);
  });

  it('control: a reader served the referenced title reads the label and the summary naming it', async () => {
    const rows = await listed('control');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.record_label).toBe(REF_TITLE);
      expect(String(row.summary)).toContain(REF_TITLE);
      expect((await byId('control', row.id)).record_label).toBe(REF_TITLE);
    }
  });
});
