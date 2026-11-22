// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An app-authored elevation sees through the organization wall exactly what
 * its caller's plain door sees (ADR-0095 D1, ADR-0123 D1/D2).
 *
 * An action body, a hook that runs as system and a flow that runs as system
 * each run `{ ...the caller's envelope, isSystem: true }`. Elevation lifts the
 * caller's business rules; it does not lift the organization wall. So for a
 * caller with no active organization, such an elevation reads nothing of a
 * tenant-scoped object and every write it makes there is refused
 * `403 PERMISSION_DENIED`, naming the missing active organization; and for a
 * caller with an active organization it keeps exactly that organization's
 * reach.
 *
 * ## What is real
 *
 * `bootStack` (`@objectstack/verify`): an `ObjectKernel` over in-process
 * SQLite, the real `AuthPlugin` (better-auth organizations), `SecurityPlugin`,
 * the real `AppPlugin` (actions, hooks and flows bound from the bundle), the
 * automation engine, and THIS package's `OrganizationsPlugin`, under
 * `OS_TENANCY_POSTURE=isolated`. Two people each found an organization through
 * the product's own door; the caller clears its active organization through
 * the product's own `set-active` door. Every action is invoked through
 * `POST /api/v1/actions/...`. Stored rows are read back through the engine as
 * SYSTEM.
 *
 * The handlers registered in code mirror the shapes `examples/app-todo` ships
 * (`exportTasksToCSV`, `deleteCompletedTasks`: a record-less read of every
 * task, a record-less delete of the completed ones) beside a param-less
 * handler handed ids.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { OrganizationsPlugin } from './organizations-plugin.js';

const WALLED_BOOT_ENV = [
  ['OS_TENANCY_POSTURE', 'isolated'],
  ['OS_AUTH_MEMBERSHIP_POLICY', 'invite-only'],
] as const;

const TASK = 'eow_task';
const NOTE = 'eow_note';

const BODY_READ =
  "const rows = await ctx.api.object('eow_task').find({});" +
  'return { seen: rows.map((r) => r.name).sort() };';
const BODY_WRITE = "await ctx.api.object('eow_task').update({ id: input.target, touched: 'body' }); return { wrote: 1 };";

/** One hook, two notes: `hook-read` records what the hook read, `hook-write` writes the row the note names. */
const HOOK_SOURCE =
  'const name = ctx.input && ctx.input.name;' +
  "if (name === 'hook-read') {" +
  "  const rows = await ctx.api.object('eow_task').find({});" +
  "  await ctx.api.object('eow_note').insert({ name: 'seen-hook', seen: rows.map((r) => r.name).sort().join(',') });" +
  '}' +
  "if (name === 'hook-write') { await ctx.api.object('eow_task').update({ id: ctx.input.target, touched: 'hook' }); }";

