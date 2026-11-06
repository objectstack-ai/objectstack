// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0090 D12; ruling of record 5985885287] An organization administrator's
// assignment write to a row it cannot read, or to an id naming none, answers
// the read door's not-found, as a read does — measured at the HTTP data door
// of the showcase behind a real organization wall (`multiTenant:
// 'posture-only'`, the `isolated` posture).
//
// ── what is pinned ─────────────────────────────────────────────────────────
//
// Organization A's owner holds `organization_admin` for A (the grant its owner
// membership earns). Two assignment rows of organization B — B's owner's own
// administrator grant (`sys_user_permission_set`) and a position B holds
// (`sys_user_position`) — sit behind the wall, so A's owner reads neither.
// For each, and for an id naming no row, `DELETE` by id answers exactly what
// a `GET` of that id answers — the read door's `404 RECORD_NOT_FOUND`, status
// and body. `PATCH` is an edit in place, which the right never holds, so it is
// refused before the row is looked up: one `403` for the row and for no row.
// Both rows stay.
//
// Controls, so a green run is not "every removal is answered alike":
//
//   - the wall is real (`isolated`, active, not degraded), A's owner is no
//     platform administrator, is active in A and reads neither of B's rows;
//   - a row of A that A's owner reads — its own administrator grant, which the
//     organization boundary keeps outside by name — keeps the boundary's
//     guidance, which names the set, and is not answered as no row; it stays.
//
// The engine-level matrix (both walled postures, both administrator variants,
// the tenant-level administrator, the `single` control) is pinned in
// `packages/plugins/plugin-security/src/org-admin-assignment-boundary.posture.test.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true } as const;
const OWNER_A = 'oa-unreadable-owner-a@verify.test';
const OWNER_B = 'oa-unreadable-owner-b@verify.test';
const MISSING = 'zz_no_such_row_0001';

interface Answer { status: number; body: unknown }

/** The answer with the caller-supplied id written out, so the answers for two ids compare. */
const withoutId = (a: Answer, id: string): Answer =>
  JSON.parse(JSON.stringify(a).split(id).join('ID')) as Answer;

const codeOf = (a: Answer): unknown => (a.body as any)?.code ?? (a.body as any)?.error?.code;
const idOf = (b: any): string => String(b?.id ?? b?.record?.id ?? b?.data?.id ?? '');

