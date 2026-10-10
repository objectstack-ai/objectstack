// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `POST /security/explain` gives every write verb's record verdict the answer
// that verb's door gives, on the two axes where a row's readability decides
// it. Driven end-to-end through the REAL surfaces: better-auth sign-up members,
// the REST explain route, the generic `/data` path, plugin-sharing and
// plugin-security, on the `cpg` fixture's `public_read_write` board.
//
// ## The family this closes
//
// explain answers a by-id write by re-asking each of the door's gates, and four
// times in a row one write verb was asked differently: an update and then a
// delete and transfer of a `controlled_by_parent` record (the master-detail
// check, `cbp-explain-master-write.dogfood.test.ts`), a transfer's row-level
// security composed for the raw verb, and here a transfer of a row the caller
// cannot read. The door answers that last one `404 RECORD_NOT_FOUND` (ruling A
// on the write doors: a row the caller cannot read is a row that does not
// exist), and explain reported it visible. So this pin iterates every write
// verb, not the one that slipped, against both axes, each cell beside the
// door's real answer.
//
// ## The two axes
//
//   - read-absent: the caller's write-class policies ADMIT the hidden row, and
//     only the read hides it. Readability alone separates the door's 404 from
//     its admission.
//   - no policy: the caller's own set declares no write-class policy at all.
//     The door then composes the update scope from the caller's SELECT
//     narrowing ("you cannot mutate what you cannot see"), and a delete meets
//     the platform's ownership floor (`owner_only_deletes`, bound to
//     `org_member`). Fail closed, never unbounded, so a row the caller did not
//     create is refused a delete even though it is readable.
//
// Per axis and per verb with a by-id door, three rows: one the caller cannot
// read (the admin's `hidden`), one they can read and did not create (the
// admin's `approved`), and one they created (`own`). Each cell asserts the
// door's own answer as well as explain's, so a cell cannot go green by both
// faces drifting together, and the two are compared by one correspondence:
//
//   door 404 RECORD_NOT_FOUND  ⇔  { recordId, visible: false }, no decider
//   door 403 PERMISSION_DENIED ⇔  visible: false, with the deciding layer
//   door 2xx                   ⇔  visible: true
//
// `allowed` answers the object question (may this principal write
// `cpg_board` at all), which is `true` for every member here; this suite does
// not measure it.
//
// ## Why the boot is org-bound
//
// The ownership floor binds `org_member` principals. An org-less boot measures
// the no-policy delete in the one posture where no floor applies; `assertArmed`
// refuses it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { ExplainOperationSchema, PermissionSetSchema, type ExplainOperation, type PermissionSet } from '@objectstack/spec/security';
import { cpgStack, cpgBaselineSet, cpgFilesAndThreadsSet } from './fixtures/cbp-parent-gates-fixture.js';
import { assertArmed, principalArmed } from './armed.js';

const SYS = { isSystem: true } as const;

/** Every write grant on the board, so the object gate admits each verb it can and the row gates answer. */
const BOARD_WRITES = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowTransfer: true };

/** read-absent: the read hides the board named `hidden`; the write-class policies admit every board. */
const unreadableWriterSet: PermissionSet = PermissionSetSchema.parse({
  name: 'cpe_unreadable_writer',
  label: 'explain door parity — writes every board, reads all but the hidden one',
  objects: { cpg_board: BOARD_WRITES },
  rowLevelSecurity: [
    { name: 'cpe_uw_reads_not_hidden', object: 'cpg_board', operation: 'select', using: "name != 'hidden'" },
    { name: 'cpe_uw_updates_any', object: 'cpg_board', operation: 'update', using: "name != 'nothing'" },
    { name: 'cpe_uw_deletes_any', object: 'cpg_board', operation: 'delete', using: "name != 'nothing'" },
  ],
});

/** no policy: the same read narrowing, and no write-class policy of the set's own. */
const policylessWriterSet: PermissionSet = PermissionSetSchema.parse({
  name: 'cpe_policyless_writer',
  label: 'explain door parity — reads all but the hidden board, declares no write policy',
  objects: { cpg_board: BOARD_WRITES },
  rowLevelSecurity: [
    { name: 'cpe_pw_reads_not_hidden', object: 'cpg_board', operation: 'select', using: "name != 'hidden'" },
  ],
});

type Axis = 'read-absent' | 'no policy';
const AXES: ReadonlyArray<{ axis: Axis; set: PermissionSet; email: string }> = [
  { axis: 'read-absent', set: unreadableWriterSet, email: 'cpe-unreadable-writer@verify.test' },
  { axis: 'no policy', set: policylessWriterSet, email: 'cpe-policyless-writer@verify.test' },
];

/** The three rows each (axis, verb) cell is asked about. */
type RowKind = 'unreadable' | 'readable, not theirs' | 'readable, their own';
const ROW_NAMES: Record<RowKind, string> = { unreadable: 'hidden', 'readable, not theirs': 'approved', 'readable, their own': 'own' };

