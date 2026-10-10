// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `POST /security/explain` answers an UPDATE of a `controlled_by_parent`
// record (ADR-0055) the way that record's own `PATCH` is answered, driven
// end-to-end through the REAL surfaces: better-auth sign-up members, the REST
// explain route, the generic `/data` path, plugin-sharing and plugin-security.
//
// ## What this suite pins
//
// A by-id update of a `controlled_by_parent` record meets two steps of the
// write path that the explanation used to model differently:
//
//   - step 2.7 hands the record's platform ownership floor (`owner_only_writes`,
//     bound to `org_member`) over to the master-detail write check, vouching
//     that the check runs on the same write. explain kept the floor, so a
//     member who may edit the master, but did not create the child, was
//     explained as refused (`decidedBy: 'rls'`) beside a PATCH answering 200;
//   - step 2.8 runs that master-detail write check. explain never asked it,
//     so a member who may NOT edit the master was explained as refused only
//     by the floor, on the wrong layer and with no word about the master.
//
// explain now asks the security service's own check
// (`checkControlledByParentWrite`) for the EXPLAINED principal, refuses on its
// refusal and names the leg, and vouches for the floor as step 2.7 does. Each
// verdict below sits beside the PATCH of the same record by the same
// principal.
//
// `record.visible` is the record's bottom line. `allowed` answers the object
// question (may this principal update `cpg_contract` at all), which is `true`
// for every member here; this suite does not measure it.
//
// ## Every write verb, not only update
//
// The data door runs the same master-detail write check (step 2.8) on a by-id
// DELETE, and on a transfer (the `PATCH` that writes `owner_id`, step 3.5's
// transfer door) too, and hands each one's ownership floor over to it the same
// way. The second block below enumerates every operation explain answers,
// classified against that door, and pins explain's verdict beside the door's
// answer for the master's editor and for a non-editor, per verb. Its
// classification is total, so a verb added to the explain vocabulary without a
// door parity row fails it.
//
// ## A transfer is judged by the update policies its door is judged by
//
// The third block is not about the master. A transfer's door is the `PATCH`
// that writes `owner_id`, an update, so an app-authored UPDATE row-level
// policy decides it, on any object. explain used to compose a transfer's
// row-level security for the raw verb, which the RLS compiler reads as a read,
// so it reported "No business RLS policy applies" and `visible: true` beside a
// 403. The block pins one `public_read_write` board row the policy excludes
// and one it admits, each beside the transfer door's answer.
//
// ## Why the boot is org-bound
//
// The ownership floor binds `org_member` principals. An org-less boot measures
// the editor control in the one posture where no floor applies, where it passes
// with the floor left standing; `assertArmed` refuses it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { ExplainOperationSchema, PermissionSetSchema, type ExplainOperation, type PermissionSet } from '@objectstack/spec/security';
import { cpgStack, cpgBaselineSet, cpgFilesAndThreadsSet } from './fixtures/cbp-parent-gates-fixture.js';
import { assertArmed, principalArmed } from './armed.js';

const SYS = { isSystem: true } as const;

const OWNERSHIP_FLOOR =
  "the platform's wildcard row-level update floor (`owner_only_writes`, positions ['org_member']), which a " +
  'by-id update of a controlled_by_parent record hands over to the master-detail write check';
const OWNERSHIP_FLOOR_DISARM =
  "an org-less harness: a fresh sign-up then holds only ['everyone'], so no floor applies and the editor " +
  'control below passes whether or not explain hands the floor over. `orgContext: true` arms it.';

/**
 * The steward's grant: every write verb on the detail, so the object gate lets
 * each verb through and the record-level gates answer it. `allowTransfer` is the
 * grant the transfer door (a `PATCH` that writes `owner_id`) asks for.
 */
const contractStewardSet: PermissionSet = PermissionSetSchema.parse({
  name: 'cpe_contract_steward',
  label: 'explain parity fixture — every write verb on the detail',
  objects: {
    cpg_contract: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, allowTransfer: true },
  },
});

/**
 * The board steward's grant: edit and transfer on the `public_read_write`
 * board, and one app-authored UPDATE row-level policy that admits only the
 * board named `open`. Nothing narrows a read, so the closed board is readable
 * and only a write-class composition can tell the two rows apart.
 */
const boardStewardSet: PermissionSet = PermissionSetSchema.parse({
  name: 'cpe_board_steward',
  label: 'explain parity fixture — edits and transfers only the open board',
  objects: {
    cpg_board: { allowRead: true, allowCreate: true, allowEdit: true, allowTransfer: true },
  },
  rowLevelSecurity: [
    { name: 'cpe_board_updates_open_only', object: 'cpg_board', operation: 'update', using: "name == 'open'" },
  ],
});