const APP = {
  manifest: { id: 'com.example.eow', namespace: 'eow', version: '0.0.1', type: 'app', name: 'Elevated Org Wall Fixture' },
  requires: ['automation', 'triggers'],
  objects: [
    {
      name: TASK,
      label: 'Task',
      sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name' },
        status: { type: 'text', label: 'Status' },
        touched: { type: 'text', label: 'Touched' },
      },
    },
    {
      // Outside tenancy, so the hook route and the flow's read report land
      // whatever the caller's organization.
      name: NOTE,
      label: 'Note',
      sharingModel: 'public_read_write',
      tenancy: { enabled: false },
      fields: {
        name: { type: 'text', label: 'Name' },
        target: { type: 'text', label: 'Target' },
        seen: { type: 'text', label: 'Seen' },
      },
    },
  ],
  actions: [
    { name: 'eow_export', label: 'Export', objectName: TASK, type: 'script', target: 'eowExport' },
    { name: 'eow_delete_completed', label: 'Delete completed', objectName: TASK, type: 'script', target: 'eowDeleteCompleted' },
    { name: 'eow_ids', label: 'Ids', objectName: TASK, type: 'script', target: 'eowIds' },
    { name: 'eow_note_add', label: 'Note', objectName: NOTE, type: 'script', target: 'eowNoteAdd' },
    {
      name: 'eow_body_read',
      label: 'Body read',
      objectName: TASK,
      type: 'script',
      body: { language: 'js', source: BODY_READ, capabilities: ['api.read'] },
    },
    {
      name: 'eow_body_write',
      label: 'Body write',
      objectName: TASK,
      type: 'script',
      body: { language: 'js', source: BODY_WRITE, capabilities: ['api.read', 'api.write'] },
    },
    { name: 'eow_flow_read', label: 'Flow read', objectName: TASK, type: 'flow', target: 'eow_sys_read' },
    { name: 'eow_flow_write', label: 'Flow write', objectName: TASK, type: 'flow', target: 'eow_sys_write' },
  ],
  hooks: [
    {
      name: 'eow_note_sys_hook',
      label: 'Note system hook',
      object: NOTE,
      events: ['afterInsert'],
      body: { language: 'js', source: HOOK_SOURCE, capabilities: ['api.read', 'api.write'] },
      runAs: 'system',
      onError: 'abort',
    },
  ],
  flows: [
    {
      name: 'eow_sys_read',
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
      name: 'eow_sys_write',
      label: 'System write',
      type: 'screen',
      status: 'active',
      runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
          id: 'write',
          type: 'update_record',
          label: 'Write',
          config: { objectName: TASK, filter: { name: 'B1' }, multi: true, fields: { touched: 'flow' } },
        },
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

describe('an app-authored elevation sees through the organization wall what its caller’s plain door sees', () => {
  const restoreEnv: Array<[string, string | undefined]> = [];
  let stack: VerifyStack;
  let ql: any;
  let alice: string;
  let orgA: string;
  let orgB: string;

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await stack.apiAs(alice, method, path, body);
    return { status: res.status, body: (await res.json().catch(() => undefined)) as any };
  };
  const run = (object: string, action: string, params: Record<string, unknown> = {}) =>
    call('POST', `/actions/${object}/${action}`, { params });
  const tasks = async (): Promise<Record<string, Record<string, unknown>>> => {
    const rows: any[] = await ql.find(TASK, { where: {} }, SYS);
    return Object.fromEntries(rows.map((r) => [String(r.name), r]));
  };
  const idOf = async (name: string): Promise<string> => (await tasks())[name].id as string;
  const touched = async (): Promise<Record<string, unknown>> =>
    Object.fromEntries(Object.entries(await tasks()).map(([name, r]) => [name, r.touched ?? null]));
  const noteSeen = async (name: string): Promise<unknown> => {
    const [row] = await ql.find(NOTE, { where: { name }, limit: 1 }, SYS);
    return row ? (row.seen ?? '') : undefined;
  };
  const activate = async (organizationId: string | null) => {
    expect((await call('POST', '/auth/organization/set-active', { organizationId })).status).toBe(200);
  };

  beforeAll(async () => {
    for (const [name, value] of WALLED_BOOT_ENV) {
      restoreEnv.push([name, process.env[name]]);
      process.env[name] = value;
    }
    stack = await bootStack(APP as never, { extraPlugins: [new OrganizationsPlugin()], automation: true });
    ql = await stack.kernel.getServiceAsync('objectql');
    ql.registerAction(TASK, 'eowExport', async (ctx: any) => {
      const rows = await ctx.engine.find(TASK, {});
      return { seen: rows.map((r: any) => r.name).sort() };
    });
    ql.registerAction(TASK, 'eowDeleteCompleted', async (ctx: any) => {
      const done = await ctx.engine.find(TASK, { where: { status: 'completed' } });
      const ids = done.map((r: any) => r.id);
      if (ids.length > 0) await ctx.engine.delete(TASK, ids);
      return { deleted: ids.length };
    });
    ql.registerAction(TASK, 'eowIds', async (ctx: any) => {
      const ids: string[] = ctx.params?.ids ?? [];
      for (const id of ids) await ctx.engine.update(TASK, id, { touched: 'ids' });
      return { wrote: ids.length };
    });
    ql.registerAction(NOTE, 'eowNoteAdd', async (ctx: any) => {
      await ctx.engine.insert(NOTE, { name: ctx.params?.name, target: ctx.params?.target ?? null });
      return { added: true };
    });

    alice = await stack.signUp('eow-alice@verify.test');
    const bob = await stack.signUp('eow-bob@verify.test');
    const a = await stack.apiAs(alice, 'POST', '/auth/organization/create', { name: 'Org A', slug: 'eow-org-a' });
    const b = await stack.apiAs(bob, 'POST', '/auth/organization/create', { name: 'Org B', slug: 'eow-org-b' });
    expect([a.status, b.status]).toEqual([200, 200]);
    orgA = ((await a.json()) as { id: string }).id;
    orgB = ((await b.json()) as { id: string }).id;
  }, 180_000);

  /** Every case starts from the same four rows, two per organization; one of each is completed. */
  const reseed = async () => {
    for (const r of Object.values(await tasks())) await ql.delete(TASK, { where: { id: r.id }, ...SYS });
    // A note lives outside tenancy; its recycle-bin entry still needs an organization to land in.
    for (const note of await ql.find(NOTE, { where: {} }, SYS)) {
      await ql.delete(NOTE, { where: { id: note.id }, context: { isSystem: true, tenantId: orgA } });
    }
    for (const [org, name, status] of [
      [orgA, 'A1', 'open'],
      [orgA, 'A2', 'completed'],
      [orgB, 'B1', 'open'],
      [orgB, 'B2', 'completed'],
    ] as const) {
      await ql.insert(TASK, { name, status }, { context: { isSystem: true, tenantId: org } });
    }
  };

  afterAll(async () => {
    await stack?.stop();
    for (const [name, value] of restoreEnv.reverse()) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const UNTOUCHED = { A1: null, A2: null, B1: null, B2: null };

  describe('a caller with no active organization', () => {
    beforeAll(async () => {
      await activate(null);
    });

    it('PREMISE: the wall is up and the session carries no active organization', async () => {
      const tenancy: any = await stack.kernel.getServiceAsync('tenancy');
      expect(tenancy.posture).toBe('isolated');
      const session = await call('GET', '/auth/get-session');
      expect(session.body?.session?.activeOrganizationId ?? null).toBeNull();
    });

    it('an action body handler reads nothing of a tenant-scoped object', async () => {
      await reseed();
      const r = await run(TASK, 'eow_export');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data).toEqual({ seen: [] });
    });

    it('an action body handler deletes nothing it could not read', async () => {
      await reseed();
      const r = await run(TASK, 'eow_delete_completed');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data).toEqual({ deleted: 0 });
      expect(Object.keys(await tasks()).sort()).toEqual(['A1', 'A2', 'B1', 'B2']);
    });

    it('an action body handler’s write is refused 403 PERMISSION_DENIED naming the missing active organization', async () => {
      await reseed();
      const r = await run(TASK, 'eow_ids', { ids: [await idOf('B1')] });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect(r.body.error.message).toContain('no active organization');
      expect(await touched()).toEqual(UNTOUCHED);
    });

    it('a declared action body reads nothing of a tenant-scoped object', async () => {
      await reseed();
      const r = await run(TASK, 'eow_body_read');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data).toEqual({ seen: [] });
    });

    it('a declared action body’s write is refused 403 PERMISSION_DENIED', async () => {
      await reseed();
      const r = await run(TASK, 'eow_body_write', { target: await idOf('B1') });
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error.code).toBe('PERMISSION_DENIED');
      expect(await touched()).toEqual(UNTOUCHED);
    });

    it('a system hook reads nothing of a tenant-scoped object', async () => {
      await reseed();
      const r = await run(NOTE, 'eow_note_add', { name: 'hook-read' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(await noteSeen('seen-hook')).toBe('');
    });

    it('a system hook’s write is refused, and the write it served lands nothing', async () => {
      await reseed();
      const r = await run(NOTE, 'eow_note_add', { name: 'hook-write', target: await idOf('B1') });
      expect(r.status, JSON.stringify(r.body)).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(r.body)).toContain('no active organization');
      expect(await touched()).toEqual(UNTOUCHED);
    });

    it('a system flow reads nothing of a tenant-scoped object', async () => {
      await reseed();
      const r = await run(TASK, 'eow_flow_read');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(await noteSeen('seen-flow')).toBe('0');
    });

    it('a system flow’s write is refused, and nothing is written', async () => {
      await reseed();
      const r = await run(TASK, 'eow_flow_write');
      expect(r.status, JSON.stringify(r.body)).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(r.body)).toContain('PERMISSION_DENIED');
      expect(await touched()).toEqual(UNTOUCHED);
    });
  });

  describe('control: a caller with an active organization keeps exactly that organization’s reach', () => {
    beforeAll(async () => {
      await activate(orgA);
    });

    it('an action body handler reads its organization’s rows and no other’s', async () => {
      await reseed();
      const r = await run(TASK, 'eow_export');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data).toEqual({ seen: ['A1', 'A2'] });
    });

    it('an action body handler deletes its organization’s completed rows and no other’s', async () => {
      await reseed();
      const r = await run(TASK, 'eow_delete_completed');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(Object.keys(await tasks()).sort()).toEqual(['A1', 'B1', 'B2']);
    });

    it('an action body handler writes its organization’s row', async () => {
      await reseed();
      const r = await run(TASK, 'eow_ids', { ids: [await idOf('A1')] });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(await touched()).toEqual({ ...UNTOUCHED, A1: 'ids' });
    });

    it('a declared action body, a system hook and a system flow read their organization’s rows', async () => {
      await reseed();
      expect((await run(TASK, 'eow_body_read')).body.data).toEqual({ seen: ['A1', 'A2'] });
      expect((await run(NOTE, 'eow_note_add', { name: 'hook-read' })).status).toBe(200);
      expect(await noteSeen('seen-hook')).toBe('A1,A2');
      expect((await run(TASK, 'eow_flow_read')).status).toBe(200);
      expect(await noteSeen('seen-flow')).toBe('2');
    });

    it('a declared action body and a system hook write their organization’s row', async () => {
      await reseed();
      expect((await run(TASK, 'eow_body_write', { target: await idOf('A1') })).status).toBe(200);
      expect((await run(NOTE, 'eow_note_add', { name: 'hook-write', target: await idOf('A2') })).status).toBe(200);
      expect(await touched()).toEqual({ ...UNTOUCHED, A1: 'body', A2: 'hook' });
    });
  });

  describe('control: system work that runs for no caller is unchanged', () => {
    it('a platform system context and a caller-less run read every organization’s rows', async () => {
      await reseed();
      const names = async (context: Record<string, unknown>) =>
        ((await ql.find(TASK, { where: {} }, { context })) as any[]).map((r) => r.name).sort();
      expect(await names({ isSystem: true })).toEqual(['A1', 'A2', 'B1', 'B2']);
      expect(await names({ isSystem: true, flowRunId: 'run_scheduled', actor: 'svc:flow:sweep' })).toEqual(['A1', 'A2', 'B1', 'B2']);
    });
  });
});
