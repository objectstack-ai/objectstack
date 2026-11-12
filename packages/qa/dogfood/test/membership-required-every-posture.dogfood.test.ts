// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0093 D8.1, as amended 2026-11-11] Under every tenancy posture, a
 * person's data access requires a current membership in the organization,
 * judged on each request.
 *
 * Measured over the real HTTP doors of a booted showcase stack, once per
 * posture — `single` (the default boot), and the walled `isolated` and `group`
 * postures (`multiTenant: 'posture-only'`, `OS_TENANCY_POSTURE=group` for the
 * union posture) — with the same people and the same steps in each:
 *
 *   1. two people are current members of one organization; each signs in,
 *      writes a note through the data door, reads it back, and mints an API
 *      key — the rule's CONTROL leg, so every refusal below is measured
 *      against the same person, door and object succeeding;
 *   2. one of them is removed from the organization through better-auth's own
 *      `remove-member` endpoint;
 *   3. that person's session has ended, and after a FRESH sign-in their reads
 *      of the organization's data resolve to nothing, their writes are refused
 *      `403 PERMISSION_DENIED` and nothing lands, and the key they minted is
 *      refused; a flow they launch that runs as them reads none of the
 *      organization's data and writes nothing; the other person — still a
 *      member — is served throughout, by the same doors and the same flows.
 *
 * The posture is read off the `tenancy` service, not assumed: a degraded boot
 * resolves to `single`, and a matrix whose walled legs were really `single`
 * would answer the same for the wrong reason.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYS = { isSystem: true };
const NOTE = 'showcase_private_note';
const PASSWORD = 'Member!Pass123';

type Posture = 'single' | 'isolated' | 'group';

const rowsOf = (r: any): any[] =>
  Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.data?.records) ? r.data.records : [];

async function findRows(ql: any, object: string, where: Record<string, unknown>, limit = 50): Promise<any[]> {
  return rowsOf(await ql.find(object, { where, limit }, { context: SYS }));
}

