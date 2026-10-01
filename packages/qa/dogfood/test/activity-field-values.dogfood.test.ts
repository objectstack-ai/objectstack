// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21081] An activity row serves a parent field's value only to a reader the
// security service serves that field unmasked, on a real boot.
//
// ## The composition
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, SQL driver, REST and
// auth layers, plus `AuditPlugin` — whose CRUD mirror writes the rows and
// whose read seams serve them. One synthetic object carries one field of each
// class, each tracked on the timeline and each named by a milestone template:
//
//   - MASKED: a `maskingRule` whose unmask gate is one capability;
//   - CAPABILITY-GATED: `requiredPermissions` naming another, no mask;
//   - NOT GRANTED: plain, and marked non-readable by a set the reader holds.
//
// Three more objects each have one label-candidate field, one per class, so the
// record label is composed from it.
//
// One reader per class holds exactly what makes ITS class apply and nothing
// that makes another apply, so every reader is also the control for the other
// two classes; the unmasking reader holds both capabilities and no
// withholding set, and is the control for all three. A writer holding both
// capabilities writes every row through the REST door.
//
// ## What is asserted, by class
//
// - The scene is real before anything is believed (`beforeAll`, `assertArmed`):
//   the rows at rest carry every class's stored value, and the data plane
//   serves each reader its class exactly as the class says — replaced, or
//   without the key — and serves the control the stored value.
// - Through the list door and the by-id door, no activity row served to a
//   reader carries a stored value of its class; the values of the other two
//   classes are still served to it.
// - The control is served every value.
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

const OBJ = 'afv_item';
const CAP_UNMASK = 'afv_unmask';
const CAP_READ = 'afv_read_gated';
const SYS = { context: { isSystem: true } } as const;

type ClassName = 'masked' | 'gated' | 'withheld';
const FIELD: Record<ClassName, string> = { masked: 'afv_masked', gated: 'afv_gated', withheld: 'afv_withheld' };
/** Synthetic stored values: two versions per class, and one label value per class. */
const STORED: Record<ClassName, [string, string]> = {
  masked: ['AFVMASKEDONE71', 'AFVMASKEDTWO72'],
  gated: ['AFVGATEDONE73', 'AFVGATEDTWO74'],
  withheld: ['AFVWITHHELDONE75', 'AFVWITHHELDTWO76'],
};
const LABEL_OBJ: Record<ClassName, string> = { masked: 'afv_lbl_masked', gated: 'afv_lbl_gated', withheld: 'afv_lbl_withheld' };
const LABEL_STORED: Record<ClassName, string> = {
  masked: 'afvlabelmasked@verify.test', gated: 'AFVLABELGATED77', withheld: 'AFVLABELWITHHELD78',
};
const CLASSES: ClassName[] = ['masked', 'gated', 'withheld'];

const Item = ObjectSchema.create({
  name: OBJ,
  label: 'AFV Item',
  pluralLabel: 'AFV Items',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    stage: Field.select(['open', 'won'], { label: 'Stage' }),
    afv_masked: Field.text({ label: 'Masked', trackHistory: true, maskingRule: { keepHead: 1, keepTail: 1 }, requiredPermissions: [CAP_UNMASK] }),
    afv_gated: Field.text({ label: 'Gated', trackHistory: true, requiredPermissions: [CAP_READ] }),
    afv_withheld: Field.text({ label: 'Withheld', trackHistory: true }),
  },
  activityMilestones: [{ field: 'stage', value: 'won', summary: 'Won {afv_masked} {afv_gated} {afv_withheld}' }],
});
const labelObject = (name: string, field: Record<string, ReturnType<typeof Field.text>>) =>
  ObjectSchema.create({ name, label: name, pluralLabel: name, sharingModel: 'public_read_write', fields: field });
const LabelMasked = labelObject(LABEL_OBJ.masked, { email: Field.text({ label: 'Email', maskingRule: 'email', requiredPermissions: [CAP_UNMASK] }) });
const LabelGated = labelObject(LABEL_OBJ.gated, { title: Field.text({ label: 'Title', requiredPermissions: [CAP_READ] }) });
const LabelWithheld = labelObject(LABEL_OBJ.withheld, { title: Field.text({ label: 'Title' }) });

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.activity-field-values',
    namespace: 'afv',
    version: '0.0.0',
    type: 'app',
    name: 'Activity Field Values Fixture',
    description: 'One object with one field of each field-security class, tracked on the activity timeline.',
  },
  objects: [Item, LabelMasked, LabelGated, LabelWithheld],
});