type DoorAnswer = { status: number; code: string | undefined; body: string };
const NOT_FOUND = { status: 404, code: 'RECORD_NOT_FOUND' } as const;
const DENIED = { status: 403, code: 'PERMISSION_DENIED' } as const;
const LANDED = { status: 200 } as const;

/** The door's answer per (axis, verb, row) — asserted, so the fixture's arming is part of every cell. */
const EXPECTED_DOOR: Record<Axis, Record<'update' | 'delete' | 'transfer', Record<RowKind, { status: number; code?: string }>>> = {
  'read-absent': {
    update: { unreadable: NOT_FOUND, 'readable, not theirs': LANDED, 'readable, their own': LANDED },
    delete: { unreadable: NOT_FOUND, 'readable, not theirs': LANDED, 'readable, their own': LANDED },
    transfer: { unreadable: NOT_FOUND, 'readable, not theirs': LANDED, 'readable, their own': LANDED },
  },
  'no policy': {
    update: { unreadable: NOT_FOUND, 'readable, not theirs': LANDED, 'readable, their own': LANDED },
    // The ownership floor: no write policy of the caller's own, and they did not create the row.
    delete: { unreadable: NOT_FOUND, 'readable, not theirs': DENIED, 'readable, their own': LANDED },
    transfer: { unreadable: NOT_FOUND, 'readable, not theirs': LANDED, 'readable, their own': LANDED },
  },
};

/** Status plus the error code, for an assertion message that shows the whole answer. */
async function answer(res: Response): Promise<DoorAnswer> {
  const body = await res.text();
  let code: string | undefined;
  try {
    const j = JSON.parse(body) as any;
    code = j?.code ?? j?.error?.code;
  } catch {
    code = undefined;
  }
  return { status: res.status, code, body };
}