describe("behind the organization wall, an organization administrator's assignment write to a row it cannot read, or to an id naming none, answers the read door's not-found", () => {
  let stack: VerifyStack;
  let ql: any;
  let ownerATok: string;
  let orgA = '';
  let orgB = '';
  let ownerA = '';
  let grantA = '';
  let grantB = '';
  let positionB = '';

  const call = async (method: string, path: string, body?: unknown): Promise<Answer> => {
    const res = await stack.api(path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerATok}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    let parsed: unknown;
    try { parsed = await res.json(); } catch { parsed = undefined; }
    return { status: res.status, body: parsed };
  };
  const write = (method: 'PATCH' | 'DELETE', object: string, id: string): Promise<Answer> =>
    call(method, `/data/${object}/${id}`, method === 'PATCH' ? { reason: 'edited' } : undefined);

  const stored = (object: string, id: string) => ql.findOne(object, { where: { id }, context: SYS });
  const userId = async (email: string): Promise<string> =>
    String((await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id ?? '');
  /** The id of the organization-administrator grant `user` holds in `organizationId`. */
  const adminGrantOf = async (user: string, organizationId: string): Promise<string> => {
    const rows = await ql.find('sys_user_permission_set', {
      where: { user_id: user, permission_set: 'organization_admin', organization_id: organizationId },
      context: SYS,
    });
    return String((Array.isArray(rows) ? rows : [])[0]?.id ?? '');
  };

  /** A new organization, created and made active by its owner. */
  const organization = async (token: string, name: string, slug: string): Promise<string> => {
    const created = await stack.apiAs(token, 'POST', '/auth/organization/create', { name, slug });
    expect(created.status, `org create ${slug}: ${await created.clone().text()}`).toBe(200);
    const id = String(((await created.json()) as { id: string }).id);
    const active = await stack.apiAs(token, 'POST', '/auth/organization/set-active', { organizationId: id });
    expect(active.status, `set-active ${slug}: ${await active.clone().text()}`).toBe(200);
    return id;
  };

  beforeAll(async () => {
    stack = await bootShowcase({ multiTenant: 'posture-only' });
    ql = await stack.kernel.getServiceAsync('objectql');

    ownerATok = await stack.signUp(OWNER_A);
    orgA = await organization(ownerATok, 'Unreadable Row A', 'oa-unreadable-a');
    const ownerBTok = await stack.signUp(OWNER_B);
    orgB = await organization(ownerBTok, 'Unreadable Row B', 'oa-unreadable-b');

    ownerA = await userId(OWNER_A);
    const ownerB = await userId(OWNER_B);
    grantA = await adminGrantOf(ownerA, orgA);
    grantB = await adminGrantOf(ownerB, orgB);
    positionB = idOf(await ql.insert('sys_user_position',
      { user_id: ownerB, position: 'showcase_contributor', organization_id: orgB },
      { context: { ...SYS, tenantId: orgB } }));
    expect(ownerA && grantA && grantB && positionB, 'every row carries an id').toBeTruthy();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it("guard the guard: a real wall; A's owner administers A, is no platform administrator, and reads neither of B's rows", async () => {
    const tenancy = await stack.kernel.getServiceAsync<{ posture: string; isolationActive: boolean; degraded: boolean }>('tenancy');
    expect([tenancy.posture, tenancy.isolationActive, tenancy.degraded]).toEqual(['isolated', true, false]);
    expect(orgA).not.toBe(orgB);
    const session = (await (await stack.apiAs(ownerATok, 'GET', '/auth/get-session')).json()) as any;
    expect(session.user?.isPlatformAdmin).not.toBe(true);
    expect(session.session?.activeOrganizationId).toBe(orgA);

    for (const [object, id, organizationId] of [
      ['sys_user_permission_set', grantB, orgB],
      ['sys_user_position', positionB, orgB],
    ]) {
      const got = await call('GET', `/data/${object}/${id}`);
      expect(got.status, `${object} of B — ${JSON.stringify(got.body)}`).toBe(404);
      expect((await stored(object, id))?.organization_id, `${object}: the row lives in B`).toBe(organizationId);
    }
    const own = await call('GET', `/data/sys_user_permission_set/${grantA}`);
    expect(own.status, `A's own grant — ${JSON.stringify(own.body)}`).toBe(200);
  });

  it("DELETE of a row it cannot read, and of an id naming no row, answers exactly what a GET of that id answers — the read door's not-found; PATCH, an edit the right never holds, gets one refusal for the row and for no row — and the row stays", async () => {
    for (const [object, id] of [['sys_user_permission_set', grantB], ['sys_user_position', positionB]]) {
      const before = await stored(object, id);
      for (const target of [id, MISSING]) {
        const readDoor = await call('GET', `/data/${object}/${target}`);
        expect({ status: readDoor.status, code: codeOf(readDoor) }, `GET ${object} ${target} — ${JSON.stringify(readDoor.body)}`)
          .toEqual({ status: 404, code: 'RECORD_NOT_FOUND' });
        expect(await write('DELETE', object, target), `DELETE ${object} ${target}: the read door's answer`).toEqual(readDoor);
      }
      const hit = await write('PATCH', object, id);
      const miss = await write('PATCH', object, MISSING);
      expect({ status: hit.status, code: codeOf(hit) }, `PATCH ${object} — ${JSON.stringify(hit.body)}`).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
      expect(withoutId(hit, id), `PATCH ${object}: the row answers as no row`).toEqual(withoutId(miss, MISSING));
      expect(await stored(object, id), `${object}: refused writes leave the row as it was`).toEqual(before);
    }
  });

  it("control: a row of A that A's owner reads keeps the boundary's guidance, and is not answered as no row", async () => {
    const before = await stored('sys_user_permission_set', grantA);
    const own = await write('DELETE', 'sys_user_permission_set', grantA);
    const miss = await write('DELETE', 'sys_user_permission_set', MISSING);
    expect({ status: own.status, code: codeOf(own) }, JSON.stringify(own.body)).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    expect(JSON.stringify(own.body)).toMatch(/'organization_admin'.*by name/);
    expect(withoutId(own, grantA)).not.toEqual(withoutId(miss, MISSING));
    expect(await stored('sys_user_permission_set', grantA), 'the refused removal leaves the row').toEqual(before);
  });
});
