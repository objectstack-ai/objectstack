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
// ## Why the boot is org-bound
//
// The ownership floor binds `org_member` principals. An org-less boot measures
// the editor control in the one posture where no floor applies, where it passes
// with the floor left standing; `assertArmed` refuses it.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { cpgStack, cpgSecurity } from './fixtures/cbp-parent-gates-fixture.js';
import { assertArmed, principalArmed } from './armed.js';

const SYS = { isSystem: true } as const;

const OWNERSHIP_FLOOR =
  "the platform's wildcard row-level update floor (`owner_only_writes`, positions ['org_member']), which a " +
  'by-id update of a controlled_by_parent record hands over to the master-detail write check';
const OWNERSHIP_FLOOR_DISARM =
  "an org-less harness: a fresh sign-up then holds only ['everyone'], so no floor applies and the editor " +
  'control below passes whether or not explain hands the floor over. `orgContext: true` arms it.';

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

  const patch = async (token: string, object: string, id: string, name: string) =>
    answer(await stack.apiAs(token, 'PATCH', `/data/${object}/${id}`, { name }));

  beforeAll(async () => {
    stack = await bootStack(cpgStack as never, { security: cpgSecurity(), orgContext: true });
    adminTok = await stack.signIn();
    memberTok = await stack.signUp('cpe-member@verify.test');
    ql = await stack.kernel.getServiceAsync('objectql');
    const adminId = await uid('admin@objectos.ai');
    memberId = await uid('cpe-member@verify.test');

    await assertArmed([
      principalArmed({
        stack,
        token: memberTok,
        who: 'the member (edits their own master, not the admin\'s)',
        positions: ['org_member'],
        control: OWNERSHIP_FLOOR,
        disarmedBy: OWNERSHIP_FLOOR_DISARM,
      }),
    ]);

    const adminAccountId = (await ql.insert('cpg_account', { name: 'admin account', owner_id: adminId }, { context: { ...SYS } })).id;
    contractId = (await ql.insert('cpg_contract', { name: 'executed contract', account: adminAccountId }, { context: { ...SYS } })).id;
    const memberAccountId = (await ql.insert('cpg_account', { name: 'member account', owner_id: memberId }, { context: { ...SYS } })).id;
    memberContractId = (
      await ql.insert('cpg_contract', { name: 'member contract', account: memberAccountId }, { context: { ...SYS } })
    ).id;
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
});
