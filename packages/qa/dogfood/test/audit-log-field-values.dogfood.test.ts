// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21155] The compliance ledger's before/after snapshots serve a parent field's
// value only to a reader the security service serves that field unmasked, on
// a real boot.
//
// ## The composition
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, SQL driver, REST and
// auth layers, plus `AuditPlugin` — whose CRUD mirror writes the ledger rows
// and whose read seam serves them. One synthetic object carries one field of
// each class:
//
//   - MASKED: a `maskingRule` whose unmask gate is one capability;
//   - CAPABILITY-GATED: `requiredPermissions` naming another, no mask;
//   - NOT GRANTED: plain, and marked non-readable by a set the reader holds.
//
// One reader per class holds exactly what makes ITS class apply and nothing
// that makes another apply, so every reader is also the control for the other
// two classes; the unmasking reader holds both capabilities and no withholding
// set, and is the control for all three. Every reader's sets grant the ledger
// read. A fifth reader is the shape the defect was measured through: its ledger
// read comes from the platform's read-only set's wildcard, beside a set that
// withholds one field, and no capability: every class applies to it. A writer
// holding both capabilities writes every row
// through the REST door: a create, an update of all three fields, and the
// delete of a second record.
//
// ## What is asserted, by class
//
// - The scene is real before anything is believed (`beforeAll`, `assertArmed`):
//   the ledger rows at rest carry every class's stored value in the create,
//   update and delete snapshots, and the data plane serves each reader its
//   class exactly as the class says — replaced, or without the key — and
//   serves the control the stored value.
// - Through the list door, the by-id door and a list projected to the snapshot
//   columns (the record page's history tab), no ledger row served to a reader
//   carries a stored value of its class; the other two classes' values are
//   still served to it.
// - The control is served every snapshot byte-identical to the row at rest.
//
// [#21175] The ledger's parent-record read gate composes on the same read
// path: the deleted record's rows (its create and delete snapshots) are served
// to no caller that is neither system context nor a holder of the ledger's
// audit capability (#21260), and no set below grants that capability, so the
// doors below serve the live record's rows only (a holder is served the
// deleted record's snapshots, narrowed: `audit-log-audit-capability.dogfood.
// test.ts`). They are still WRITTEN, and the armed check still reads
// every class in them at rest; what the redaction does with them is pinned on
// its own function in plugin-audit's `audit-log-field-redaction.test.ts`.
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

const OBJ = 'alv_item';
const LEDGER = 'sys_audit_log';
const CAP_UNMASK = 'alv_unmask';
const CAP_READ = 'alv_read_gated';
const SYS = { context: { isSystem: true } } as const;

type ClassName = 'masked' | 'gated' | 'withheld';
const CLASSES: ClassName[] = ['masked', 'gated', 'withheld'];
const FIELD: Record<ClassName, string> = { masked: 'alv_masked', gated: 'alv_gated', withheld: 'alv_withheld' };
/** Synthetic stored values: two versions per class on the live record, one on the deleted record. */
const STORED: Record<ClassName, [string, string, string]> = {
  masked: ['ALVMASKEDONE51', 'ALVMASKEDTWO52', 'ALVMASKEDDEL53'],
  gated: ['ALVGATEDONE54', 'ALVGATEDTWO55', 'ALVGATEDDEL56'],
  withheld: ['ALVWITHHELDONE57', 'ALVWITHHELDTWO58', 'ALVWITHHELDDEL59'],
};

const Item = ObjectSchema.create({
  name: OBJ,
  label: 'ALV Item',
  pluralLabel: 'ALV Items',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    alv_masked: Field.text({ label: 'Masked', maskingRule: { keepHead: 1, keepTail: 1 }, requiredPermissions: [CAP_UNMASK] }),
    alv_gated: Field.text({ label: 'Gated', requiredPermissions: [CAP_READ] }),
    alv_withheld: Field.text({ label: 'Withheld' }),
  },
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.audit-log-field-values',
    namespace: 'alv',
    version: '0.0.0',
    type: 'app',
    name: 'Audit Log Field Values Fixture',
    description: 'One object with one field of each field-security class, recorded on the compliance ledger.',
  },
  objects: [Item],
});

