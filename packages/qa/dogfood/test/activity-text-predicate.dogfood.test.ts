// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21154] A query over the stored activity text, the compliance ledger's
// before/after snapshots, or the approval snapshot, by a reader withheld a field
// of the record it is about, is refused at the generic data door on a real boot
// — matching and non-matching alike.
//
// ## The composition
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, SQL driver, REST and
// auth layers, plus automation, the record-change trigger, `AuditPlugin` and
// the approvals plugin. One synthetic object carries one field of each class,
// each tracked on the timeline:
//
//   - MASKED: a `maskingRule` whose unmask gate is one capability;
//   - CAPABILITY-GATED: `requiredPermissions` naming another, no mask;
//   - NOT GRANTED: plain, and marked non-readable by a set the reader holds.
//
// Three more objects each have one label-candidate field, one per class, so a
// record label is composed from it; a fifth object with one field per class is
// put through an approval flow, so its request carries a snapshot.
//
// One reader per class holds exactly what makes ITS class apply, so each reader
// is served every field of the label objects of the other two classes — the
// "withholds nothing on that parent" case. The unmasking reader holds both
// capabilities and no withholding set, and is the control.
//
// ## What is asserted, by class
//
// - The scene is real before anything is believed (`beforeAll`, `assertArmed`):
//   the rows at rest carry every class's stored value, and the data plane serves
//   each reader its class as the class says.
// - For each class, each value-bearing activity column, each ledger snapshot
//   column and the approval snapshot column,
//   a matching and a non-matching filter are both refused with the engine's
//   refusal (403, PERMISSION_DENIED, its words); so are a grouping, a search and
//   a filter that names no parent object.
// - The same reader filters the text of a parent it is served in full, as
//   before; the control filters every column of a pinned parent, as before.
// - The platform admin, granted the fixture's two capabilities and so served
//   every field of every object these rows can concern, filters and searches
//   all three members with no parent named, as before.
//
// Fixtures are synthetic. ⚠️ No test title states a value or a column.
// `@objectstack/plugin-audit` resolves through its BUILT output here (a ledgered
// pair in `scripts/check-test-source-alias.mjs`), so a verdict on a change to it
// is a verdict on its last build; `@objectstack/plugin-approvals` resolves to
// source (this project's alias).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RecordChangeTriggerPlugin } from '@objectstack/trigger-record-change';
import { defineStack, defineFlow } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { assertArmed, armedWhen } from './armed.js';

const OBJ = 'atp_item';
const APPR = 'atp_appr';
const CAP_UNMASK = 'atp_unmask';
const CAP_READ = 'atp_read_gated';
const POSITION = 'atp_reviewer';
const SYS = { context: { isSystem: true } } as const;

type ClassName = 'masked' | 'gated' | 'withheld';
const CLASSES: ClassName[] = ['masked', 'gated', 'withheld'];
const FIELD: Record<ClassName, string> = { masked: 'atp_masked', gated: 'atp_gated', withheld: 'atp_withheld' };
/** Synthetic stored values: two versions per class on the item, one per class on the snapshot. */
const STORED: Record<ClassName, [string, string]> = {
  masked: ['ATPMASKEDONE61', 'ATPMASKEDTWO62'],
  gated: ['ATPGATEDONE63', 'ATPGATEDTWO64'],
  withheld: ['ATPWITHHELDONE65', 'ATPWITHHELDTWO66'],
};
const SNAP: Record<ClassName, string> = { masked: 'ATPSNAPMASK67', gated: 'ATPSNAPGATE68', withheld: 'ATPSNAPWHLD69' };
const LABEL_OBJ: Record<ClassName, string> = { masked: 'atp_lbl_masked', gated: 'atp_lbl_gated', withheld: 'atp_lbl_withheld' };
const LABEL_STORED: Record<ClassName, string> = {
  masked: 'atplabelmasked@verify.test', gated: 'ATPLABELGATED70', withheld: 'ATPLABELWITHHELD71',
};
const NOMATCH = 'ATPNOMATCH72';

