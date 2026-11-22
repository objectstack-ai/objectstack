// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An app-authored elevation sees through the organization wall exactly what
 * its caller's plain door sees (ADR-0095 D1, ADR-0123 D1/D2).
 *
 * An action body and a hook that runs as system run `{ ...the caller's
 * envelope, isSystem: true }`, and a flow that runs as system runs the envelope
 * the automation engine builds for the user it runs for. Elevation lifts the
 * caller's business rules; it does not lift the organization wall. So for a
 * caller with no active organization, such an elevation reads nothing of a
 * tenant-scoped object, its delete there is answered by that read rule (a
 * predicate delete matches nothing, a by-id delete answers `404`), and every
 * other write it makes there is refused `403 PERMISSION_DENIED`, naming the
 * missing active organization; and for a caller with an active organization
 * it keeps exactly that organization's reach.
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
import { RESUME_AUTHORITY_SERVICE } from '@objectstack/spec/contracts';
import { OrganizationsPlugin } from './organizations-plugin.js';

const WALLED_BOOT_ENV = [
  ['OS_TENANCY_POSTURE', 'isolated'],
  ['OS_AUTH_MEMBERSHIP_POLICY', 'invite-only'],
] as const;

const TASK = 'eow_task';
const NOTE = 'eow_note';
const PING = 'eow_ping';

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
  "if (name === 'hook-write') { await ctx.api.object('eow_task').update({ id: ctx.input.target, touched: 'hook' }); }" +
  "if (name === 'hook-remote-read') {" +
  "  const rows = await ctx.api.object('eow_remote').find({});" +
  "  await ctx.api.object('eow_note').insert({ name: 'seen-hook-remote', seen: rows.map((r) => r.name).sort().join(',') });" +
  '}';


// ── A federated object: an in-memory remote system behind an external datasource ──
//
// The remote rows carry their own `organization_id`, which the object declares
// (ADR-0015 §10), so the wall keys on it. The engine provisions no storage and
// projects no driver scope for a federated object: Layer 0's predicate is the
// only wall it has.

const REMOTE_DS = 'eow_remote_ds';
const REMOTE = 'eow_remote';

type Row = Record<string, unknown>;
const remoteRows: Row[] = [];