/** The fixture's own security composition, plus the stewards' grants. */
function cpeSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [
      ...securityDefaultPermissionSets,
      cpgBaselineSet,
      cpgFilesAndThreadsSet,
      contractStewardSet,
      boardStewardSet,
    ],
    fallbackPermissionSet: cpgBaselineSet.name,
  });
}

const OWNERSHIP_WRITE_AND_DELETE_FLOORS =
  "the platform's wildcard row-level floors (`owner_only_writes` and `owner_only_deletes`, positions " +
  "['org_member']), which a by-id write of a controlled_by_parent record hands over to the master-detail write check";

/** Status plus the error code, for an assertion message that shows the whole answer. */
async function answer(res: Response): Promise<{ status: number; code: string | undefined; body: string }> {
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

describe('security/explain answers a controlled_by_parent update as its PATCH does (ADR-0055)', () => {
  let stack: VerifyStack;
  let ql: any;
  let adminTok: string;
  let memberTok: string;
  let memberId: string;
  /** A child of an admin-owned `public_read` master: the member reads it and its PATCH refuses them. */
  let contractId: string;
  /** A child of a member-owned master, created by nobody the suite signs in as. */
  let memberContractId: string;
  /** The control: a `public_read_write` record. */
  let boardId: string;
  let adminId: string;
  /** The steward: every write verb on `cpg_contract` (see `contractStewardSet`), the master's editor or not. */
  let stewardTok: string;
  let stewardId: string;
  /** Per verb with a by-id door: a child of the admin's master, which the steward may not edit. */
  const underAdmin: Partial<Record<ExplainOperation, string>> = {};
  /** Per verb with a by-id door: a child of the steward's own master, which the steward did not create. */
  const underSteward: Partial<Record<ExplainOperation, string>> = {};

  /**
   * Every operation explain answers, classified against the data door. Total
   * by construction (`Record<ExplainOperation, …>`) and checked against the
   * spec's vocabulary below, so a verb added there without a row here fails.
   *
   *  - `by_id_door`: the door a principal reaches by id, which runs the
   *    master-detail write check (step 2.8) and hands the record's ownership
   *    floor over to it (step 2.7). `transfer`'s door is the `PATCH` that
   *    writes `owner_id`: the engine dispatches no `transfer` operation, and
   *    that write is where the transfer grant is enforced (step 3.5).
   *  - `object_gate_refused`: step 2.8 lists the verb, but the object gate
   *    refuses it to every principal (its grant is retired until the lifecycle
   *    batch returns it) and no route dispatches it.
   *  - `no_by_id_write`: not a write the master check judges by id — a read,
   *    or an insert, whose master step 2.8 reads off the request body.
   */
  type DoorRow =
    | { kind: 'by_id_door'; door: (token: string, id: string) => Promise<Response> }
    | { kind: 'object_gate_refused' }
    | { kind: 'no_by_id_write' };
  const DOORS: Record<ExplainOperation, DoorRow> = {
    update: { kind: 'by_id_door', door: (t, id) => stack.apiAs(t, 'PATCH', `/data/cpg_contract/${id}`, { name: 'stewarded' }) },
    delete: { kind: 'by_id_door', door: (t, id) => stack.apiAs(t, 'DELETE', `/data/cpg_contract/${id}`) },
    transfer: {
      kind: 'by_id_door',
      door: (t, id) => stack.apiAs(t, 'PATCH', `/data/cpg_contract/${id}`, { owner_id: adminId }),
    },
    restore: { kind: 'object_gate_refused' },
    purge: { kind: 'object_gate_refused' },
    create: { kind: 'no_by_id_write' },
    read: { kind: 'no_by_id_write' },
    export: { kind: 'no_by_id_write' },
  };
  const verbsOf = (kind: DoorRow['kind']) => (Object.keys(DOORS) as ExplainOperation[]).filter((v) => DOORS[v].kind === kind);
  const doorOf = (verb: ExplainOperation) => {
    const row = DOORS[verb];
    if (row.kind !== 'by_id_door') throw new Error(`${verb} has no by-id door`);
    return row.door;
  };

  const uid = async (email: string) => (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;

  const explainUpdate = async (token: string, object: string, recordId: string, userId?: string) => {
    const res = await stack.apiAs(token, 'POST', '/security/explain', {
      object,
      operation: 'update',
      recordId,
      ...(userId ? { userId } : {}),
    });
    const text = await res.text();
    expect(res.status, `explain update ${object}/${recordId}: ${text}`).toBe(200);
    const decision = JSON.parse(text) as any;
    const sharing = (decision.layers ?? []).find((l: any) => l.layer === 'sharing');
    return { record: decision.record, sharing: sharing?.record as { outcome?: string; detail?: string } | undefined };
  };

  /** explain for any verb, as the REST route answers it; the sharing layer's record attribution beside the record verdict. */
  const explainAs = async (token: string, operation: ExplainOperation, object: string, recordId: string) => {
    const res = await stack.apiAs(token, 'POST', '/security/explain', { object, operation, recordId });
    const text = await res.text();
    expect(res.status, `explain ${operation} ${object}/${recordId}: ${text}`).toBe(200);
    const decision = JSON.parse(text) as any;
    const sharing = (decision.layers ?? []).find((l: any) => l.layer === 'sharing');
    return { record: decision.record, sharing: sharing?.record as { outcome?: string; detail?: string } | undefined };
  };

  const patch = async (token: string, object: string, id: string, name: string) =>
    answer(await stack.apiAs(token, 'PATCH', `/data/${object}/${id}`, { name }));

  beforeAll(async () => {
    stack = await bootStack(cpgStack as never, { security: cpeSecurity(), orgContext: true });
    adminTok = await stack.signIn();
    memberTok = await stack.signUp('cpe-member@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    adminId = await uid('admin@objectos.ai');
    memberId = await uid('cpe-member@verify.test');
    stewardTok = await stack.signUp('cpe-steward@verify.test');
    stewardId = await uid('cpe-steward@verify.test');
    const stewardSet = await ql.findOne('sys_permission_set', { where: { name: contractStewardSet.name }, context: SYS });
    expect(stewardSet?.id, 'fixture permission set seeded').toBeTruthy();
    await ql.insert('sys_user_permission_set', { user_id: stewardId, permission_set_id: stewardSet.id }, { context: { ...SYS } });

    await assertArmed([
      principalArmed({
        stack,
        token: memberTok,
        who: 'the member (edits their own master, not the admin\'s)',
        positions: ['org_member'],
        control: OWNERSHIP_FLOOR,
        disarmedBy: OWNERSHIP_FLOOR_DISARM,
      }),
      principalArmed({
        stack,
        token: stewardTok,
        who: 'the steward (every write verb on the detail; edits their own master, not the admin\'s)',
        positions: ['org_member'],
        permissions: [contractStewardSet.name],
        control: OWNERSHIP_WRITE_AND_DELETE_FLOORS,
        disarmedBy:
          OWNERSHIP_FLOOR_DISARM +
          ' And without the steward grant every delete and transfer below is refused at the object gate, before any record-level gate answers.',
      }),
    ]);

    const adminAccountId = (await ql.insert('cpg_account', { name: 'admin account', owner_id: adminId }, { context: { ...SYS } })).id;
    contractId = (await ql.insert('cpg_contract', { name: 'executed contract', account: adminAccountId }, { context: { ...SYS } })).id;
    const memberAccountId = (await ql.insert('cpg_account', { name: 'member account', owner_id: memberId }, { context: { ...SYS } })).id;
    memberContractId = (
      await ql.insert('cpg_contract', { name: 'member contract', account: memberAccountId }, { context: { ...SYS } })
    ).id;
    // One pair of children per verb with a by-id door, inserted as the system, so
    // the steward created neither: the ownership floor binds both until a door
    // hands it over to the master check.
    const stewardAccountId = (
      await ql.insert('cpg_account', { name: 'steward account', owner_id: stewardId }, { context: { ...SYS } })
    ).id;
    for (const verb of verbsOf('by_id_door')) {
      underAdmin[verb] = (
        await ql.insert('cpg_contract', { name: `${verb}: admin's master`, account: adminAccountId }, { context: { ...SYS } })
      ).id;
      underSteward[verb] = (
        await ql.insert('cpg_contract', { name: `${verb}: steward's master`, account: stewardAccountId }, { context: { ...SYS } })
      ).id;
    }
    const boardRes = await stack.apiAs(adminTok, 'POST', '/data/cpg_board', { name: 'open board' });
    expect(boardRes.status, 'board create').toBeLessThan(300);
    const board = (await boardRes.json()) as any;
    boardId = String(board.id ?? board.record?.id ?? board.data?.id);
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('a child whose master the member cannot edit: explain refuses on the master leg the PATCH refuses on', async () => {
    const refused = await patch(memberTok, 'cpg_contract', contractId, 'executed contract');
    expect(refused.status, `member PATCH of the child: ${refused.body}`).toBe(403);
    expect(refused.code).toBe('PERMISSION_DENIED');
    expect(refused.body).toContain('requires edit access to its master record');
    expect(refused.body).toContain('(row-level security)');

    const explained = await explainUpdate(memberTok, 'cpg_contract', contractId);
    expect(explained.record).toEqual({ recordId: contractId, visible: false, decidedBy: 'sharing' });
    expect(explained.sharing?.outcome).toBe('excluded');
    expect(explained.sharing?.detail).toContain("refuses this update on its 'row_level_security' leg");
  });

  it('explaining that member as an administrator answers the member\'s verdict, not the administrator\'s', async () => {
    const forMember = await explainUpdate(adminTok, 'cpg_contract', contractId, memberId);
    expect(forMember.record).toEqual({ recordId: contractId, visible: false, decidedBy: 'sharing' });
    expect(forMember.sharing?.detail).toContain("refuses this update on its 'row_level_security' leg");

    // The administrator owns the master: their own verdict, and their own PATCH, admit.
    const forSelf = await explainUpdate(adminTok, 'cpg_contract', contractId);
    expect(forSelf.record).toMatchObject({ recordId: contractId, visible: true });
    const admitted = await patch(adminTok, 'cpg_contract', contractId, 'executed contract');
    expect(admitted.status, `admin PATCH of the child: ${admitted.body}`).toBe(200);
  });

  it('control: a child of the member\'s own master, which the member did not create, is explained writable and the PATCH answers 200', async () => {
    const explained = await explainUpdate(memberTok, 'cpg_contract', memberContractId);
    expect(explained.record).toMatchObject({ recordId: memberContractId, visible: true });
    expect(explained.sharing?.detail ?? '').not.toContain('master-detail write check');
    const admitted = await patch(memberTok, 'cpg_contract', memberContractId, 'member contract');
    expect(admitted.status, `member PATCH of a child under their own master: ${admitted.body}`).toBe(200);
  });

  it('control: a public_read_write record is explained writable and the PATCH answers 200', async () => {
    const explained = await explainUpdate(memberTok, 'cpg_board', boardId);
    expect(explained.record).toMatchObject({ recordId: boardId, visible: true });
    expect(explained.sharing?.detail ?? '').not.toContain('master-detail write check');
    const admitted = await patch(memberTok, 'cpg_board', boardId, 'open board');
    expect(admitted.status, `member PATCH of the board: ${admitted.body}`).toBe(200);
  });
  describe('every write verb explain answers: its verdict is the door\'s, for the master\'s editor and for a non-editor', () => {
    it('the classification is total: every operation explain answers has a door row', () => {
      expect([...ExplainOperationSchema.options].sort()).toEqual(Object.keys(DOORS).sort());
    });

    for (const verb of verbsOf('by_id_door')) {
      it(`${verb}: the master's non-editor is explained refused on the master leg the door refuses on`, async () => {
        const id = underAdmin[verb]!;
        const explained = await explainAs(stewardTok, verb, 'cpg_contract', id);
        const door = await answer(await doorOf(verb)(stewardTok, id));
        expect(door.status, `${verb} door, the master's non-editor: ${door.body}`).toBe(403);
        expect(door.code).toBe('PERMISSION_DENIED');
        expect(door.body).toContain('requires edit access to its master record');
        expect(door.body).toContain('(row-level security)');

        expect(explained.record, `explain ${verb}`).toEqual({ recordId: id, visible: false, decidedBy: 'sharing' });
        expect(explained.sharing?.outcome).toBe('excluded');
        expect(explained.sharing?.detail).toContain(`refuses this ${verb} on its 'row_level_security' leg`);
      });

      it(`${verb}: the master's editor, who did not create the child, is explained writable and the door answers 200`, async () => {
        const id = underSteward[verb]!;
        const explained = await explainAs(stewardTok, verb, 'cpg_contract', id);
        const door = await answer(await doorOf(verb)(stewardTok, id));
        expect(door.status, `${verb} door, the master's editor: ${door.body}`).toBe(200);

        expect(explained.record, `explain ${verb}`).toMatchObject({ recordId: id, visible: true });
        expect(explained.sharing?.detail ?? '').not.toContain('master-detail write check');
      });
    }

    for (const verb of verbsOf('object_gate_refused')) {
      it(`${verb}: refused at the object gate, for the master's editor and for a non-editor alike`, async () => {
        for (const id of [underAdmin.update!, underSteward.update!]) {
          const explained = await explainAs(stewardTok, verb, 'cpg_contract', id);
          expect(explained.record, `explain ${verb} ${id}`).toEqual({ recordId: id, visible: false, decidedBy: 'object_crud' });
        }
      });
    }
  });

  describe('transfer is judged by the update policy its door is judged by (public_read_write board)', () => {
    let boardStewardTok: string;
    /** A board the update policy excludes (`closed`), and one it admits (`open`). */
    let closedBoardId: string;
    let openBoardId: string;

    /** explain as the REST route answers it, with the `rls` layer beside the record verdict. */
    const explainRls = async (token: string, operation: ExplainOperation, recordId: string) => {
      const res = await stack.apiAs(token, 'POST', '/security/explain', { object: 'cpg_board', operation, recordId });
      const text = await res.text();
      expect(res.status, `explain ${operation} cpg_board/${recordId}: ${text}`).toBe(200);
      const decision = JSON.parse(text) as any;
      const rls = (decision.layers ?? []).find((l: any) => l.layer === 'rls');
      return { record: decision.record, rls: rls?.record as { outcome?: string; detail?: string } | undefined };
    };

    /** The transfer door: the PATCH that writes `owner_id`. */
    const transferDoor = async (token: string, id: string) =>
      answer(await stack.apiAs(token, 'PATCH', `/data/cpg_board/${id}`, { owner_id: adminId }));

    const createBoard = async (name: string): Promise<string> => {
      const res = await stack.apiAs(adminTok, 'POST', '/data/cpg_board', { name });
      expect(res.status, `board '${name}' create`).toBeLessThan(300);
      const board = (await res.json()) as any;
      return String(board.id ?? board.record?.id ?? board.data?.id);
    };

    beforeAll(async () => {
      boardStewardTok = await stack.signUp('cpe-board-steward@verify.test');
      const boardStewardId = await uid('cpe-board-steward@verify.test');
      const set = await ql.findOne('sys_permission_set', { where: { name: boardStewardSet.name }, context: SYS });
      expect(set?.id, 'board steward permission set seeded').toBeTruthy();
      await ql.insert('sys_user_permission_set', { user_id: boardStewardId, permission_set_id: set.id }, { context: { ...SYS } });
      await assertArmed([
        principalArmed({
          stack,
          token: boardStewardTok,
          who: 'the board steward (edit and transfer on the board; an update policy admits only the open board)',
          positions: ['org_member'],
          permissions: [boardStewardSet.name],
          control:
            "the app-authored update policy `cpe_board_updates_open_only` (name == 'open'), which the transfer door " +
            'meets as the update it is',
          disarmedBy:
            OWNERSHIP_FLOOR_DISARM +
            ' And without the board steward grant the update policy is not in play and every transfer below is ' +
            'refused at the object gate, before any record-level gate answers.',
        }),
      ]);
      closedBoardId = await createBoard('closed');
      openBoardId = await createBoard('open');
    });

    it('a board the update policy excludes: explain transfer refuses on rls, beside the transfer door\'s 403', async () => {
      const transfer = await explainRls(boardStewardTok, 'transfer', closedBoardId);
      const update = await explainRls(boardStewardTok, 'update', closedBoardId);
      const door = await transferDoor(boardStewardTok, closedBoardId);
      expect(door.status, `transfer door on the closed board: ${door.body}`).toBe(403);
      expect(door.code).toBe('PERMISSION_DENIED');

      expect(transfer.record, 'explain transfer').toEqual({ recordId: closedBoardId, visible: false, decidedBy: 'rls' });
      expect(transfer.rls?.outcome, 'explain transfer, the record\'s business RLS').toBe('excluded');
      expect(transfer.record, 'explain transfer answers what explain update answers').toEqual(update.record);
    });

    it('control: a board the update policy admits: explain transfer admits, beside the transfer door\'s 200', async () => {
      const transfer = await explainRls(boardStewardTok, 'transfer', openBoardId);
      const door = await transferDoor(boardStewardTok, openBoardId);
      expect(door.status, `transfer door on the open board: ${door.body}`).toBe(200);

      expect(transfer.record, 'explain transfer').toMatchObject({ recordId: openBoardId, visible: true });
      expect(transfer.rls?.outcome, 'explain transfer, the record\'s business RLS').toBe('admitted');
    });
  });
});