const classFields = (tracked: boolean) => ({
  atp_masked: Field.text({ label: 'Masked', trackHistory: tracked, maskingRule: { keepHead: 1, keepTail: 1 }, requiredPermissions: [CAP_UNMASK] }),
  atp_gated: Field.text({ label: 'Gated', trackHistory: tracked, requiredPermissions: [CAP_READ] }),
  atp_withheld: Field.text({ label: 'Withheld', trackHistory: tracked }),
});
const Item = ObjectSchema.create({
  name: OBJ,
  label: 'ATP Item',
  pluralLabel: 'ATP Items',
  sharingModel: 'public_read_write',
  fields: { name: Field.text({ label: 'Name', required: true }), ...classFields(true) },
});
const Appr = ObjectSchema.create({
  name: APPR,
  label: 'ATP Approval Subject',
  pluralLabel: 'ATP Approval Subjects',
  sharingModel: 'public_read_write',
  fields: { name: Field.text({ label: 'Name', required: true }), ...classFields(false) },
});
const labelObject = (name: string, field: Record<string, ReturnType<typeof Field.text>>) =>
  ObjectSchema.create({ name, label: name, pluralLabel: name, sharingModel: 'public_read_write', fields: field });
const LabelMasked = labelObject(LABEL_OBJ.masked, { email: Field.text({ label: 'Email', maskingRule: 'email', requiredPermissions: [CAP_UNMASK] }) });
const LabelGated = labelObject(LABEL_OBJ.gated, { title: Field.text({ label: 'Title', requiredPermissions: [CAP_READ] }) });
const LabelWithheld = labelObject(LABEL_OBJ.withheld, { title: Field.text({ label: 'Title' }) });

const ApprFlow = defineFlow({
  name: 'atp_flow',
  label: 'ATP Flow',
  description: 'Routes each new approval subject to the reviewer position.',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'start', type: 'start', label: 'On Create', config: { objectName: APPR, triggerType: 'record-after-create' } },
    { id: 'gate', type: 'approval', label: 'Gate', config: { approvers: [{ type: 'position', value: POSITION }], behavior: 'first_response' } },
    { id: 'approved', type: 'end', label: 'Approved' },
    { id: 'rejected', type: 'end', label: 'Rejected' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'gate' },
    { id: 'e2', source: 'gate', target: 'approved', label: 'approve' },
    { id: 'e3', source: 'gate', target: 'rejected', label: 'reject' },
  ],
});

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.activity-text-predicate',
    namespace: 'atp',
    version: '0.0.0',
    type: 'app',
    name: 'Activity Text Predicate Fixture',
    description: 'One object per field-security class on the activity timeline, and one approval subject.',
  },
  // ADR-0097: the flow's record-change start node needs both capabilities.
  requires: ['automation', 'triggers'],
  objects: [Item, Appr, LabelMasked, LabelGated, LabelWithheld],
  flows: [ApprFlow],
});