const objectGrants = Object.fromEntries(
  [OBJ, ...Object.values(LABEL_OBJ)].map((o) => [o, { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false }]),
);
const grants = { ...objectGrants, sys_activity: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } };
const baselineSet = PermissionSetSchema.parse({ name: 'afv_baseline', label: 'AFV baseline', objects: grants });
const unmaskSet = PermissionSetSchema.parse({ name: 'afv_unmask_set', label: 'AFV unmask', objects: grants, systemPermissions: [CAP_UNMASK] });
const gatedReadSet = PermissionSetSchema.parse({ name: 'afv_gated_read_set', label: 'AFV gated read', objects: grants, systemPermissions: [CAP_READ] });
const withholdSet = PermissionSetSchema.parse({
  name: 'afv_withhold_set',
  label: 'AFV withhold',
  objects: grants,
  fields: {
    [`${OBJ}.${FIELD.withheld}`]: { readable: false, editable: false },
    [`${LABEL_OBJ.withheld}.title`]: { readable: false, editable: false },
  },
});

/** Each reader, and the sets that make exactly its class apply. */
const READERS: Record<ClassName | 'control', string[]> = {
  masked: [gatedReadSet.name],
  gated: [unmaskSet.name],
  withheld: [unmaskSet.name, gatedReadSet.name, withholdSet.name],
  control: [unmaskSet.name, gatedReadSet.name],
};

type Row = Record<string, any>;
const rowsOf = (body: any): Row[] => body?.records ?? body?.data ?? (Array.isArray(body) ? body : []);
const recordOf = (body: any): Row => body?.record ?? body;

