// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0090 D12; ruling of record 5985885287] A delegated administrator's
// assignment write to a row it cannot read, or to an id naming none, answers
// the read door's not-found, as a read does — measured at the HTTP data door
// of the showcase behind a real organization wall (`multiTenant:
// 'posture-only'`, the `isolated` posture).
//
// ── what is pinned ─────────────────────────────────────────────────────────
//
// Two callers of organization A hold the showcase's delegated-administration
// set (`showcase_field_ops_delegate`, an `adminScope` over A's "Field
// Operations" subtree): a member of A, and A's owner — an organization
// administrator who also holds the scope. A position assignment of
// organization B, anchored at one of B's units, sits behind the wall, so
// neither reads it. `PATCH` and `DELETE` of it by id, and of an id naming no
// row, answer exactly what a `GET` of that id answers — the read door's `404
// RECORD_NOT_FOUND`, status and body. The row stays.
//
// Controls, so a green run is not "every write is answered alike":
//
//   - the wall is real (`isolated`, active, not degraded); each caller is no
//     platform administrator, is active in A, reads no row of B, and the
//     delegate holds the scope's set in A;
//   - a row of A inside the scope, which the delegate reads, is admitted;
//   - a row of A outside the scope, which it reads, keeps the guidance that
//     names its unit, and is not answered as no row; it stays.
//
// The engine-level matrix (both walled postures, both assignment tables, a
// delegate refused the read, the `single` control) is pinned in
// `packages/plugins/plugin-security/src/org-admin-assignment-boundary.posture.test.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const OWNER_A = 'dg-unreadable-owner-a@verify.test';
const OWNER_B = 'dg-unreadable-owner-b@verify.test';
const DELEGATE = 'dg-unreadable-delegate@verify.test';
const DELEGATE_SET = 'showcase_field_ops_delegate';
const SCOPE_UNIT = 'Field Operations';
const MISSING = 'zz_no_such_row_0001';

interface Answer { status: number; body: unknown }

/** The answer with the caller-supplied id written out, so the answers for two ids compare. */
const withoutId = (a: Answer, id: string): Answer =>
  JSON.parse(JSON.stringify(a).split(id).join('ID')) as Answer;

const codeOf = (a: Answer): unknown => (a.body as any)?.code ?? (a.body as any)?.error?.code;
const idOf = (b: any): string => String(b?.id ?? b?.record?.id ?? b?.data?.id ?? '');

