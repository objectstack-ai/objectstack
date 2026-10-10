// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `security/explain` answers a by-id write of a row the caller cannot READ
// with the missing-record shape the door's 404 is, for EVERY write verb, on
// both axes that reach that answer.
//
// ## The door's question, and the verbs it is asked for
//
// Ruling A on the write doors (#21771): a row the caller cannot read is a row
// that does not exist. The by-id write pre-image gate (step 2.7) asks the read
// door's own question of the by-id `update` and `delete` the caller addresses
// (`addressedByIdWriteId`), and answers `404 RECORD_NOT_FOUND` for a row that
// read does not return. A lifecycle verb meets that question as the operation
// its door is: a transfer is the update that writes `owner_id` (the engine
// dispatches no `transfer` operation). That relation is the one mapping
// `rlsOperationForVerb` declares, so the verbs this file iterates are read off
// it: every explain verb the mapping sends to `update` or `delete`. A verb added
// to the mapping is iterated here with no new card, and a verb added to
// explain's vocabulary fails the totality check below until it has a door row.
//
// explain's rewrite used to key on the RAW verb (`update` or `delete`), so a
// transfer of an unreadable row was reported `visible: true` (or refused on
// `rls`) beside the door's 404.
//
// ## The two axes
//
//   - read-absent: the caller's write-class policies ADMIT the hidden row and
//     only the read hides it, so readability alone separates the door's 404
//     from its admission;
//   - no policy: the caller's sets carry no write-class policy at all, so the
//     door composes the write scope from the caller's SELECT narrowing (#7665,
//     "you cannot mutate what you cannot see"): fail closed, not unbounded.
//
// Each cell drives both faces through the real `SecurityPlugin` over a real
// `ObjectQL` and SQL driver, and asserts the door's own answer too, so a cell
// cannot go green by both faces drifting together. The callers hold no
// `org_member` position, so the platform's ownership floor is out of play and
// each axis is exactly what it says. The REST-level twin, on the `cpg` fixture
// with the floor in play, is `packages/qa/dogfood/test/explain-write-door-parity.dogfood.test.ts`.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ExplainOperationSchema, PermissionSetSchema } from '@objectstack/spec/security';
import type { ExplainDecision, ExplainOperation } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { rlsOperationForVerb } from './lifecycle-verb-rls-operation.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const OBJ = 'qa_read_absent_board';

/** Every write grant, so the object gate admits each verb it can and the row gates answer. */
const ALL_WRITES = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowTransfer: true };

/** The read hides the row named `hidden`; the write-class policies admit every row. */
const READ_ABSENT_SET = PermissionSetSchema.parse({
  name: 'qa_read_absent_writer',
  objects: { [OBJ]: ALL_WRITES },
  rowLevelSecurity: [
    { name: 'qa_ra_reads_not_hidden', object: OBJ, operation: 'select', using: "name != 'hidden'" },
    { name: 'qa_ra_updates_any', object: OBJ, operation: 'update', using: "name != 'nothing'" },
    { name: 'qa_ra_deletes_any', object: OBJ, operation: 'delete', using: "name != 'nothing'" },
  ],
});

/** The same read narrowing, and no write-class policy: the door derives the write scope from it. */
const NO_POLICY_SET = PermissionSetSchema.parse({
  name: 'qa_policyless_writer',
  objects: { [OBJ]: ALL_WRITES },
  rowLevelSecurity: [
    { name: 'qa_np_reads_not_hidden', object: OBJ, operation: 'select', using: "name != 'hidden'" },
  ],
});

const AXES = [
  { axis: 'read-absent', set: READ_ABSENT_SET.name },
  { axis: 'no policy', set: NO_POLICY_SET.name },
] as const;

type Answer = { kind: 'admitted' } | { kind: 'refused'; code?: string; status?: number };

const landed = (p: Promise<unknown>): Promise<Answer> =>
  p.then(
    () => ({ kind: 'admitted' as const }),
    (e: any) => ({ kind: 'refused' as const, code: e?.code == null ? undefined : String(e.code), status: e?.statusCode ?? e?.status }),
  );

/**
 * Every operation explain answers, classified against the door. Total by
 * construction and checked against the spec's vocabulary below.
 *
 *  - `by_id_door`: the engine write the verb's door is, addressed by id;
 *  - `object_gate_refused`: the object gate refuses the verb to every
 *    principal (its grant is retired until the lifecycle batch returns it) and
 *    no route dispatches it, so the object-level CRUD layer answers first;
 *  - `no_by_id_write`: a read, an insert or an export — no row is written by id.
 */
type DoorRow =
  | { kind: 'by_id_door'; door: (rig: Rig, id: string, caller: Caller) => Promise<Answer> }
  | { kind: 'object_gate_refused' }
  | { kind: 'no_by_id_write' };

type Caller = { userId: string; positions: string[]; permissions: string[]; posture: string };
type Rig = { engine: ObjectQL; plugin: SecurityPlugin };