const grants = {
  [OBJ]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  [LEDGER]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false },
};
const withheldField = { [`${OBJ}.${FIELD.withheld}`]: { readable: false, editable: false } };
const baselineSet = PermissionSetSchema.parse({ name: 'alv_baseline', label: 'ALV baseline', objects: grants });
const unmaskSet = PermissionSetSchema.parse({ name: 'alv_unmask_set', label: 'ALV unmask', objects: grants, systemPermissions: [CAP_UNMASK] });
const gatedReadSet = PermissionSetSchema.parse({ name: 'alv_gated_read_set', label: 'ALV gated read', objects: grants, systemPermissions: [CAP_READ] });
const withholdSet = PermissionSetSchema.parse({ name: 'alv_withhold_set', label: 'ALV withhold', objects: grants, fields: withheldField });
/** Withholds the field and grants no object: beside the platform read-only set. */
const withholdOnlySet = PermissionSetSchema.parse({ name: 'alv_withhold_only_set', label: 'ALV withhold only', objects: {}, fields: withheldField });

/** Each reader, and the sets that make exactly its class apply. */
const READERS: Record<ClassName | 'control' | 'wildcard', string[]> = {
  masked: [gatedReadSet.name],
  gated: [unmaskSet.name],
  withheld: [unmaskSet.name, gatedReadSet.name, withholdSet.name],
  control: [unmaskSet.name, gatedReadSet.name],
  wildcard: ['viewer_readonly', withholdOnlySet.name],
};

type Row = Record<string, any>;
/** The values of the live record — the record whose rows the doors serve. */
const LIVE = (c: ClassName) => STORED[c].slice(0, 2);
const rowsOf = (body: any): Row[] => body?.records ?? body?.data ?? (Array.isArray(body) ? body : []);
const recordOf = (body: any): Row => body?.record ?? body;

