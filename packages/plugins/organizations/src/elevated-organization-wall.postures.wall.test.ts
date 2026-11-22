// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An app-authored elevation is bounded by its caller's organization wall,
 * under the `single` and `group` postures — the
 * system flow's case, whose run envelope is built by the automation engine
 * rather than spread from the request (the `isolated` matrix, every elevation
 * kind, is `elevated-organization-wall.wall.test.ts`).
 *
 * - `single`: a person outside every organization reads no tenant-scoped row
 *   at the plain door (ADR-0093 D8.1, as amended), and a system flow run for
 *   that person reads none and writes none either.
 * - `group`: a member's plain door reads the union of the organizations they
 *   hold a membership in (ADR-0105 D2), with or without an active
 *   organization, and a system flow run for that member reads exactly that
 *   union — never a third organization's rows, and never only one of the two.
 *
 * ## What is real
 *
 * `bootStack` (`@objectstack/verify`): auth (better-auth organizations), the
 * security plugin, the app plugin, the automation engine, and — for `group` —
 * THIS package's `OrganizationsPlugin`. Every flow is started through
 * `POST /api/v1/actions/...` (an action of `type: 'flow'`). Rows are seeded and
 * read back through the engine as SYSTEM.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { RESUME_AUTHORITY_SERVICE } from '@objectstack/spec/contracts';
import { OrganizationsPlugin } from './organizations-plugin.js';

const TASK = 'eop_task';
const NOTE = 'eop_note';
const PING = 'eop_ping';
const SWEEP_PING = 'eop_sweep_ping';