const readOnly = { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false };
const grants = {
  ...Object.fromEntries(
    [OBJ, APPR, ...Object.values(LABEL_OBJ)].map((o) => [o, { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false }]),
  ),
  sys_activity: readOnly,
  sys_audit_log: readOnly,
  sys_approval_request: readOnly,
};
const baselineSet = PermissionSetSchema.parse({ name: 'atp_baseline', label: 'ATP baseline', objects: grants });
const unmaskSet = PermissionSetSchema.parse({ name: 'atp_unmask_set', label: 'ATP unmask', objects: grants, systemPermissions: [CAP_UNMASK] });
const gatedReadSet = PermissionSetSchema.parse({ name: 'atp_gated_read_set', label: 'ATP gated read', objects: grants, systemPermissions: [CAP_READ] });
const withholdSet = PermissionSetSchema.parse({
  name: 'atp_withhold_set',
  label: 'ATP withhold',
  objects: grants,
  fields: {
    [`${OBJ}.${FIELD.withheld}`]: { readable: false, editable: false },
    [`${APPR}.${FIELD.withheld}`]: { readable: false, editable: false },
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
/** For each class's reader, a label object of another class: one it is served in full. */
const SERVED_IN_FULL: Record<ClassName, ClassName> = { masked: 'gated', gated: 'masked', withheld: 'masked' };

type Row = Record<string, any>;
interface Answer { status: number; code?: string; message: string; rows: number; text: string }

const enc = (v: unknown) => encodeURIComponent(JSON.stringify(v));
const firstSentence = (message: string) => {
  const end = message.indexOf('. ');
  return end < 0 ? message : message.slice(0, end + 1);
};
const predicateWords = (object: string, column: string) =>
  `[Security] Access denied: query on '${object}' references field(s) not readable by the caller: ${column}.`;
const aggregateWords = (object: string, column: string) =>
  `[Security] Field read denied: not permitted to aggregate [${column}] on '${object}'.`;

/** The three value-bearing activity columns, each with the parent and the stored value a class reaches it with. */
const activityCases = (c: ClassName) => [
  { column: 'summary', parent: OBJ, stored: STORED[c][1] },
  { column: 'metadata', parent: OBJ, stored: STORED[c][0] },
  { column: 'record_label', parent: LABEL_OBJ[c], stored: LABEL_STORED[c] },
];
/** The two ledger snapshot columns, each with a stored value a class reaches it with. */
const ledgerCases = (c: ClassName) => [
  { column: 'old_value', stored: STORED[c][0] },
  { column: 'new_value', stored: STORED[c][1] },
];

describe('[#21154] a query over activity text or the approval snapshot, by a reader withheld a field of its record', () => {
  let stack: VerifyStack;
  let ql: any;
  const token: Record<string, string> = {};
  let recordId = '';

  const call = async (who: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.apiAs(token[who], method, path, body as never);
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = undefined; }
    const err = json?.error;
    const rows = json?.records ?? json?.data ?? (Array.isArray(json) ? json : []);
    return {
      status: res.status,
      code: json?.code ?? err?.code,
      message: String((err && typeof err === 'object' ? err.message : err) ?? json?.message ?? ''),
      rows: Array.isArray(rows) ? rows.length : 0,
      text,
    };
  };
  const list = (who: string, object: string, where: unknown, extra = '') =>
    call(who, 'GET', `/data/${object}?$filter=${enc(where)}${extra}`);
  const expectRefused = (a: Answer, words: string) => {
    expect(a.status, a.text).toBe(403);
    expect(a.code).toBe('PERMISSION_DENIED');
    expect(firstSentence(a.message)).toBe(words);
  };

  /** How the data plane serves each class's field to a reader: stored, replaced, or absent. */
  const dataPlane = async (who: string) => {
    const res = await stack.apiAs(token[who], 'GET', `/data/${OBJ}/${recordId}`);
    const body = (await res.json()) as { record?: Row };
    const rec = body?.record ?? (body as Row);
    const verdict = (c: ClassName) =>
      !(FIELD[c] in rec) ? 'absent' : rec[FIELD[c]] === STORED[c][1] ? 'stored' : 'replaced';
    return { masked: verdict('masked'), gated: verdict('gated'), withheld: verdict('withheld') };
  };

  beforeAll(async () => {
    stack = await bootStack(fixtureStack as unknown as Parameters<typeof bootStack>[0], {
      automation: true,
      security: new SecurityPlugin({
        defaultPermissionSets: [...securityDefaultPermissionSets, baselineSet, unmaskSet, gatedReadSet, withholdSet],
        fallbackPermissionSet: baselineSet.name,
      }),
      extraPlugins: [new AuditPlugin(), new RecordChangeTriggerPlugin(), new ApprovalsServicePlugin()],
    });
    ql = await stack.kernel.getServiceAsync('objectql');
    token.admin = await stack.signIn();
    const idOf = async (object: string, where: Record<string, unknown>) =>
      String((await ql.findOne(object, { where, context: { isSystem: true } }))?.id ?? '');

    // The platform admin is served every field of every platform object, but the
    // fixture's two capability-gated fields only with the capabilities: grant
    // them, so the admin is a reader withheld nothing on any object these rows
    // can concern — the reader an unpinned query is admitted for.
    const adminId = await idOf('sys_user', { email: 'admin@objectos.ai' });
    expect(adminId, 'the harness admin is seeded').toBeTruthy();
    for (const name of READERS.control) {
      const setId = await idOf('sys_permission_set', { name });
      await ql.insert('sys_user_permission_set', { user_id: adminId, permission_set_id: setId }, SYS);
    }

    for (const who of [...Object.keys(READERS), 'writer']) {
      const email = `atp-${who}@verify.test`;
      token[who] = await stack.signUp(email);
      const userId = await idOf('sys_user', { email });
      const sets = who === 'writer' ? READERS.control : READERS[who as keyof typeof READERS];
      for (const name of sets) {
        const setId = await idOf('sys_permission_set', { name });
        expect(setId, `fixture permission set ${name} seeded`).toBeTruthy();
        await ql.insert('sys_user_permission_set', { user_id: userId, permission_set_id: setId }, SYS);
      }
      if (who === 'control') {
        // Staff the position BEFORE the subject exists: the slate resolves at request creation.
        await ql.insert('sys_position', { id: 'pos_atp', name: POSITION, label: 'Reviewer', active: true }, SYS);
        await ql.insert('sys_user_position', { id: 'hold_atp', user_id: userId, position: POSITION }, SYS);
      }
    }

    // Every activity row is written by the real CRUD mirror, from REST writes.
    const create = await stack.apiAs(token.writer, 'POST', `/data/${OBJ}`, {
      name: 'Item one',
      [FIELD.masked]: STORED.masked[0], [FIELD.gated]: STORED.gated[0], [FIELD.withheld]: STORED.withheld[0],
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id?: string; record?: { id?: string } };
    recordId = String(created.id ?? created.record?.id ?? '');
    const update = await stack.apiAs(token.writer, 'PATCH', `/data/${OBJ}/${recordId}`, {
      [FIELD.masked]: STORED.masked[1], [FIELD.gated]: STORED.gated[1], [FIELD.withheld]: STORED.withheld[1],
    });
    expect(update.status).toBe(200);
    for (const c of CLASSES) {
      const field = c === 'masked' ? 'email' : 'title';
      const res = await stack.apiAs(token.writer, 'POST', `/data/${LABEL_OBJ[c]}`, { [field]: LABEL_STORED[c] });
      expect(res.status).toBe(201);
    }
    const subject = await stack.apiAs(token.writer, 'POST', `/data/${APPR}`, {
      name: 'Subject one', [FIELD.masked]: SNAP.masked, [FIELD.gated]: SNAP.gated, [FIELD.withheld]: SNAP.withheld,
    });
    expect(subject.status).toBe(201);

    await assertArmed([
      armedWhen({
        control: 'the rows at rest carry every class of stored value, in the activity text, the labels and the snapshot',
        disarmedBy: 'a row that never carried a class would let a matching probe for it be refused or answered for no reason',
        observe: async () => {
          const rows = await ql.find('sys_activity', { where: { object_name: OBJ, record_id: recordId }, context: { isSystem: true } });
          const blob = JSON.stringify(rows);
          const labels: string[] = [];
          for (const c of CLASSES) {
            const lrows = await ql.find('sys_activity', { where: { object_name: LABEL_OBJ[c] }, context: { isSystem: true } });
            if (lrows.some((r: Row) => r.record_label === LABEL_STORED[c])) labels.push(c);
          }
          const requests = await ql.find('sys_approval_request', { where: { object_name: APPR }, context: { isSystem: true } });
          const snap = JSON.stringify(requests);
          const ledger = JSON.stringify(await ql.find('sys_audit_log', { where: { object_name: OBJ, record_id: recordId }, context: { isSystem: true } }));
          return {
            rows: rows.length,
            values: CLASSES.filter((c) => STORED[c].every((v) => blob.includes(v))),
            labels,
            requests: requests.length,
            snapshot: CLASSES.filter((c) => snap.includes(SNAP[c])),
            ledger: CLASSES.filter((c) => STORED[c].every((v) => ledger.includes(v))),
          };
        },
        armed: (o) =>
          o.rows >= 2 && o.values.length === 3 && o.labels.length === 3 && o.requests === 1 && o.snapshot.length === 3 &&
          o.ledger.length === 3,
        describe: (o) => JSON.stringify(o),
      }),
      armedWhen({
        control: 'the data plane serves each reader its own class as the class says, and the control every value stored',
        disarmedBy: 'a reader whose grants did not resolve would be an unrestricted reader, and its refusals would measure the pin rule alone',
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
  }, 240_000);

  afterAll(async () => {
    if (stack) await stack.stop();
  });

  for (const c of CLASSES) {
    describe(`a reader of the ${c} class`, () => {
      it('a matching and a non-matching filter on each value-bearing activity column are both refused, through the list door', async () => {
        for (const k of activityCases(c)) {
          expectRefused(await list(c, 'sys_activity', { object_name: k.parent, [k.column]: { $contains: k.stored } }), predicateWords('sys_activity', k.column));
          expectRefused(await list(c, 'sys_activity', { object_name: k.parent, [k.column]: { $contains: NOMATCH } }), predicateWords('sys_activity', k.column));
        }
      });

      it('the same probes are refused through the query door, and a grouping by each column in the aggregate words', async () => {
        for (const k of activityCases(c)) {
          for (const value of [k.stored, NOMATCH]) {
            expectRefused(
              await call(c, 'POST', '/data/sys_activity/query', { where: { object_name: k.parent, [k.column]: { $contains: value } } }),
              predicateWords('sys_activity', k.column),
            );
          }
          expectRefused(
            await call(c, 'POST', '/data/sys_activity/query', {
              where: { object_name: k.parent }, groupBy: [k.column], aggregations: [{ function: 'count', alias: 'n' }],
            }),
            aggregateWords('sys_activity', k.column),
          );
        }
      });

      it('a free-text search over the activity stream of the parent is refused, matching or not', async () => {
        for (const value of [STORED[c][1], NOMATCH]) {
          const a = await list(c, 'sys_activity', { object_name: OBJ }, `&$search=${encodeURIComponent(value)}`);
          expect(a.status, a.text).toBe(403);
          expect(a.code).toBe('PERMISSION_DENIED');
        }
      });

      it('a matching and a non-matching filter on each ledger snapshot column are both refused, and so is a grouping by it', async () => {
        for (const k of ledgerCases(c)) {
          for (const value of [k.stored, NOMATCH]) {
            expectRefused(await list(c, 'sys_audit_log', { object_name: OBJ, [k.column]: { $contains: value } }), predicateWords('sys_audit_log', k.column));
          }
          expectRefused(
            await call(c, 'POST', '/data/sys_audit_log/query', {
              where: { object_name: OBJ }, groupBy: [k.column], aggregations: [{ function: 'count', alias: 'n' }],
            }),
            aggregateWords('sys_audit_log', k.column),
          );
        }
      });

      it('a matching and a non-matching filter on the approval snapshot are both refused, and so is a grouping by it', async () => {
        for (const value of [SNAP[c], NOMATCH]) {
          expectRefused(
            await list(c, 'sys_approval_request', { object_name: APPR, payload_json: { $contains: value } }),
            predicateWords('sys_approval_request', 'payload_json'),
          );
        }
        expectRefused(
          await call(c, 'POST', '/data/sys_approval_request/query', {
            where: { object_name: APPR }, groupBy: ['payload_json'], aggregations: [{ function: 'count', alias: 'n' }],
          }),
          aggregateWords('sys_approval_request', 'payload_json'),
        );
      });

      it('the reader still filters the activity text of a parent it is served in full, as before', async () => {
        const other = SERVED_IN_FULL[c];
        const hit = await list(c, 'sys_activity', { object_name: LABEL_OBJ[other], record_label: { $contains: LABEL_STORED[other] } });
        expect(hit.status, hit.text).toBe(200);
        expect(hit.rows).toBe(1);
        const miss = await list(c, 'sys_activity', { object_name: LABEL_OBJ[other], record_label: { $contains: NOMATCH } });
        expect(miss.status, miss.text).toBe(200);
        expect(miss.rows).toBe(0);
        const ledgerHit = await list(c, 'sys_audit_log', { object_name: LABEL_OBJ[other], new_value: { $contains: LABEL_STORED[other] } });
        expect(ledgerHit.status, ledgerHit.text).toBe(200);
        expect(ledgerHit.rows).toBe(1);
        const ledgerMiss = await list(c, 'sys_audit_log', { object_name: LABEL_OBJ[other], new_value: { $contains: NOMATCH } });
        expect(ledgerMiss.status, ledgerMiss.text).toBe(200);
        expect(ledgerMiss.rows).toBe(0);
      });
    });
  }

  it('a filter that names no parent object is refused for every reader of a restricted class', async () => {
    for (const who of CLASSES) {
      expectRefused(await list(who, 'sys_activity', { summary: { $contains: STORED.masked[1] } }), predicateWords('sys_activity', 'summary'));
      expectRefused(await list(who, 'sys_approval_request', { payload_json: { $contains: SNAP.masked } }), predicateWords('sys_approval_request', 'payload_json'));
    }
  });

  it('a ledger filter that names no parent object is refused for every reader of a restricted class', async () => {
    for (const who of CLASSES) {
      expectRefused(await list(who, 'sys_audit_log', { new_value: { $contains: STORED.masked[1] } }), predicateWords('sys_audit_log', 'new_value'));
    }
  });

  it('control: the platform admin, served every field of every object, filters the activity stream, the ledger and the approval snapshot with no parent named, as before', async () => {
    const answered = async (object: string, where: unknown, extra = '') => {
      const a = await list('admin', object, where, extra);
      expect(a.status, a.text).toBe(200);
      return a.rows;
    };
    expect(await answered('sys_activity', { summary: { $contains: STORED.masked[1] } })).toBeGreaterThan(0);
    expect(await answered('sys_activity', { summary: { $contains: NOMATCH } })).toBe(0);
    expect(await answered('sys_audit_log', { new_value: { $contains: STORED.masked[1] } })).toBeGreaterThan(0);
    expect(await answered('sys_audit_log', { new_value: { $contains: NOMATCH } })).toBe(0);
    expect(await answered('sys_audit_log', {}, `&$search=${encodeURIComponent(STORED.masked[1])}`)).toBeGreaterThan(0);
    expect(await answered('sys_approval_request', { payload_json: { $contains: SNAP.masked } })).toBe(1);
    expect(await answered('sys_approval_request', { payload_json: { $contains: NOMATCH } })).toBe(0);
  });

  it('control: the unmasking reader filters and groups by every column of a pinned parent, as before', async () => {
    for (const c of CLASSES) {
      for (const k of activityCases(c)) {
        const hit = await list('control', 'sys_activity', { object_name: k.parent, [k.column]: { $contains: k.stored } });
        expect(hit.status, hit.text).toBe(200);
        expect(hit.rows).toBeGreaterThan(0);
        const miss = await list('control', 'sys_activity', { object_name: k.parent, [k.column]: { $contains: NOMATCH } });
        expect(miss.status, miss.text).toBe(200);
        expect(miss.rows).toBe(0);
      }
      for (const k of ledgerCases(c)) {
        const hit = await list('control', 'sys_audit_log', { object_name: OBJ, [k.column]: { $contains: k.stored } });
        expect(hit.status, hit.text).toBe(200);
        expect(hit.rows).toBeGreaterThan(0);
        const miss = await list('control', 'sys_audit_log', { object_name: OBJ, [k.column]: { $contains: NOMATCH } });
        expect(miss.status, miss.text).toBe(200);
        expect(miss.rows).toBe(0);
      }
      const snapHit = await list('control', 'sys_approval_request', { object_name: APPR, payload_json: { $contains: SNAP[c] } });
      expect(snapHit.status, snapHit.text).toBe(200);
      expect(snapHit.rows).toBe(1);
    }
    const snapMiss = await list('control', 'sys_approval_request', { object_name: APPR, payload_json: { $contains: NOMATCH } });
    expect(snapMiss.status, snapMiss.text).toBe(200);
    expect(snapMiss.rows).toBe(0);
    const grouped = await call('control', 'POST', '/data/sys_activity/query', {
      where: { object_name: OBJ }, groupBy: ['summary'], aggregations: [{ function: 'count', alias: 'n' }],
    });
    expect(grouped.status, grouped.text).toBe(200);
  });
});