/** The membership row a sign-up's reconciler lands, asynchronously, under `single`. */
async function waitForMembership(ql: any, userId: string, organizationId: string): Promise<any> {
  for (let i = 0; i < 60; i++) {
    const [row] = await findRows(ql, 'sys_member', { user_id: userId, organization_id: organizationId }, 1);
    if (row) return row;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no membership in ${organizationId} appeared for ${userId}`);
}

const errorCodeOf = (body: any): unknown => body?.error?.code ?? body?.code;

interface Person { email: string; userId: string; memberId: string; token: string; key: string; noteId: string }

describe.each(['single', 'isolated', 'group'] as const)(
  'a person\'s data access requires a current membership in the organization — posture `%s`',
  (posture: Posture) => {
    let stack: VerifyStack;
    let ql: any;
    let adminToken: string;
    let orgId: string;
    let stays: Person;
    let leaves: Person;
    let previousPosture: string | undefined;

    beforeAll(async () => {
      previousPosture = process.env.OS_TENANCY_POSTURE;
      if (posture === 'group') process.env.OS_TENANCY_POSTURE = 'group';
      stack = posture === 'single' ? await bootShowcase() : await bootShowcase({ multiTenant: 'posture-only' });
      ql = await stack.kernel.getServiceAsync<any>('objectql');
      adminToken = await stack.signIn();
      const [adminUser] = await findRows(ql, 'sys_user', { email: 'admin@objectos.ai' }, 1);
      const adminId = String(adminUser.id);

      if (posture === 'single') {
        // [ADR-0131 D3] The Default Organization is a boot invariant under
        // `single`, and its owner is the platform admin.
        const [org] = await findRows(ql, 'sys_organization', { slug: 'default' }, 1);
        orgId = String(org.id);
        await waitForMembership(ql, adminId, orgId);
      } else {
        // Under a walled posture the framework binds no one (ADR-0093 D3): the
        // organization and its members are made here, the honest way.
        const org = await ql.insert('sys_organization', { name: `Membership ${posture}`, slug: `membership-${posture}` }, { context: SYS });
        orgId = String(org.id);
        await ql.insert('sys_member', { user_id: adminId, organization_id: orgId, role: 'owner' }, { context: SYS });
      }

      const person = async (tag: string): Promise<Person> => {
        const email = `membership.${posture}.${tag}@example.com`;
        await stack.signUp(email, PASSWORD, `Membership ${tag}`);
        const [u] = await findRows(ql, 'sys_user', { email }, 1);
        const userId = String(u.id);
        if (posture !== 'single') await ql.insert('sys_member', { user_id: userId, organization_id: orgId, role: 'member' }, { context: SYS });
        const member = await waitForMembership(ql, userId, orgId);
        // A fresh session, opened while the membership exists: its active
        // organization is resolved from that membership (ADR-0093 D9).
        const token = await stack.signIn(email, PASSWORD);
        const created = await stack.apiAs(token, 'POST', `/data/${NOTE}`, { title: `${tag} note, written as a member` });
        expect(created.status, `${tag}: a member's write — ${await created.clone().text()}`).toBe(201);
        const createdBody: any = await created.json();
        const noteId = String(createdBody?.data?.id ?? createdBody?.id ?? createdBody?.record?.id);
        const minted = await stack.apiAs(token, 'POST', '/keys', { name: `membership ${posture} ${tag}` });
        expect(minted.status, `${tag}: key mint — ${await minted.clone().text()}`).toBeLessThan(300);
        const mintedBody: any = await minted.json();
        const key = String(mintedBody?.data?.key ?? mintedBody?.key ?? '');
        expect(key, `${tag}: the minted key`).not.toBe('');
        return { email, userId, memberId: String(member.id), token, key, noteId };
      };
      stays = await person('stays');
      leaves = await person('leaves');
    }, 300_000);

    afterAll(async () => {
      await stack?.stop?.();
      if (previousPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
      else process.env.OS_TENANCY_POSTURE = previousPosture;
    });

    const readNotes = async (token: string) => {
      const res = await stack.apiAs(token, 'GET', `/data/${NOTE}?limit=50`);
      return { status: res.status, ids: rowsOf(await res.json().catch(() => null)).map((r: any) => String(r.id)) };
    };
    const readNotesByKey = async (key: string) =>
      (await stack.api(`/data/${NOTE}?limit=50`, { headers: { 'x-api-key': key } })).status;

    it('PRECONDITION: the posture in force is the one this leg names, not degraded', async () => {
      const tenancy = await stack.kernel.getServiceAsync<{ posture: string; degraded: boolean }>('tenancy');
      expect(tenancy?.posture).toBe(posture);
      expect(tenancy?.degraded).toBe(false);
    });

    it('CONTROL: while both are members, each reads its own note and its key is admitted', async () => {
      for (const p of [stays, leaves]) {
        const read = await readNotes(p.token);
        expect(read.status).toBe(200);
        expect(read.ids).toContain(p.noteId);
        expect(await readNotesByKey(p.key)).toBe(200);
      }
    });

    it('the person removed from the organization reads and writes none of its data — session ended, and after a fresh sign-in', async () => {
      const removed = await stack.apiAs(adminToken, 'POST', '/auth/organization/remove-member', {
        memberIdOrEmail: leaves.memberId,
        organizationId: orgId,
      });
      expect(removed.status, await removed.clone().text()).toBe(200);
      expect(await findRows(ql, 'sys_member', { user_id: leaves.userId, organization_id: orgId }, 1)).toHaveLength(0);

      // The session that was open at the removal has ended.
      expect((await stack.apiAs(leaves.token, 'GET', `/data/${NOTE}?limit=50`)).status).toBe(401);

      // A fresh sign-in authenticates — and reaches none of the organization's data.
      const fresh = await stack.signIn(leaves.email, PASSWORD);
      const read = await readNotes(fresh);
      expect(read.status).toBe(200);
      expect(read.ids).toEqual([]);
      expect((await stack.apiAs(fresh, 'GET', `/data/${NOTE}/${leaves.noteId}`)).status).toBe(404);

      const write = await stack.apiAs(fresh, 'POST', `/data/${NOTE}`, { title: 'written after the membership ended' });
      expect(write.status).toBe(403);
      expect(errorCodeOf(await write.json())).toBe('PERMISSION_DENIED');
      expect(await findRows(ql, NOTE, { title: 'written after the membership ended' }, 5)).toEqual([]);
    });

    it('a flow run as the user is judged by the same rule: launched by the removed person it reads none of the organization\'s data and writes nothing; launched by the member it reads its note and its write lands', async () => {
      const automation = await stack.kernel.getServiceAsync<any>('automation');
      const reader = `membership_${posture}_reader`;
      const writer = (who: string) => `membership_${posture}_writer_${who}`;
      const flowOf = (name: string, node: Record<string, unknown>, variables: unknown[] = []) => ({
        name, label: name, type: 'autolaunched', status: 'active', runAs: 'user', variables,
        nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'step', label: 'Step', ...node }, { id: 'end', type: 'end', label: 'End' }],
        edges: [{ id: 'e1', source: 'start', target: 'step' }, { id: 'e2', source: 'step', target: 'end' }],
      });
      automation.registerFlow(reader, flowOf(reader,
        { type: 'get_record', config: { objectName: NOTE, fields: ['id', 'title'], limit: 50, outputVariable: 'notes' } },
        [{ name: 'notes', type: 'object', isOutput: true }]));
      for (const who of ['leaves', 'stays']) {
        automation.registerFlow(writer(who), flowOf(writer(who),
          { type: 'create_record', config: { objectName: NOTE, fields: { title: `${writer(who)} wrote this` } } }));
      }
      const launch = (token: string, flow: string) => stack.apiAs(token, 'POST', `/automation/${flow}/trigger`, {});
      const notesOf = async (res: Response) => {
        const body: any = await res.json();
        return rowsOf(body?.data?.output?.notes ?? []).map((r: any) => String(r.id));
      };

      const fresh = await stack.signIn(leaves.email, PASSWORD);
      const read = await launch(fresh, reader);
      expect(read.status, await read.clone().text()).toBeLessThan(300);
      expect(await notesOf(read)).toEqual([]);
      const write = await launch(fresh, writer('leaves'));
      // The run fails, and the refusal inside it is the data door's own answer.
      const writeText = await write.clone().text();
      expect(write.status, writeText).toBe(400);
      const writeBody: any = await write.json();
      expect(errorCodeOf(writeBody), writeText).toBe('FLOW_FAILED');
      expect(writeBody?.error?.details?.innerRefusal?.code, writeText).toBe('PERMISSION_DENIED');
      expect(await findRows(ql, NOTE, { title: `${writer('leaves')} wrote this` }, 5)).toEqual([]);

      // CONTROL — the same flows, launched by the person who is still a member.
      const memberRead = await launch(stays.token, reader);
      expect(memberRead.status, await memberRead.clone().text()).toBeLessThan(300);
      expect(await notesOf(memberRead)).toContain(stays.noteId);
      const memberWrite = await launch(stays.token, writer('stays'));
      expect(memberWrite.status, await memberWrite.clone().text()).toBeLessThan(300);
      expect(await findRows(ql, NOTE, { title: `${writer('stays')} wrote this` }, 5)).toHaveLength(1);
    });

    it('an API key follows its owner\'s membership: the removed person\'s key is refused, the member\'s is admitted', async () => {
      expect(await readNotesByKey(leaves.key)).toBe(401);
      expect(await readNotesByKey(stays.key)).toBe(200);
    });

    it('CONTROL: the person who is still a member is served — reads its note, and its write lands', async () => {
      const read = await readNotes(stays.token);
      expect(read.status).toBe(200);
      expect(read.ids).toContain(stays.noteId);
      const write = await stack.apiAs(stays.token, 'POST', `/data/${NOTE}`, { title: 'written by a current member' });
      expect(write.status, await write.clone().text()).toBe(201);
      expect(await findRows(ql, NOTE, { title: 'written by a current member' }, 5)).toHaveLength(1);
    });
  },
);