const APP = {
  manifest: { id: 'com.example.eop', namespace: 'eop', version: '0.0.1', type: 'app', name: 'Elevated Org Wall Postures Fixture' },
  requires: ['automation', 'triggers'],
  objects: [
    {
      name: TASK,
      label: 'Task',
      sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name' }, touched: { type: 'text', label: 'Touched' } },
    },
    {
      // Outside tenancy: a caller-less run's decided segment writes it.
      name: SWEEP_PING,
      label: 'Sweep ping',
      sharingModel: 'public_read_write',
      tenancy: { enabled: false },
      fields: { name: { type: 'text', label: 'Name' } },
    },
    {
      name: PING,
      label: 'Ping',
      sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name' } },
    },
    {
      name: NOTE,
      label: 'Note',
      sharingModel: 'public_read_write',
      tenancy: { enabled: false },
      fields: { name: { type: 'text', label: 'Name' }, seen: { type: 'text', label: 'Seen' } },
    },
  ],
  actions: [
    { name: 'eop_flow_read', label: 'Flow read', objectName: TASK, type: 'flow', target: 'eop_sys_read' },
    { name: 'eop_flow_write', label: 'Flow write', objectName: TASK, type: 'flow', target: 'eop_sys_write' },
    { name: 'eop_flow_held_read', label: 'Flow held read', objectName: TASK, type: 'flow', target: 'eop_sys_held_read' },
  ],
  flows: [
    {
      name: 'eop_sys_read',
      label: 'System read',
      type: 'screen',
      status: 'active',
      runAs: 'system',
      variables: [{ name: 'found', type: 'record_collection', isInput: false, isOutput: false }],
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'read', type: 'get_record', label: 'Read', config: { objectName: TASK, limit: 100, outputVariable: 'found' } },
        {
          id: 'report',
          type: 'create_record',
          label: 'Report',
          config: { objectName: NOTE, fields: { name: 'seen-flow', seen: { dialect: 'cel', source: 'string(size(found))' } } },
        },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'read' },
        { id: 'e2', source: 'read', target: 'report' },
        { id: 'e3', source: 'report', target: 'end' },
      ],
    },
    {
      // Begins for its caller, pauses on a signal, and is resumed naming a
      // different user as the decider.
      name: 'eop_sys_held_read',
      label: 'System held read',
      type: 'screen',
      status: 'active',
      runAs: 'system',
      variables: [{ name: 'found', type: 'record_collection', isInput: false, isOutput: false }],
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'hold', type: 'wait', label: 'Hold', waitEventConfig: { eventType: 'signal', signalName: 'eop.decided' } },
        { id: 'read', type: 'get_record', label: 'Read', config: { objectName: TASK, limit: 100, outputVariable: 'found' } },
        {
          id: 'report',
          type: 'create_record',
          label: 'Report',
          config: { objectName: NOTE, fields: { name: 'seen-held', seen: { dialect: 'cel', source: 'string(size(found))' } } },
        },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'hold' },
        { id: 'e2', source: 'hold', target: 'read' },
        { id: 'e3', source: 'read', target: 'report' },
        { id: 'e4', source: 'report', target: 'end' },
      ],
    },
    {
      // A run that begins for no caller and, after a human decision, writes a
      // record whose change starts another system run.
      name: 'eop_sys_sweep_ping',
      label: 'System sweep ping',
      type: 'autolaunched',
      status: 'active',
      runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'hold', type: 'wait', label: 'Hold', waitEventConfig: { eventType: 'signal', signalName: 'eop.decided.ping' } },
        { id: 'ping', type: 'create_record', label: 'Ping', config: { objectName: SWEEP_PING, fields: { name: 'from-decided' } } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'hold' },
        { id: 'e2', source: 'hold', target: 'ping' },
        { id: 'e3', source: 'ping', target: 'end' },
      ],
    },
    {
      name: 'eop_rc_sweep_count',
      label: 'Record-change count',
      type: 'record_change',
      status: 'active',
      runAs: 'system',
      variables: [
        { name: 'found', type: 'record_collection', isInput: false, isOutput: false },
      ],
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: SWEEP_PING, triggerType: 'record-after-create' } },
        { id: 'read', type: 'get_record', label: 'Read', config: { objectName: TASK, limit: 100, outputVariable: 'found' } },
        {
          id: 'report',
          type: 'create_record',
          label: 'Report',
          config: { objectName: NOTE, fields: { name: 'seen-sweep-rc', seen: { dialect: 'cel', source: 'string(size(found))' } } },
        },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'read' },
        { id: 'e2', source: 'read', target: 'report' },
        { id: 'e3', source: 'report', target: 'end' },
      ],
    },
    {
      // A system run a member's own write starts: a record change.
      name: 'eop_rc_read',
      label: 'Record-change read',
      type: 'record_change',
      status: 'active',
      runAs: 'system',
      variables: [{ name: 'found', type: 'record_collection', isInput: false, isOutput: false }],
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: PING, triggerType: 'record-after-create' } },
        { id: 'read', type: 'get_record', label: 'Read', config: { objectName: TASK, limit: 100, outputVariable: 'found' } },
        {
          id: 'report',
          type: 'create_record',
          label: 'Report',
          config: { objectName: NOTE, fields: { name: 'seen-rc', seen: { dialect: 'cel', source: 'string(size(found))' } } },
        },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'read' },
        { id: 'e2', source: 'read', target: 'report' },
        { id: 'e3', source: 'report', target: 'end' },
      ],
    },
    {
      name: 'eop_sys_write',
      label: 'System write',
      type: 'screen',
      status: 'active',
      runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'write', type: 'update_record', label: 'Write', config: { objectName: TASK, filter: { name: 'T1' }, multi: true, fields: { touched: 'flow' } } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'write' },
        { id: 'e2', source: 'write', target: 'end' },
      ],
    },
  ],
};

const SYS = { context: { isSystem: true } } as const;
const OUTSIDER_PASSWORD = 'Outsider-Pass-123';

/** Boot `APP` under `env`, restoring the environment it found when stopped. */
function walledBoot(env: ReadonlyArray<readonly [string, string]>, withOrganizations: boolean) {
  const restore: Array<[string, string | undefined]> = [];
  let stack!: VerifyStack;
  return {
    async start(): Promise<VerifyStack> {
      for (const [name, value] of env) {
        restore.push([name, process.env[name]]);
        process.env[name] = value;
      }
      stack = await bootStack(APP as never, {
        automation: true,
        ...(withOrganizations ? { extraPlugins: [new OrganizationsPlugin()] } : {}),
      });
      return stack;
    },
    async stop(): Promise<void> {
      await stack?.stop();
      for (const [name, value] of restore.reverse()) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    },
  };
}