const DOORS: Record<ExplainOperation, DoorRow> = {
  update: {
    kind: 'by_id_door',
    door: (r, id, c) => landed(r.engine.update(OBJ, { title: 'edited' }, { where: { id }, context: c } as never)),
  },
  delete: {
    kind: 'by_id_door',
    door: (r, id, c) => landed(r.engine.delete(OBJ, { where: { id }, context: c } as never)),
  },
  // The transfer door: the update that writes `owner_id`.
  transfer: {
    kind: 'by_id_door',
    door: (r, id, c) => landed(r.engine.update(OBJ, { owner_id: 'usr_successor' }, { where: { id }, context: c } as never)),
  },
  restore: { kind: 'object_gate_refused' },
  purge: { kind: 'object_gate_refused' },
  create: { kind: 'no_by_id_write' },
  read: { kind: 'no_by_id_write' },
  export: { kind: 'no_by_id_write' },
};

/** The write verbs: every explain verb whose door the mapping names a by-id update or delete. */
const WRITE_VERBS = ExplainOperationSchema.options.filter((v) => ['update', 'delete'].includes(rlsOperationForVerb(v)));

const callerFor = (set: string): Caller => ({ userId: `usr_${set}`, positions: ['qa_pos'], permissions: [set], posture: 'MEMBER' });

let rig: Rig;

beforeAll(async () => {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.explain-read-absent-every-write-verb',
    name: 'Explain read-absent: every write verb',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: OBJ,
        label: 'Board',
        sharingModel: 'public_read_write',
        fields: {
          id: { name: 'id', type: 'text', primaryKey: true },
          name: { name: 'name', type: 'text' },
          title: { name: 'title', type: 'text' },
          owner_id: { name: 'owner_id', type: 'text' },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();
  // One unreadable and one readable row per (axis, verb), so a delete or a
  // transfer that lands never changes another cell's row.
  for (const { set } of AXES) {
    for (const verb of ExplainOperationSchema.options) {
      await engine.insert(OBJ, [
        { id: `${set}_${verb}_hidden`, name: 'hidden', title: 'x', owner_id: 'usr_founder' },
        { id: `${set}_${verb}_shown`, name: 'shown', title: 'x', owner_id: 'usr_founder' },
      ], SYS);
    }
  }
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, READ_ABSENT_SET, NO_POLICY_SET],
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    // The lifecycle hooks are collected and never fired, so no bootstrap read
    // is left running into the engine teardown.
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  rig = { engine, plugin };
});

afterAll(async () => {
  try { await rig?.engine.destroy(); } catch { /* noop */ }
});

const explain = (operation: ExplainOperation, recordId: string, caller: Caller): Promise<ExplainDecision> =>
  rig.plugin.explainAccessForCaller({ object: OBJ, operation, recordId }, caller);

describe('explain answers a write of a row the caller cannot read as the door does, for every write verb', () => {
  it('the classification is total: every operation explain answers has a door row', () => {
    expect([...ExplainOperationSchema.options].sort()).toEqual(Object.keys(DOORS).sort());
  });

  it("the write verbs are the mapping's: each has a by-id door or is refused at the object gate, and nothing else does", () => {
    const writeRows = (Object.keys(DOORS) as ExplainOperation[]).filter((v) => DOORS[v].kind !== 'no_by_id_write').sort();
    expect(writeRows).toEqual([...WRITE_VERBS].sort());
  });

  for (const { axis, set } of AXES) {
    describe(axis, () => {
      for (const verb of WRITE_VERBS) {
        const row = DOORS[verb];
        if (row.kind === 'by_id_door') {
          it(`${verb}: a row the caller cannot read is explained missing, beside the door's 404`, async () => {
            const caller = callerFor(set);
            const id = `${set}_${verb}_hidden`;
            const explained = await explain(verb, id, caller);
            const door = await row.door(rig, id, caller);
            expect(door, `${verb} door on the unreadable row`).toEqual({ kind: 'refused', code: 'RECORD_NOT_FOUND', status: 404 });
            // The missing-record shape: no decider, exactly what an id no row
            // carries is explained as.
            expect(explained.record, `explain ${verb}`).toStrictEqual({ recordId: id, visible: false });
          });

          it(`${verb}: control, a readable row keeps its verdict, beside the door's admission`, async () => {
            const caller = callerFor(set);
            const id = `${set}_${verb}_shown`;
            const explained = await explain(verb, id, caller);
            const door = await row.door(rig, id, caller);
            expect(door, `${verb} door on the readable row`).toEqual({ kind: 'admitted' });
            expect(explained.record, `explain ${verb}`).toMatchObject({ recordId: id, visible: true });
            expect(explained.record?.decidedBy, `explain ${verb}: a decider names the admission`).toBeDefined();
          });
        } else {
          it(`${verb}: refused at the object gate, for the unreadable and the readable row alike`, async () => {
            const caller = callerFor(set);
            for (const id of [`${set}_${verb}_hidden`, `${set}_${verb}_shown`]) {
              const explained = await explain(verb, id, caller);
              expect(explained.record, `explain ${verb} ${id}`).toStrictEqual({ recordId: id, visible: false, decidedBy: 'object_crud' });
            }
          });
        }
      }
    });
  }
});