describe('[#21155] the compliance ledger serves a parent field value only to a reader served that field', () => {
  let stack: VerifyStack;
  let ql: any;
  const token: Record<string, string> = {};
  const ids = { live: '', deleted: '' };

  /** Every ledger row about the fixture records a reader is served, through three doors. */
  const servedRows = async (who: keyof typeof READERS) => {
    const doors: Record<'list' | 'byId' | 'projected', Row[]> = { list: [], byId: [], projected: [] };
    for (const id of [ids.live, ids.deleted]) {
      const filter = encodeURIComponent(JSON.stringify({ object_name: OBJ, record_id: id }));
      const list = await stack.apiAs(token[who], 'GET', `/data/${LEDGER}?$filter=${filter}`);
      expect(list.status).toBe(200);
      const rows = rowsOf(await list.json());
      doors.list.push(...rows);
      for (const row of rows) {
        const res = await stack.apiAs(token[who], 'GET', `/data/${LEDGER}/${row.id}`);
        expect(res.status).toBe(200);
        doors.byId.push(recordOf(await res.json()));
      }
      const projected = await stack.apiAs(token[who], 'GET', `/data/${LEDGER}?$filter=${filter}&$select=id,old_value,new_value`);
      expect(projected.status).toBe(200);
      doors.projected.push(...rowsOf(await projected.json()));
    }
    return doors;
  };

  /** How the data plane serves each class's field to a reader: stored, replaced, or absent. */
  const dataPlane = async (who: keyof typeof READERS) => {
    const res = await stack.apiAs(token[who], 'GET', `/data/${OBJ}/${ids.live}`);
    const rec = recordOf(await res.json());
    const verdict = (c: ClassName) =>
      !(FIELD[c] in rec) ? 'absent' : rec[FIELD[c]] === STORED[c][1] ? 'stored' : 'replaced';
    return { status: res.status, masked: verdict('masked'), gated: verdict('gated'), withheld: verdict('withheld') };
  };

  const ledgerAtRest = async (): Promise<Row[]> =>
    ql.find(LEDGER, { where: { object_name: OBJ }, context: { isSystem: true } });

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet, unmaskSet, gatedReadSet, withholdSet, withholdOnlySet],
        fallbackPermissionSet: baselineSet.name,
      }),
      extraPlugins: [new AuditPlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    const idOf = async (object: string, where: Record<string, unknown>) =>
      String((await ql.findOne(object, { where, context: { isSystem: true } }))?.id ?? '');

    for (const who of [...Object.keys(READERS), 'writer']) {
      const email = `alv-${who}@verify.test`;
      token[who] = await stack.signUp(email);
      const userId = await idOf('sys_user', { email });
      const sets = who === 'writer' ? READERS.control : READERS[who as keyof typeof READERS];
      for (const name of sets) {
        const setId = await idOf('sys_permission_set', { name });
        expect(setId, `fixture permission set ${name} seeded`).toBeTruthy();
        await ql.insert('sys_user_permission_set', { user_id: userId, permission_set_id: setId }, SYS);
      }
    }

    // Every row is written by the real CRUD mirror, from REST writes.
    const body = (c: 0 | 2) => Object.fromEntries(CLASSES.map((k) => [FIELD[k], STORED[k][c]]));
    const create = await stack.apiAs(token.writer, 'POST', `/data/${OBJ}`, { name: 'Item one', ...body(0) });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id?: string; record?: { id?: string } };
    ids.live = String(created.id ?? created.record?.id ?? '');
    const update = await stack.apiAs(token.writer, 'PATCH', `/data/${OBJ}/${ids.live}`,
      Object.fromEntries(CLASSES.map((k) => [FIELD[k], STORED[k][1]])));
    expect(update.status).toBe(200);
    const second = await stack.apiAs(token.writer, 'POST', `/data/${OBJ}`, { name: 'Item two', ...body(2) });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { id?: string; record?: { id?: string } };
    ids.deleted = String(secondBody.id ?? secondBody.record?.id ?? '');
    const del = await stack.apiAs(token.writer, 'DELETE', `/data/${OBJ}/${ids.deleted}`);
    expect(del.status).toBe(200);

    await assertArmed([
      armedWhen({
        control: 'the ledger rows at rest carry every class of stored value, in the create, update and delete snapshots',
        disarmedBy: 'a mirror that stopped writing a class into a snapshot would let every negative case below pass on a row that never carried it',
        observe: async () => {
          const rows = await ledgerAtRest();
          const actions = rows.map((r) => r.action).sort();
          const blob = JSON.stringify(rows);
          return { actions, values: CLASSES.filter((c) => STORED[c].every((v) => blob.includes(v))) };
        },
        armed: (o) => ['create', 'delete', 'update'].every((a) => o.actions.includes(a)) && o.values.length === 3,
        describe: (o) => `actions: ${o.actions.join(',') || 'none'}; classes carried: ${o.values.join(',') || 'none'}`,
      }),
      armedWhen({
        control: 'the data plane serves each reader its own class as the class says, and the control every value stored',
        disarmedBy: 'a reader whose grants did not resolve would be served the stored value everywhere, and its negative cases would measure an unrestricted reader',
        observe: async () => ({
          masked: await dataPlane('masked'),
          gated: await dataPlane('gated'),
          withheld: await dataPlane('withheld'),
          control: await dataPlane('control'),
          wildcard: await dataPlane('wildcard'),
        }),
        armed: (o) =>
          o.masked.masked === 'replaced' && o.masked.gated === 'stored' && o.masked.withheld === 'stored' &&
          o.gated.gated === 'absent' && o.gated.masked === 'stored' && o.gated.withheld === 'stored' &&
          o.withheld.withheld === 'absent' && o.withheld.masked === 'stored' && o.withheld.gated === 'stored' &&
          o.control.masked === 'stored' && o.control.gated === 'stored' && o.control.withheld === 'stored' &&
          o.wildcard.status === 200 && o.wildcard.masked === 'replaced' && o.wildcard.gated === 'absent' &&
          o.wildcard.withheld === 'absent',
        describe: (o) => JSON.stringify(o),
      }),
    ]);
  }, 180_000);

  afterAll(async () => {
    if (stack) await stack.stop();
  });

  for (const c of CLASSES) {
    it(`${c}: no ledger row served to the reader carries a stored value of its class, through any door`, async () => {
      const doors = await servedRows(c);
      expect(doors.list.length).toBeGreaterThanOrEqual(2);
      for (const rows of Object.values(doors)) {
        const blob = JSON.stringify(rows);
        for (const v of STORED[c]) expect(blob).not.toContain(v);
      }
    });

    it(`${c}: the values of the two other classes are still served to that reader`, async () => {
      const { list } = await servedRows(c);
      const blob = JSON.stringify(list);
      for (const other of CLASSES.filter((o) => o !== c)) {
        for (const v of LIVE(other)) expect(blob).toContain(v);
      }
    });
  }

  it('wildcard: a reader granted the ledger by the platform read-only set is served no value of a class the data plane withholds from it', async () => {
    const doors = await servedRows('wildcard');
    expect(doors.list.length).toBeGreaterThanOrEqual(2);
    for (const rows of Object.values(doors)) {
      const blob = JSON.stringify(rows);
      for (const c of CLASSES) for (const v of STORED[c]) expect(blob).not.toContain(v);
    }
  });

  it('control: the unmasking reader is served every snapshot byte-identical to the row at rest', async () => {
    const atRest = new Map((await ledgerAtRest()).map((r) => [r.id, r]));
    const doors = await servedRows('control');
    for (const rows of Object.values(doors)) {
      const blob = JSON.stringify(rows);
      for (const c of CLASSES) for (const v of LIVE(c)) expect(blob).toContain(v);
    }
    for (const row of doors.list) {
      expect(row.old_value).toBe(atRest.get(row.id)?.old_value);
      expect(row.new_value).toBe(atRest.get(row.id)?.new_value);
    }
  });
});