async function answer(res: Response): Promise<{ status: number; body: any }> {
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

describe('single: a system flow run for a person outside every organization', () => {
  const boot = walledBoot([], false);
  let stack: VerifyStack;
  let ql: any;
  let outsider: string;

  const noteSeen = async (name: string): Promise<unknown> => {
    const [row] = await ql.find(NOTE, { where: { name }, limit: 1 }, SYS);
    return row ? (row.seen ?? '') : undefined;
  };

  beforeAll(async () => {
    stack = await boot.start();
    ql = await stack.kernel.getServiceAsync('objectql');
    await stack.signUp('eop-outsider@verify.test', OUTSIDER_PASSWORD);
    const [user] = await ql.find('sys_user', { where: { email: 'eop-outsider@verify.test' }, limit: 1 }, SYS);
    // Outside every organization: no current membership at all. Ending a
    // membership ends the sessions it backed, so the person signs in again.
    for (const m of await ql.find('sys_member', { where: { user_id: user.id } }, SYS)) {
      await ql.delete('sys_member', { where: { id: m.id }, ...SYS });
    }
    outsider = await stack.signIn('eop-outsider@verify.test', OUTSIDER_PASSWORD);
    const [org] = await ql.find('sys_organization', { where: {}, limit: 1 }, SYS);
    await ql.insert(TASK, { name: 'T1' }, { context: { isSystem: true, tenantId: org.id } });
  }, 180_000);

  afterAll(async () => {
    await boot.stop();
  });

  it('PREMISE: the posture is single and the person holds no membership', async () => {
    const tenancy: any = await stack.kernel.getServiceAsync('tenancy');
    expect(tenancy.posture).toBe('single');
    const [user] = await ql.find('sys_user', { where: { email: 'eop-outsider@verify.test' }, limit: 1 }, SYS);
    expect(await ql.find('sys_member', { where: { user_id: user.id } }, SYS)).toEqual([]);
  });

  it('the flow reads nothing of a tenant-scoped object', async () => {
    const r = await answer(await stack.apiAs(outsider, 'POST', `/actions/${TASK}/eop_flow_read`, { params: {} }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await noteSeen('seen-flow')).toBe('0');
  });

  it('the flow’s write is refused 403 naming the missing membership, and nothing is written', async () => {
    const r = await answer(await stack.apiAs(outsider, 'POST', `/actions/${TASK}/eop_flow_write`, { params: {} }));
    expect(r.status, JSON.stringify(r.body)).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r.body)).toContain('PERMISSION_DENIED');
    expect(JSON.stringify(r.body)).toContain('no current membership');
    const [t1] = await ql.find(TASK, { where: { name: 'T1' }, limit: 1 }, SYS);
    expect(t1.touched ?? null).toBeNull();
  });
});