describe('security/explain answers every write verb as its door does, on read-absent and no-policy rows', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let adminId: string;
  const tokens: Partial<Record<Axis, string>> = {};
  /** rows[axis][verb][row] — one board per cell, so a delete or transfer that lands never moves another cell. */
  const rows: Partial<Record<Axis, Partial<Record<ExplainOperation, Partial<Record<RowKind, string>>>>>> = {};

  /**
   * Every operation explain answers, classified against the data door. Total
   * by construction (`Record<ExplainOperation, …>`) and checked against the
   * spec's vocabulary below, so a verb added there without a row here fails.
   *
   *  - `by_id_door`: the door a principal reaches by id. A transfer's door is
   *    the `PATCH` that writes `owner_id`, an update: the engine dispatches no
   *    `transfer` operation, and the transfer grant is enforced on that write.
   *  - `object_gate_refused`: the object gate refuses the verb to every
   *    principal (its grant is retired until the lifecycle batch returns it)
   *    and no route dispatches it.
   *  - `no_by_id_write`: a read, an insert or an export — nothing is written by id.
   */
  type DoorRow =
    | { kind: 'by_id_door'; door: (token: string, id: string, name: string) => Promise<Response> }
    | { kind: 'object_gate_refused' }
    | { kind: 'no_by_id_write' };
  const DOORS: Record<ExplainOperation, DoorRow> = {
    update: { kind: 'by_id_door', door: (t, id, name) => stack.apiAs(t, 'PATCH', `/data/cpg_board/${id}`, { name }) },
    delete: { kind: 'by_id_door', door: (t, id) => stack.apiAs(t, 'DELETE', `/data/cpg_board/${id}`) },
    transfer: { kind: 'by_id_door', door: (t, id) => stack.apiAs(t, 'PATCH', `/data/cpg_board/${id}`, { owner_id: adminId }) },
    restore: { kind: 'object_gate_refused' },
    purge: { kind: 'object_gate_refused' },
    create: { kind: 'no_by_id_write' },
    read: { kind: 'no_by_id_write' },
    export: { kind: 'no_by_id_write' },
  };
  const verbsOf = (kind: DoorRow['kind']) => (Object.keys(DOORS) as ExplainOperation[]).filter((v) => DOORS[v].kind === kind);
  const ROW_KINDS = Object.keys(ROW_NAMES) as RowKind[];

  const uid = async (email: string) => (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;

  const createBoard = async (token: string, name: string): Promise<string> => {
    const res = await stack.apiAs(token, 'POST', '/data/cpg_board', { name });
    expect(res.status, `board '${name}' create`).toBeLessThan(300);
    const board = (await res.json()) as any;
    return String(board.id ?? board.record?.id ?? board.data?.id);
  };

  /** explain as the REST route answers it: the record verdict. */
  const explainRecord = async (token: string, operation: ExplainOperation, recordId: string) => {
    const res = await stack.apiAs(token, 'POST', '/security/explain', { object: 'cpg_board', operation, recordId });
    const text = await res.text();
    expect(res.status, `explain ${operation} cpg_board/${recordId}: ${text}`).toBe(200);
    return (JSON.parse(text) as any).record as { recordId: string; visible: boolean; decidedBy?: string };
  };

  beforeAll(async () => {
    stack = await bootStack(cpgStack as never, {
      security: new SecurityPlugin({
        defaultPermissionSets: [
          ...securityDefaultPermissionSets,
          cpgBaselineSet,
          cpgFilesAndThreadsSet,
          unreadableWriterSet,
          policylessWriterSet,
        ],
        fallbackPermissionSet: cpgBaselineSet.name,
      }),
      orgContext: true,
    });
    adminTok = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
    adminId = await uid('admin@objectos.ai');

    for (const { axis, set, email } of AXES) {
      const token = await stack.signUp(email);
      const userId = await uid(email);
      const row = await ql.findOne('sys_permission_set', { where: { name: set.name }, context: SYS });
      expect(row?.id, `${set.name} seeded`).toBeTruthy();
      await ql.insert('sys_user_permission_set', { user_id: userId, permission_set_id: row.id }, { context: { ...SYS } });
      tokens[axis] = token;
    }

    await assertArmed(AXES.map(({ axis, set }) =>
      principalArmed({
        stack,
        token: tokens[axis]!,
        who: `the ${axis} writer (${set.name})`,
        positions: ['org_member'],
        permissions: [set.name],
        control:
          axis === 'read-absent'
            ? "a select policy that hides the board named 'hidden' beside write-class policies that admit it, so " +
              'readability alone decides the door'
            : "a select policy that hides the board named 'hidden' and no write-class policy of the set's own, so the " +
              "door derives the update scope from the read and a delete meets the platform's ownership floor " +
              "(`owner_only_deletes`, positions ['org_member'])",
        disarmedBy:
          "an org-less harness: a fresh sign-up then holds only ['everyone'], so the ownership floor never applies, " +
          'and without the grant every write below is refused at the object gate before any row gate answers. ' +
          '`orgContext: true` and the direct grant arm both.',
      }),
    ));

    for (const { axis } of AXES) {
      const own = tokens[axis]!;
      rows[axis] = {};
      for (const verb of [...verbsOf('by_id_door'), ...verbsOf('object_gate_refused')]) {
        rows[axis]![verb] = {
          unreadable: await createBoard(adminTok, ROW_NAMES.unreadable),
          'readable, not theirs': await createBoard(adminTok, ROW_NAMES['readable, not theirs']),
          'readable, their own': await createBoard(own, ROW_NAMES['readable, their own']),
        };
      }
    }
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('the classification is total: every operation explain answers has a door row', () => {
    expect([...ExplainOperationSchema.options].sort()).toEqual(Object.keys(DOORS).sort());
  });

  for (const { axis } of AXES) {
    describe(axis, () => {
      for (const verb of verbsOf('by_id_door')) {
        for (const kind of ROW_KINDS) {
          it(`${verb}, a board ${kind === 'unreadable' ? 'the caller cannot read' : kind === 'readable, not theirs' ? 'the caller reads and did not create' : 'the caller created'}: explain gives the door's answer`, async () => {
            const token = tokens[axis]!;
            const id = rows[axis]![verb]![kind]!;
            const explained = await explainRecord(token, verb, id);
            const door = await answer(await (DOORS[verb] as Extract<DoorRow, { kind: 'by_id_door' }>).door(token, id, ROW_NAMES[kind]));
            const expected = EXPECTED_DOOR[axis][verb as 'update' | 'delete' | 'transfer'][kind];

            expect(door.status, `${verb} door, ${axis}, ${kind}: ${door.body}`).toBe(expected.status);
            if (expected.code) expect(door.code, `${verb} door, ${axis}, ${kind}`).toBe(expected.code);

            if (door.status === 404) {
              // The missing-record shape: no decider, what an id no row carries is explained as.
              expect(explained, `explain ${verb}, ${axis}, ${kind}`).toStrictEqual({ recordId: id, visible: false });
            } else if (door.status === 403) {
              expect(explained.visible, `explain ${verb}, ${axis}, ${kind}`).toBe(false);
              expect(explained.decidedBy, `explain ${verb}, ${axis}, ${kind}: a refusal names its layer`).toBeDefined();
            } else {
              expect(explained, `explain ${verb}, ${axis}, ${kind}`).toMatchObject({ recordId: id, visible: true });
            }
          });
        }
      }

      for (const verb of verbsOf('object_gate_refused')) {
        it(`${verb}: refused at the object gate, for every row alike`, async () => {
          const token = tokens[axis]!;
          for (const kind of ROW_KINDS) {
            const id = rows[axis]![verb]![kind]!;
            const explained = await explainRecord(token, verb, id);
            expect(explained, `explain ${verb}, ${axis}, ${kind}`).toStrictEqual({ recordId: id, visible: false, decidedBy: 'object_crud' });
          }
        });
      }
    });
  }
});