/** Equality, `$eq` / `$ne` / `$in`, and `$and`; anything else refused by name. */
function matches(row: Row, where: unknown): boolean {
  if (where === undefined || where === null) return true;
  if (typeof where !== 'object' || Array.isArray(where)) throw new Error(`eow remote: a non-object where: ${JSON.stringify(where)}`);
  for (const [key, cond] of Object.entries(where as Record<string, unknown>)) {
    if (key === '$and') {
      if (!(cond as unknown[]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (key.startsWith('$')) throw new Error(`eow remote: unsupported combinator ${key}`);
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      for (const [op, value] of Object.entries(cond as Record<string, unknown>)) {
        if (op === '$eq') { if (row[key] !== value) return false; continue; }
        if (op === '$ne') { if (row[key] === value) return false; continue; }
        if (op === '$in') { if (!(value as unknown[]).includes(row[key])) return false; continue; }
        throw new Error(`eow remote: unsupported operator ${op} on ${key}`);
      }
      continue;
    }
    if (row[key] !== cond) return false;
  }
  return true;
}

const project = (row: Row, fields: unknown): Row => {
  if (!Array.isArray(fields)) return { ...row };
  const out: Row = { id: row.id };
  for (const f of fields) if (typeof f === 'string') out[f] = row[f];
  return out;
};

const remoteDriver = {
  name: REMOTE_DS,
  version: '0.0.1',
  supports: { transactionsUnsupported: true },
  async connect() {},
  async disconnect() {},
  async checkHealth() { return true; },
  async find(_object: string, query: any = {}) {
    const rows = remoteRows.filter((r) => matches(r, query.where));
    const page = typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
    return page.map((r) => project(r, query.fields));
  },
  async findOne(_object: string, query: any = {}) {
    const hit = remoteRows.find((r) => matches(r, query.where));
    return hit ? project(hit, query.fields) : null;
  },
  async count(_object: string, query: any = {}) {
    return remoteRows.filter((r) => matches(r, query.where)).length;
  },
  async update(_object: string, id: string | number, data: Row) {
    const row = remoteRows.find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, data, { id: row.id });
    return { ...row };
  },
  async syncSchema() {},
};

const remoteDriverPlugin = {
  name: 'com.example.eow.remote-driver',
  version: '1.0.0',
  init: async (ctx: any) => {
    ctx.registerService(`driver.${REMOTE_DS}`, remoteDriver);
  },
};

const REMOTE_READ =
  "const rows = await ctx.api.object('eow_remote').find({});" +
  'return { seen: rows.map((r) => r.name).sort() };';

const APP = {
  manifest: { id: 'com.example.eow', namespace: 'eow', version: '0.0.1', type: 'app', name: 'Elevated Org Wall Fixture' },
  requires: ['automation', 'triggers'],
  datasources: [
    {
      name: REMOTE_DS,
      label: 'Remote system',
      driver: REMOTE_DS,
      schemaMode: 'external',
      config: {},
      external: { allowWrites: true, validation: { onMismatch: 'fail', checkOnBoot: false } },
    },
  ],
  plugins: [remoteDriverPlugin],
  objects: [
    {
      name: REMOTE,
      label: 'Remote',
      datasource: REMOTE_DS,
      external: { remoteName: REMOTE, writable: true },
      sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name' },
        touched: { type: 'text', label: 'Touched' },
        organization_id: { type: 'text', label: 'Organization' },
      },
    },
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
      // Outside tenancy, so a decided segment's write lands whatever the
      // decider's organization.
      name: PING,
      label: 'Ping',
      sharingModel: 'public_read_write',
      tenancy: { enabled: false },
      fields: { name: { type: 'text', label: 'Name' } },
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
    { name: 'eow_remote_export', label: 'Remote export', objectName: TASK, type: 'script', target: 'eowRemoteExport' },
    { name: 'eow_remote_touch', label: 'Remote touch', objectName: TASK, type: 'script', target: 'eowRemoteTouch' },
    {
      name: 'eow_remote_body_read',
      label: 'Remote body read',
      objectName: TASK,
      type: 'script',
      body: { language: 'js', source: REMOTE_READ, capabilities: ['api.read'] },
    },
    { name: 'eow_remote_flow_read', label: 'Remote flow read', objectName: TASK, type: 'flow', target: 'eow_sys_remote_read' },
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
    { name: 'eow_remove', label: 'Remove', objectName: TASK, type: 'script', target: 'eowRemove' },
    { name: 'eow_flow_delete', label: 'Flow delete', objectName: TASK, type: 'flow', target: 'eow_sys_delete' },
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
      name: 'eow_sys_remote_read',
      label: 'System remote read',
      type: 'screen',
      status: 'active',
      runAs: 'system',
      variables: [{ name: 'found', type: 'record_collection', isInput: false, isOutput: false }],
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'read', type: 'get_record', label: 'Read', config: { objectName: REMOTE, limit: 100, outputVariable: 'found' } },
        {
          id: 'report',
          type: 'create_record',
          label: 'Report',
          config: { objectName: NOTE, fields: { name: 'seen-remote-flow', seen: { dialect: 'cel', source: 'string(size(found))' } } },
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
      // A run that begins for no caller and, after a human decision, writes a
      // record whose change starts another system run.
      name: 'eow_sys_sweep_ping',
      label: 'System sweep ping',
      type: 'autolaunched',
      status: 'active',
      runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'hold', type: 'wait', label: 'Hold', waitEventConfig: { eventType: 'signal', signalName: 'eow.decided.ping' } },
        { id: 'ping', type: 'create_record', label: 'Ping', config: { objectName: PING, fields: { name: 'from-decided' } } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'hold' },
        { id: 'e2', source: 'hold', target: 'ping' },
        { id: 'e3', source: 'ping', target: 'end' },
      ],
    },
    {
      name: 'eow_rc_ping',
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
      // A run that begins for no caller and passes a human decision: it pauses
      // on a signal, and the owning service resumes it naming the decider.
      name: 'eow_sys_sweep',
      label: 'System sweep',
      type: 'autolaunched',
      status: 'active',
      runAs: 'system',
      variables: [{ name: 'found', type: 'record_collection', isInput: false, isOutput: false }],
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'hold', type: 'wait', label: 'Hold', waitEventConfig: { eventType: 'signal', signalName: 'eow.decided' } },
        { id: 'read', type: 'get_record', label: 'Read', config: { objectName: TASK, limit: 100, outputVariable: 'found' } },
        {
          id: 'report',
          type: 'create_record',
          label: 'Report',
          config: { objectName: NOTE, fields: { name: 'seen-sweep', seen: { dialect: 'cel', source: 'string(size(found))' } } },
        },
        {
          id: 'write',
          type: 'update_record',
          label: 'Write',
          config: { objectName: TASK, filter: { name: 'B1' }, multi: true, fields: { touched: 'sweep' } },
        },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'hold' },
        { id: 'e2', source: 'hold', target: 'read' },
        { id: 'e3', source: 'read', target: 'report' },
        { id: 'e4', source: 'report', target: 'write' },
        { id: 'e5', source: 'write', target: 'end' },
      ],
    },
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
      name: 'eow_sys_delete',
      label: 'System delete',
      type: 'screen',
      status: 'active',
      runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'remove', type: 'delete_record', label: 'Remove', config: { objectName: TASK, filter: { status: 'completed' }, multi: true } },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'remove' },
        { id: 'e2', source: 'remove', target: 'end' },
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
    ql.registerAction(TASK, 'eowRemove', async (ctx: any) => {
      await ctx.engine.delete(TASK, String(ctx.params?.target));
      return { removed: 1 };
    });
    ql.registerAction(TASK, 'eowIds', async (ctx: any) => {
      const ids: string[] = ctx.params?.ids ?? [];
      for (const id of ids) await ctx.engine.update(TASK, id, { touched: 'ids' });
      return { wrote: ids.length };
    });
    ql.registerAction(TASK, 'eowRemoteExport', async (ctx: any) => {
      const rows = await ctx.engine.find(REMOTE, {});
      return { seen: rows.map((r: any) => r.name).sort() };
    });
    ql.registerAction(TASK, 'eowRemoteTouch', async (ctx: any) => {
      await ctx.engine.update(REMOTE, String(ctx.params?.target), { touched: 'remote' });
      return { wrote: 1 };
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
    remoteRows.push(
      { id: 'rem_a1', name: 'RA1', touched: null, organization_id: orgA },
      { id: 'rem_b1', name: 'RB1', touched: null, organization_id: orgB },
    );
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

    it('an action body handler’s by-id delete answers as a row that is not there, and removes nothing', async () => {
      await reseed();
      const r = await run(TASK, 'eow_remove', { target: await idOf('B2') });
      expect(r.status, JSON.stringify(r.body)).toBe(404);
      expect(r.body.error.code).toBe('RECORD_NOT_FOUND');
      expect(Object.keys(await tasks()).sort()).toEqual(['A1', 'A2', 'B1', 'B2']);
    });

    it('a system flow’s predicate delete matches nothing, and removes nothing', async () => {
      await reseed();
      const r = await run(TASK, 'eow_flow_delete');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(Object.keys(await tasks()).sort()).toEqual(['A1', 'A2', 'B1', 'B2']);
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

    it('an action body handler’s by-id delete removes its organization’s row, and another’s answers as not there', async () => {
      await reseed();
      const own = await run(TASK, 'eow_remove', { target: await idOf('A2') });
      expect(own.status, JSON.stringify(own.body)).toBe(200);
      const other = await run(TASK, 'eow_remove', { target: await idOf('B2') });
      expect(other.status, JSON.stringify(other.body)).toBe(404);
      expect(Object.keys(await tasks()).sort()).toEqual(['A1', 'B1', 'B2']);
    });

    it('a system flow’s predicate delete removes its organization’s rows and no other’s', async () => {
      await reseed();
      const r = await run(TASK, 'eow_flow_delete');
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

  describe('a caller with an active organization, on a federated object the engine projects no scope for', () => {
    beforeAll(async () => {
      await activate(orgA);
    });
    const resetRemote = () => {
      for (const r of remoteRows) r.touched = null;
    };

    it('an action body handler reads its organization’s remote rows and no other’s', async () => {
      const r = await run(TASK, 'eow_remote_export');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data).toEqual({ seen: ['RA1'] });
    });

    it('a declared action body reads its organization’s remote rows and no other’s', async () => {
      const r = await run(TASK, 'eow_remote_body_read');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.data).toEqual({ seen: ['RA1'] });
    });

    it('a system hook reads its organization’s remote rows and no other’s', async () => {
      await reseed();
      const r = await run(NOTE, 'eow_note_add', { name: 'hook-remote-read' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(await noteSeen('seen-hook-remote')).toBe('RA1');
    });

    it('a system flow reads its organization’s remote rows and no other’s', async () => {
      await reseed();
      const r = await run(TASK, 'eow_remote_flow_read');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(await noteSeen('seen-remote-flow')).toBe('1');
    });

    it('an action body handler’s by-id write of another organization’s remote row answers as a row that is not there', async () => {
      resetRemote();
      const r = await run(TASK, 'eow_remote_touch', { target: 'rem_b1' });
      expect(r.status, JSON.stringify(r.body)).toBe(404);
      expect(r.body.error.code).toBe('RECORD_NOT_FOUND');
      expect(remoteRows.find((x) => x.id === 'rem_b1')?.touched).toBeNull();
    });

    it('control: its by-id write of its own organization’s remote row lands', async () => {
      resetRemote();
      const r = await run(TASK, 'eow_remote_touch', { target: 'rem_a1' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(remoteRows.find((x) => x.id === 'rem_a1')?.touched).toBe('remote');
    });
  });

  describe('control: system work that runs for no caller is unchanged', () => {
    it('a system run that began for no caller stays unjudged after a human decision', async () => {
      await reseed();
      await activate(null);
      const automation: any = await stack.kernel.getServiceAsync('automation');
      const decider = await ql.findOne('sys_user', { where: { email: 'eow-alice@verify.test' }, ...SYS });
      const paused = await automation.execute('eow_sys_sweep', {});
      expect(paused.status, JSON.stringify(paused)).toBe('paused');
      const resumed = await automation.resume(paused.runId, { [RESUME_AUTHORITY_SERVICE]: true, resumedBy: decider.id });
      expect(resumed.success, JSON.stringify(resumed)).toBe(true);
      expect(await noteSeen('seen-sweep')).toBe('4');
      expect((await touched()).B1).toBe('sweep');
    });

    it('a run a caller-less run’s decided segment starts by its write begins for no caller, and is unjudged', async () => {
      await reseed();
      await activate(null);
      const automation: any = await stack.kernel.getServiceAsync('automation');
      const decider = await ql.findOne('sys_user', { where: { email: 'eow-alice@verify.test' }, ...SYS });
      const paused = await automation.execute('eow_sys_sweep_ping', {});
      expect(paused.status, JSON.stringify(paused)).toBe('paused');
      const resumed = await automation.resume(paused.runId, { [RESUME_AUTHORITY_SERVICE]: true, resumedBy: decider.id });
      expect(resumed.success, JSON.stringify(resumed)).toBe(true);
      let seen: unknown;
      for (let i = 0; i < 50 && seen === undefined; i++) {
        seen = await noteSeen('seen-rc');
        if (seen === undefined) await new Promise((done) => setTimeout(done, 100));
      }
      expect(seen).toBe('4');
    });

    it('a platform system context and a caller-less run read every organization’s rows', async () => {
      await reseed();
      const names = async (context: Record<string, unknown>) =>
        ((await ql.find(TASK, { where: {} }, { context })) as any[]).map((r) => r.name).sort();
      expect(await names({ isSystem: true })).toEqual(['A1', 'A2', 'B1', 'B2']);
      expect(await names({ isSystem: true, flowRunId: 'run_scheduled', actor: 'svc:flow:sweep' })).toEqual(['A1', 'A2', 'B1', 'B2']);
    });
  });
});