describe('group: a system flow run for a member of two organizations reads exactly their union', () => {
  const boot = walledBoot(
    [
      ['OS_TENANCY_POSTURE', 'group'],
      ['OS_AUTH_MEMBERSHIP_POLICY', 'invite-only'],
    ],
    true,
  );
  let stack: VerifyStack;
  let ql: any;
  let alice: string;
  let orgA: string;

  const noteSeen = async (name: string): Promise<unknown> => {
    const [row] = await ql.find(NOTE, { where: { name }, limit: 1 }, SYS);
    return row ? (row.seen ?? '') : undefined;
  };
  const clearNotes = async (org: string) => {
    for (const n of await ql.find(NOTE, { where: {} }, SYS)) {
      await ql.delete(NOTE, { where: { id: n.id }, context: { isSystem: true, tenantId: org } });
    }
  };

  beforeAll(async () => {
    stack = await boot.start();
    ql = await stack.kernel.getServiceAsync('objectql');
    alice = await stack.signUp('eop-alice@verify.test');
    const bob = await stack.signUp('eop-bob@verify.test');
    const carol = await stack.signUp('eop-carol@verify.test');
    const create = async (token: string, slug: string) => {
      const r = await answer(await stack.apiAs(token, 'POST', '/auth/organization/create', { name: slug, slug }));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body.id as string;
    };
    orgA = await create(alice, 'eop-org-a');
    const orgB = await create(bob, 'eop-org-b');
    const orgC = await create(carol, 'eop-org-c');
    // alice also joins B, through the product's invitation door.
    expect((await stack.apiAs(bob, 'POST', '/auth/organization/set-active', { organizationId: orgB })).status).toBe(200);
    const invited = await answer(
      await stack.apiAs(bob, 'POST', '/auth/organization/invite-member', { email: 'eop-alice@verify.test', role: 'member', organizationId: orgB }),
    );
    expect(invited.status, JSON.stringify(invited.body)).toBe(200);
    const [aliceRow] = await ql.find('sys_user', { where: { email: 'eop-alice@verify.test' }, limit: 1 }, SYS);
    await ql.update('sys_user', { id: aliceRow.id, email_verified: true }, SYS);
    expect((await stack.apiAs(alice, 'POST', '/auth/organization/accept-invitation', { invitationId: invited.body.id })).status).toBe(200);
    for (const [org, name] of [[orgA, 'A1'], [orgB, 'B1'], [orgC, 'C1']] as const) {
      await ql.insert(TASK, { name }, { context: { isSystem: true, tenantId: org } });
    }
  }, 180_000);

  afterAll(async () => {
    await boot.stop();
  });

  it('PREMISE: the posture is group and the member holds two memberships', async () => {
    const tenancy: any = await stack.kernel.getServiceAsync('tenancy');
    expect(tenancy.posture).toBe('group');
    const [user] = await ql.find('sys_user', { where: { email: 'eop-alice@verify.test' }, limit: 1 }, SYS);
    expect((await ql.find('sys_member', { where: { user_id: user.id } }, SYS)).length).toBe(2);
  });

  for (const active of ['none', 'A'] as const) {
    it(`with active organization ${active}: the flow reads the union of the member’s organizations`, async () => {
      await clearNotes(orgA);
      expect(
        (await stack.apiAs(alice, 'POST', '/auth/organization/set-active', { organizationId: active === 'none' ? null : orgA })).status,
      ).toBe(200);
      const r = await answer(await stack.apiAs(alice, 'POST', `/actions/${TASK}/eop_flow_read`, { params: {} }));
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(await noteSeen('seen-flow')).toBe('2');
    });
  }

  it('a system run the member’s own write starts reads the union of the member’s organizations', async () => {
    await clearNotes(orgA);
    expect((await stack.apiAs(alice, 'POST', '/auth/organization/set-active', { organizationId: orgA })).status).toBe(200);
    const r = await answer(await stack.apiAs(alice, 'POST', `/data/${PING}`, { name: 'ping' }));
    expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    let seen: unknown;
    for (let i = 0; i < 50 && seen === undefined; i++) {
      seen = await noteSeen('seen-rc');
      if (seen === undefined) await new Promise((done) => setTimeout(done, 100));
    }
    expect(seen).toBe('2');
  });

  // A caller-less run decided by a member of ONE organization (carol): the run
  // its post-decision write starts begins for no caller, so it takes nothing
  // of the decider's — it reads every organization's row.
  it('a run a caller-less run’s decided segment starts by its write takes nothing of the decider', async () => {
    await clearNotes(orgA);
    const automation: any = await stack.kernel.getServiceAsync('automation');
    const [carol] = await ql.find('sys_user', { where: { email: 'eop-carol@verify.test' }, limit: 1 }, SYS);
    const paused = await automation.execute('eop_sys_sweep_ping', {});
    expect(paused.status, JSON.stringify(paused)).toBe('paused');
    const resumed = await automation.resume(paused.runId, { [RESUME_AUTHORITY_SERVICE]: true, resumedBy: carol.id });
    expect(resumed.success, JSON.stringify(resumed)).toBe(true);
    let seen: unknown;
    for (let i = 0; i < 50 && seen === undefined; i++) {
      seen = await noteSeen('seen-sweep-rc');
      if (seen === undefined) await new Promise((done) => setTimeout(done, 100));
    }
    expect(seen).toBe('3');
  });

  it('after a decision by another user, the run is still judged by the member it began for', async () => {
    await clearNotes(orgA);
    expect((await stack.apiAs(alice, 'POST', '/auth/organization/set-active', { organizationId: null })).status).toBe(200);
    const r = await answer(await stack.apiAs(alice, 'POST', `/actions/${TASK}/eop_flow_held_read`, { params: {} }));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const automation: any = await stack.kernel.getServiceAsync('automation');
    const [held] = await automation.listRuns('eop_sys_held_read', { status: 'paused' });
    expect(held, 'the run is paused on its signal').toBeDefined();
    // carol holds a membership in C alone: her wall would read one row, and
    // alice's reads her two organizations' rows.
    const [carol] = await ql.find('sys_user', { where: { email: 'eop-carol@verify.test' }, limit: 1 }, SYS);
    const resumed = await automation.resume(held.id, { [RESUME_AUTHORITY_SERVICE]: true, resumedBy: carol.id });
    expect(resumed.success, JSON.stringify(resumed)).toBe(true);
    expect(await noteSeen('seen-held')).toBe('2');
  });
});