describe('[#21081] activity rows serve a parent field value only to a reader served that field', () => {
  let stack: VerifyStack;
  let ql: any;
  const token: Record<string, string> = {};
  let recordId = '';
  const labelIds: Record<ClassName, string> = {} as never;

  /** Every activity row about `object`/`id` a reader is served, through the list door and the by-id door. */
  const servedRows = async (who: keyof typeof READERS, object: string, id: string) => {
    const filter = encodeURIComponent(JSON.stringify({ object_name: object, record_id: id }));
    const list = await stack.apiAs(token[who], 'GET', `/data/sys_activity?$filter=${filter}`);
    expect(list.status).toBe(200);
    const rows = rowsOf(await list.json());
    const byId: Row[] = [];
    for (const row of rows) {
      const res = await stack.apiAs(token[who], 'GET', `/data/sys_activity/${row.id}`);
      expect(res.status).toBe(200);
      byId.push(recordOf(await res.json()));
    }
    return { list: rows, byId };
  };

  /** How the data plane serves each class's field to a reader: stored, replaced, or absent. */
  const dataPlane = async (who: keyof typeof READERS) => {
    const res = await stack.apiAs(token[who], 'GET', `/data/${OBJ}/${recordId}`);
    const rec = recordOf(await res.json());
    const verdict = (c: ClassName) =>
      !(FIELD[c] in rec) ? 'absent' : rec[FIELD[c]] === STORED[c][1] ? 'stored' : 'replaced';
    return { status: res.status, masked: verdict('masked'), gated: verdict('gated'), withheld: verdict('withheld') };
  };

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet, unmaskSet, gatedReadSet, withholdSet],
        fallbackPermissionSet: baselineSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    const idOf = async (object: string, where: Record<string, unknown>) =>
      String((await ql.findOne(object, { where, context: { isSystem: true } }))?.id ?? '');

    for (const who of [...Object.keys(READERS), 'writer']) {
      const email = `afv-${who}@verify.test`;
      token[who] = await stack.signUp(email);
      const userId = await idOf('sys_user', { email });
      const sets = who === 'writer' ? READERS.control : READERS[who as keyof typeof READERS];
      for (const name of sets) {
        const setId = await idOf('sys_permission_set', { name });
        expect(setId, `fixture permission set ${name} seeded`).toBeTruthy();
        await ql.insert('sys_user_permission_set', { user_id: userId, permission_set_id: setId }, SYS);
      }
    }

    // Every row is written by the real CRUD mirror, from REST writes: a create,
    // an update of all three fields, and a milestone naming all three.
    const create = await stack.apiAs(token.writer, 'POST', `/data/${OBJ}`, {
      name: 'Item one', stage: 'open',
      [FIELD.masked]: STORED.masked[0], [FIELD.gated]: STORED.gated[0], [FIELD.withheld]: STORED.withheld[0],
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id?: string; record?: { id?: string } };
    recordId = String(created.id ?? created.record?.id ?? '');
    const update = await stack.apiAs(token.writer, 'PATCH', `/data/${OBJ}/${recordId}`, {
      [FIELD.masked]: STORED.masked[1], [FIELD.gated]: STORED.gated[1], [FIELD.withheld]: STORED.withheld[1],
    });
    expect(update.status).toBe(200);
    const milestone = await stack.apiAs(token.writer, 'PATCH', `/data/${OBJ}/${recordId}`, { stage: 'won' });
    expect(milestone.status).toBe(200);
    for (const c of CLASSES) {
      const field = c === 'masked' ? 'email' : 'title';
      const res = await stack.apiAs(token.writer, 'POST', `/data/${LABEL_OBJ[c]}`, { [field]: LABEL_STORED[c] });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id?: string; record?: { id?: string } };
      labelIds[c] = String(body.id ?? body.record?.id ?? '');
    }

    await assertArmed([
      armedWhen({
        control: 'the activity rows at rest carry every class of stored value, in the summary, the label and the recorded change',
        disarmedBy: 'a mirror that stopped writing a class into a row would let every negative case below pass on a row that never carried it',
        observe: async () => {
          const rows = await ql.find('sys_activity', { where: { object_name: OBJ, record_id: recordId }, context: { isSystem: true } });
          const blob = JSON.stringify(rows);
          const labels: string[] = [];
          for (const c of CLASSES) {
            const lrows = await ql.find('sys_activity', { where: { object_name: LABEL_OBJ[c] }, context: { isSystem: true } });
            if (lrows.some((r: Row) => r.record_label === LABEL_STORED[c])) labels.push(c);
          }
          return {
            rows: rows.length,
            values: CLASSES.filter((c) => STORED[c].every((v) => blob.includes(v))),
            labels,
          };
        },
        armed: (o) => o.rows >= 3 && o.values.length === 3 && o.labels.length === 3,
        describe: (o) => `${o.rows} rows; classes carried: ${o.values.join(',') || 'none'}; labels carried: ${o.labels.join(',') || 'none'}`,
      }),
      armedWhen({
        control: 'the data plane serves each reader its own class as the class says, and the control every value stored',
        disarmedBy: 'a reader whose grants did not resolve would be served the stored value everywhere, and its negative cases would measure an unrestricted reader',
        observe: async () => ({
          masked: await dataPlane('masked'),
          gated: await dataPlane('gated'),
          withheld: await dataPlane('withheld'),
          control: await dataPlane('control'),
        }),
        armed: (o) =>
          o.masked.masked === 'replaced' && o.masked.gated === 'stored' && o.masked.withheld === 'stored' &&
          o.gated.gated === 'absent' && o.gated.masked === 'stored' && o.gated.withheld === 'stored' &&
          o.withheld.withheld === 'absent' && o.withheld.masked === 'stored' && o.withheld.gated === 'stored' &&
          o.control.masked === 'stored' && o.control.gated === 'stored' && o.control.withheld === 'stored',
        describe: (o) => JSON.stringify(o),
      }),
    ]);
  }, 180_000);

  afterAll(async () => {
    if (stack) await stack.stop();
  });

  for (const c of CLASSES) {
    it(`${c}: no activity row served to the reader carries a stored value of its class, through either door`, async () => {
      const { list, byId } = await servedRows(c, OBJ, recordId);
      expect(list.length).toBeGreaterThanOrEqual(3);
      for (const rows of [list, byId]) {
        const blob = JSON.stringify(rows);
        for (const v of STORED[c]) expect(blob).not.toContain(v);
      }
    });

    it(`${c}: the values of the two other classes are still served to that reader`, async () => {
      const { list } = await servedRows(c, OBJ, recordId);
      const blob = JSON.stringify(list);
      for (const other of CLASSES.filter((o) => o !== c)) {
        for (const v of STORED[other]) expect(blob).toContain(v);
      }
    });

    it(`${c}: a record label composed from a field of that class is not served to the reader`, async () => {
      const { list, byId } = await servedRows(c, LABEL_OBJ[c], labelIds[c]);
      expect(list).toHaveLength(1);
      for (const rows of [list, byId]) {
        expect(JSON.stringify(rows)).not.toContain(LABEL_STORED[c]);
        expect(rows[0]).not.toHaveProperty('record_label');
      }
    });
  }

  it('control: the unmasking reader is served every stored value and every label', async () => {
    const { list, byId } = await servedRows('control', OBJ, recordId);
    for (const rows of [list, byId]) {
      const blob = JSON.stringify(rows);
      for (const c of CLASSES) for (const v of STORED[c]) expect(blob).toContain(v);
    }
    for (const c of CLASSES) {
      const labelled = await servedRows('control', LABEL_OBJ[c], labelIds[c]);
      expect(labelled.list[0]).toHaveProperty('record_label', LABEL_STORED[c]);
    }
  });
});