describe("behind the organization wall, a delegated administrator's assignment write to a row it cannot read, or to an id naming none, answers the read door's not-found", () => {
  let stack: VerifyStack;
  let ql: any;
  const tokens: Record<'delegate' | 'owner', string> = { delegate: '', owner: '' };
  let orgA = '';
  let orgB = '';
  let positionB = '';
  let inScopeA = '';
  let outOfScopeA = '';
  let outsideUnitA = '';

  const call = async (token: string, method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.api(path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let parsed: unknown;
    try { parsed = await res.json(); } catch { parsed = undefined; }
    return { status: res.status, body: parsed };
  };
  const write = (token: string, method: 'PATCH' | 'DELETE', id: string): Promise<Answer> =>
    call(token, method, `/data/sys_user_position/${id}`, method === 'PATCH' ? { reason: 'edited' } : undefined);

  const stored = (id: string) => ql.findOne('sys_user_position', { where: { id }, context: SYS });
  const userId = async (email: string): Promise<string> =>
    String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id ?? '');
  const inOrg = (organizationId: string) => ({ context: { ...SYS, tenantId: organizationId } });

  /** A new organization, created and made active by its owner. */
  const organization = async (token: string, name: string, slug: string): Promise<string> => {
    const created = await stack.apiAs(token, 'POST', '/auth/organization/create', { name, slug });
    expect(created.status, `org create ${slug}: ${await created.clone().text()}`).toBe(200);
    const id = String(((await created.json()) as { id: string }).id);
    const active = await stack.apiAs(token, 'POST', '/auth/organization/set-active', { organizationId: id });
    expect(active.status, `set-active ${slug}: ${await active.clone().text()}`).toBe(200);
    return id;
  };

  /** A business unit of `organizationId` named `name` — the one it holds, or a new one. */
  const unit = async (organizationId: string, name: string, code: string): Promise<string> => {
    const rows = await ql.find('sys_business_unit', { where: { name, organization_id: organizationId }, context: SYS });
    const held = (Array.isArray(rows) ? rows : []).find((r: any) => r?.organization_id === organizationId);
    if (held?.id) return String(held.id);
    return idOf(await ql.insert('sys_business_unit', { name, code, organization_id: organizationId }, inOrg(organizationId)));
  };

  /** A position assignment of `organizationId`, written by the system. */
  const assignment = async (organizationId: string, user: string, position: string, businessUnitId: string): Promise<string> =>
    idOf(await ql.insert('sys_user_position',
      { user_id: user, position, business_unit_id: businessUnitId, organization_id: organizationId },
      inOrg(organizationId)));

  beforeAll(async () => {
    stack = await bootShowcase({ multiTenant: 'posture-only' });
    ql = await stack.kernel.getServiceAsync('objectql');

    tokens.owner = await stack.signUp(OWNER_A);
    orgA = await organization(tokens.owner, 'Delegated Unreadable A', 'dg-unreadable-a');
    const ownerBTok = await stack.signUp(OWNER_B);
    orgB = await organization(ownerBTok, 'Delegated Unreadable B', 'dg-unreadable-b');

    // The delegate joins A as a member, in system context — the only writer
    // the better-auth-managed membership table accepts — and makes A active.
    tokens.delegate = await stack.signUp(DELEGATE);
    const delegate = await userId(DELEGATE);
    await ql.insert('sys_member', { user_id: delegate, organization_id: orgA, role: 'member' }, inOrg(orgA));
    const active = await stack.apiAs(tokens.delegate, 'POST', '/auth/organization/set-active', { organizationId: orgA });
    expect(active.status, `delegate set-active: ${await active.clone().text()}`).toBe(200);

    // Both callers hold the delegated-administration set in A.
    const ownerA = await userId(OWNER_A);
    for (const user of [delegate, ownerA]) {
      await ql.insert('sys_user_permission_set', { user_id: user, permission_set: DELEGATE_SET, organization_id: orgA }, inOrg(orgA));
    }

    const scopeUnitA = await unit(orgA, SCOPE_UNIT, 'DG-FOPS-A');
    outsideUnitA = await unit(orgA, 'Delegated Unreadable Outside', 'DG-OUT-A');
    const unitB = await unit(orgB, 'Delegated Unreadable B Unit', 'DG-B1');

    const ownerB = await userId(OWNER_B);
    positionB = await assignment(orgB, ownerB, 'contributor', unitB);
    // Inside the scope, written by the delegate itself through the door — so
    // the record-level write rules after the gate (the creator's own row)
    // admit its edit too, and the edit measures the gate's verdict.
    const created = await call(tokens.delegate, 'POST', '/data/sys_user_position',
      { user_id: ownerA, position: 'contributor', business_unit_id: scopeUnitA });
    expect(created.status, `delegate assigns inside its scope — ${JSON.stringify(created.body)}`).toBeLessThan(300);
    inScopeA = idOf(created.body);
    outOfScopeA = await assignment(orgA, delegate, 'contributor', outsideUnitA);
    expect(delegate && ownerA && positionB && inScopeA && outOfScopeA, 'every row carries an id').toBeTruthy();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('guard the guard: a real wall; both callers hold the scope in A, are no platform administrators, and read no row of B', async () => {
    const tenancy = await stack.kernel.getServiceAsync<{ posture: string; isolationActive: boolean; degraded: boolean }>('tenancy');
    expect([tenancy.posture, tenancy.isolationActive, tenancy.degraded]).toEqual(['isolated', true, false]);
    expect(orgA).not.toBe(orgB);
    for (const [who, token] of Object.entries(tokens)) {
      const session = (await (await stack.apiAs(token, 'GET', '/auth/get-session')).json()) as any;
      expect(session.user?.isPlatformAdmin, who).not.toBe(true);
      expect(session.session?.activeOrganizationId, who).toBe(orgA);
      const got = await call(token, 'GET', `/data/sys_user_position/${positionB}`);
      expect(got.status, `${who} reads B's row — ${JSON.stringify(got.body)}`).toBe(404);
      const own = await call(token, 'GET', `/data/sys_user_position/${inScopeA}`);
      expect(own.status, `${who} reads A's row — ${JSON.stringify(own.body)}`).toBe(200);
    }
    expect((await stored(positionB))?.organization_id, 'the row lives in B').toBe(orgB);
  });

  it("PATCH and DELETE of a row the caller cannot read, and of an id naming no row, answer exactly what a GET of that id answers — the read door's not-found — and leave the row", async () => {
    const before = await stored(positionB);
    for (const [who, token] of Object.entries(tokens)) {
      for (const target of [positionB, MISSING]) {
        const readDoor = await call(token, 'GET', `/data/sys_user_position/${target}`);
        expect({ status: readDoor.status, code: codeOf(readDoor) }, `${who} GET ${target} — ${JSON.stringify(readDoor.body)}`)
          .toEqual({ status: 404, code: 'RECORD_NOT_FOUND' });
        for (const method of ['PATCH', 'DELETE'] as const) {
          expect(await write(token, method, target), `${who} ${method} ${target}: the read door's answer`).toEqual(readDoor);
        }
      }
    }
    expect(await stored(positionB), 'refused writes leave the row as it was').toEqual(before);
  });

  it('control: a row of A the delegate reads is admitted inside the scope, and keeps the guidance naming its unit outside it', async () => {
    const admitted = await write(tokens.delegate, 'PATCH', inScopeA);
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(200);
    expect((await stored(inScopeA))?.reason, 'the admitted edit landed').toBe('edited');

    const before = await stored(outOfScopeA);
    for (const method of ['PATCH', 'DELETE'] as const) {
      const out = await write(tokens.delegate, method, outOfScopeA);
      const miss = await write(tokens.delegate, method, MISSING);
      expect({ status: out.status, code: codeOf(out) }, JSON.stringify(out.body)).toEqual({ status: 403, code: 'DELEGATION_SCOPE_VIOLATION' });
      expect(JSON.stringify(out.body)).toContain(`business unit '${outsideUnitA}'`);
      expect(withoutId(out, outOfScopeA)).not.toEqual(withoutId(miss, MISSING));
    }
    expect(await stored(outOfScopeA), 'the refused writes leave the row').toEqual(before);
  });
});
