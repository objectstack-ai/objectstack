// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Spike: a virtual object on a plugin driver, end to end in a booted kernel
 * (ADR-0015 Tier A — a plugin driver, zero protocol change).
 *
 * A plugin publishes an in-memory custom driver as the `driver.spike_tree`
 * service. The stack declares a `spike_tree` datasource (`schemaMode:
 * 'external'`, writes opted in, `external.validation.checkOnBoot: false`) and
 * an external object `spike_node` bound to it, carrying a self-referencing
 * `parent`, a `plan_locked` flag, a formula `locked` over `current_user`, a
 * gantt list view and a `beforeUpdate` hook. Every request goes through the
 * HTTP app as a signed-in caller, and the driver records each call it receives,
 * so what is asserted is what a remote system behind a plugin driver would see.
 *
 * One `describe` per step of the spike, (a) to (g) less (f): the gantt step is
 * a renderer question and lives in `ui/packages/plugin-gantt`
 * (`ObjectGantt.pluginDriverTree.test.tsx`).
 *
 * Composition: the plugin set `@objectstack/verify`'s `bootStack` uses (engine,
 * sqlite-wasm default datasource for the platform's own objects, HTTP server,
 * the app, platform objects, auth, security, sharing, REST, dispatcher), as
 * `sharing-rule-declared-name.data-door.pin.test.ts` assembles it, plus the
 * federation trio `objectstack serve` mounts for a stack that declares
 * datasources: `DatasourceAdminServicePlugin` (the `datasource-connection`
 * service AppPlugin auto-connects through), `ExternalDatasourceServicePlugin`
 * and the external-validation plugin. The boot is paid in `beforeAll`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { defineStack, defineView } from '@objectstack/spec';
import type { DriverQuery, IDataDriver } from '@objectstack/spec/contracts';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/rest';
import { AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import {
  DatasourceAdminServicePlugin,
  ExternalDatasourceServicePlugin,
  createDefaultDatasourceDriverFactory,
} from '@objectstack/service-datasource';
import { AppPlugin } from './app-plugin.js';
import { DefaultDatasourcePlugin } from './default-datasource-plugin.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';
import { createExternalValidationPlugin } from './external-validation-plugin.js';

const BOOT_TIMEOUT = 180_000;
const ORIGIN = 'http://localhost:3000';
const API = '/api/v1';
const ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };
const PLANNER_EMAIL = 'planner@spike-tree.test';
const OUTSIDER_EMAIL = 'outsider@spike-tree.test';
const MEMBER_PASSWORD = 'Member-Pass-123';

const DATASOURCE = 'spike_tree';
const OBJECT = 'spike_node';
/** A second external object on the same driver, left on the platform's default sharing model. */
const OWNED = 'spike_owned';
const PLANNER_SET = 'spike_planner';

// ---------------------------------------------------------------------------
// The plugin driver — an in-memory stand-in for a remote system
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Call = { method: string; object?: string; id?: unknown; query?: unknown; data?: unknown };

/**
 * The driver's WHERE matcher: equality, `$eq` / `$ne` / `$in`, and `$and`
 * ANDed with its siblings. Anything else is REFUSED by name rather than read as
 * a field (`check:where-matcher`) — a refusal here is a spike finding (the
 * engine handed the remote system an operator it cannot run), never a silent
 * empty answer.
 */
function matches(row: Row, where: unknown): boolean {
  if (where === undefined || where === null) return true;
  if (typeof where !== 'object' || Array.isArray(where)) {
    throw new Error(`spike_tree driver: a non-object where reached the driver: ${JSON.stringify(where)}`);
  }
  for (const [key, cond] of Object.entries(where as Record<string, unknown>)) {
    if (key === '$and') {
      if (!(cond as unknown[]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (key.startsWith('$')) throw new Error(`spike_tree driver: unsupported combinator ${key}`);
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      for (const [op, value] of Object.entries(cond as Record<string, unknown>)) {
        if (op === '$eq') { if (row[key] !== value) return false; continue; }
        if (op === '$ne') { if (row[key] === value) return false; continue; }
        if (op === '$in') { if (!(value as unknown[]).includes(row[key])) return false; continue; }
        throw new Error(`spike_tree driver: unsupported operator ${op} on ${key}`);
      }
      continue;
    }
    if (row[key] !== cond) return false;
  }
  return true;
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  if (orderBy === undefined) return rows;
  const nodes = orderBy as Array<{ field: string; order?: 'asc' | 'desc' }>;
  return [...rows].sort((a, b) => {
    for (const { field, order } of nodes) {
      const x = a[field] as any;
      const y = b[field] as any;
      if (x === y) continue;
      const cmp = x === undefined || x === null ? -1 : y === undefined || y === null ? 1 : x < y ? -1 : 1;
      return order === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

function project(row: Row, fields: unknown): Row {
  if (!Array.isArray(fields)) return { ...row };
  const out: Row = { id: row.id };
  for (const f of fields) if (typeof f === 'string') out[f] = row[f];
  return out;
}

/** JSON-clone what arrived, so a later mutation by the engine cannot rewrite the record. */
const snapshot = (value: unknown): unknown => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

const refuse = (what: string) => async (): Promise<never> => {
  throw new Error(`spike_tree driver: ${what} is not part of the spike`);
};

/**
 * The remote system's rows live in `tables`, by object; every call is appended
 * to `calls`. `supports.transactionsUnsupported` — a REST-backed transport has
 * no transactions, and the engine reads the bit before it reaches for one.
 */
function createSpikeTreeDriver(tables: Record<string, Row[]>, calls: Call[]) {
  const rowsOf = (object: string): Row[] => tables[object] ?? [];
  const driver = {
    name: DATASOURCE,
    version: '0.0.1',
    supports: { transactionsUnsupported: true },
    async connect() { calls.push({ method: 'connect' }); },
    async disconnect() {},
    async checkHealth() { return true; },
    execute: refuse('execute'),
    async find(object: string, query: DriverQuery = {}) {
      calls.push({ method: 'find', object, query: snapshot(query) });
      const matched = rowsOf(object).filter((r) => matches(r, query.where));
      const sorted = sortRows(matched, query.orderBy);
      const from = typeof query.offset === 'number' ? query.offset : 0;
      const page = typeof query.limit === 'number' ? sorted.slice(from, from + query.limit) : sorted.slice(from);
      return page.map((r) => project(r, query.fields));
    },
    async findOne(object: string, query: DriverQuery = {}) {
      calls.push({ method: 'findOne', object, query: snapshot(query) });
      const hit = rowsOf(object).find((r) => matches(r, query.where));
      return hit ? project(hit, query.fields) : null;
    },
    async count(object: string, query: DriverQuery = {}) {
      calls.push({ method: 'count', object, query: snapshot(query) });
      return rowsOf(object).filter((r) => matches(r, query.where)).length;
    },
    async update(object: string, id: string | number, data: Row) {
      calls.push({ method: 'update', object, id, data: snapshot(data) });
      const row = rowsOf(object).find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, data, { id: row.id });
      return { ...row };
    },
    create: refuse('create'),
    upsert: refuse('upsert'),
    delete: refuse('delete'),
    bulkCreate: refuse('bulkCreate'),
    bulkUpdate: refuse('bulkUpdate'),
    bulkDelete: refuse('bulkDelete'),
    beginTransaction: refuse('beginTransaction'),
    commit: refuse('commit'),
    rollback: refuse('rollback'),
    async syncSchema(object: string) { calls.push({ method: 'syncSchema', object }); },
    dropTable: refuse('dropTable'),
  };
  return driver as typeof driver & IDataDriver;
}

/** The plugin that publishes the driver — the whole of a Tier A integration's server half. */
function spikeTreeDriverPlugin(driver: IDataDriver): Plugin {
  return {
    name: 'com.spike.driver-spike-tree',
    version: '1.0.0',
    init: async (ctx: PluginContext) => {
      ctx.registerService(`driver.${driver.name}`, driver);
    },
  };
}

// ---------------------------------------------------------------------------
// The stack
// ---------------------------------------------------------------------------

/** The plan view the customer's console opens: a gantt over the tree, archived rows filtered out. */
const SPIKE_VIEWS = defineView({
  list: {
    label: 'All nodes',
    type: 'grid',
    data: { provider: 'object', object: OBJECT },
    columns: ['name', 'start_date', 'end_date'],
  },
  listViews: {
    plan: {
      label: 'Plan',
      type: 'gantt',
      data: { provider: 'object', object: OBJECT },
      columns: ['name'],
      filter: [{ field: 'archived', operator: 'equals', value: false }],
      sort: [{ field: 'start_date', order: 'asc' }],
      gantt: {
        startDateField: 'start_date',
        endDateField: 'end_date',
        titleField: 'name',
        parentField: 'parent',
        lockField: 'locked',
        dependenciesField: 'depends_on',
      },
    },
  },
});

const js = (source: string) => ({ language: 'js' as const, source, capabilities: [], timeoutMs: 5000 });

const STACK = defineStack({
  manifest: { id: 'com.spike.plugin-driver', name: 'Plugin driver spike', version: '1.0.0', type: 'app' },
  datasources: [
    {
      name: DATASOURCE,
      label: 'Spike tree (plugin driver)',
      driver: DATASOURCE,
      schemaMode: 'external',
      config: {},
      external: {
        allowWrites: true,
        // `fail` on purpose: the driver has no `introspectSchema`, so the boot
        // validation could only ever fail — and with `checkOnBoot: false` it is
        // not run at all, so the boot must still come up.
        validation: { onMismatch: 'fail', checkOnBoot: false },
      },
    },
  ],
  objects: [
    {
      name: OBJECT,
      label: 'Spike node',
      datasource: DATASOURCE,
      external: { remoteName: 'nodes', writable: true },
      // The remote rows carry no `owner_id` / `created_by`, so who may edit a
      // node is the hook's question (the customer's "only the planner may
      // reschedule"), not an ownership column's — see (e3) for the default.
      sharingModel: 'public_read_write',
      fields: {
        name: { type: 'text', label: 'Name' },
        parent: { type: 'lookup', reference: OBJECT, label: 'Parent' },
        start_date: { type: 'date', label: 'Start' },
        end_date: { type: 'date', label: 'End' },
        depends_on: { type: 'text', label: 'Depends on' },
        planner: { type: 'text', label: 'Planner' },
        plan_locked: { type: 'boolean', label: 'Plan locked' },
        archived: { type: 'boolean', label: 'Archived' },
        guard_note: { type: 'text', label: 'Guard note' },
        // Locked for everyone once the plan is locked, and for anyone who is
        // not the node's planner — so it differs per caller.
        locked: {
          type: 'formula',
          label: 'Locked',
          returnType: 'boolean',
          expression: 'record.plan_locked || record.planner != current_user.id',
        },
      },
    },
    {
      name: OWNED,
      label: 'Spike owned',
      datasource: DATASOURCE,
      external: { remoteName: 'owned', writable: true },
      fields: { name: { type: 'text', label: 'Name' } },
    },
  ],
  views: [SPIKE_VIEWS],
  hooks: [
    {
      name: 'spike_node_plan_guard',
      object: OBJECT,
      events: ['beforeUpdate'],
      refusals: {
        PLAN_LOCKED: { message: 'This plan is locked; unlock it before rescheduling.', status: 409 },
      },
      body: js(
        "if (ctx.previous && ctx.previous.plan_locked === true) throw Object.assign(new Error(), { code: 'PLAN_LOCKED' });\n"
          + "ctx.input.guard_note = 'checked';\n",
      ),
    },
  ],
  permissions: [
    {
      name: PLANNER_SET,
      label: 'Spike planner',
      objects: { [OBJECT]: { allowRead: true, allowEdit: true }, [OWNED]: { allowRead: true, allowEdit: true } },
    },
  ],
});

// ---------------------------------------------------------------------------
// Boot and HTTP helpers
// ---------------------------------------------------------------------------

const rows: Row[] = [];
const owned: Row[] = [];
const calls: Call[] = [];
const driver = createSpikeTreeDriver({ [OBJECT]: rows, [OWNED]: owned }, calls);

let kernel: any;
let httpServer: any;
let app: any;
let engine: any;
let adminToken: string;
let adminId: string;
let plannerToken: string;
let plannerId: string;
let outsiderToken: string;
let bootCalls: Call[] = [];
let prevNodeEnv: string | undefined;

const req = (path: string, init?: RequestInit) => app.request(`${ORIGIN}${API}${path}`, init);
const as = (token: string, method: string, path: string, payload?: unknown) =>
  req(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function signIn(email: string, password: string): Promise<string> {
  const res = await req('/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`spike signIn failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as any).token;
}

/**
 * A second human under the default `invite_only` audience posture enters
 * through a pending invitation, as `@objectstack/verify`'s `signUp` does.
 */
async function signUp(email: string): Promise<string> {
  await engine.insert(
    'sys_invitation',
    {
      id: `inv_spike_${email.split('@')[0]}`,
      email,
      status: 'pending',
      organization_id: 'org_spike_audience_gate',
      role: 'member',
      inviter_id: 'usr_spike_audience_gate',
      expires_at: new Date(Date.now() + 3_600_000),
    },
    { context: { isSystem: true } },
  );
  const res = await req('/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: MEMBER_PASSWORD, name: email.split('@')[0] }),
  });
  if (!res.ok) throw new Error(`spike signUp failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as any).token;
}

async function userIdOf(email: string): Promise<string> {
  const users = await engine.find('sys_user', { where: { email }, limit: 1, context: { isSystem: true } });
  const id = users?.[0]?.id;
  if (typeof id !== 'string') throw new Error(`spike: no sys_user row for ${email}`);
  return id;
}

/** The remote system's data, written straight into it — no platform door is involved. */
function seedRemoteRows(): void {
  rows.length = 0;
  rows.push(
    { id: 'n_root', name: 'Line A', parent: null, start_date: '2026-11-02', end_date: '2026-11-20', depends_on: null, planner: plannerId, plan_locked: false, archived: false, guard_note: null },
    { id: 'n_cut', name: 'Cut', parent: 'n_root', start_date: '2026-11-02', end_date: '2026-11-06', depends_on: null, planner: plannerId, plan_locked: false, archived: false, guard_note: null },
    { id: 'n_weld', name: 'Weld', parent: 'n_root', start_date: '2026-11-09', end_date: '2026-11-13', depends_on: 'n_cut', planner: plannerId, plan_locked: true, archived: false, guard_note: null },
    { id: 'n_old', name: 'Old run', parent: null, start_date: '2026-10-01', end_date: '2026-10-05', depends_on: null, planner: plannerId, plan_locked: false, archived: true, guard_note: null },
  );
  owned.length = 0;
  owned.push({ id: 'o_1', name: 'Remote row' });
}

const callsSince = (mark: number, method?: string, object: string = OBJECT) =>
  calls.slice(mark).filter((c) => (method ? c.method === method : true) && (c.object === undefined || c.object === object));

beforeAll(async () => {
  prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development'; // the dev-admin seed, as `objectstack dev` / bootStack arm it

  kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
  await kernel.use(new HonoServerPlugin({ port: 0 }));
  await kernel.use(spikeTreeDriverPlugin(driver));
  await kernel.use(new AppPlugin(STACK));
  await kernel.use(new PlatformObjectsPlugin());
  await kernel.use(new AuthPlugin({ secret: 'plugin-driver-external-object-spike-secret' }));
  await kernel.use(new DatasourceAdminServicePlugin({ driverFactory: createDefaultDatasourceDriverFactory() }));
  await kernel.use(new ExternalDatasourceServicePlugin());
  await kernel.use(createExternalValidationPlugin());
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(STACK)));
  await kernel.use(new SharingServicePlugin());
  await kernel.use(createRestApiPlugin({}));
  await kernel.use(createDispatcherPlugin({}));
  await kernel.bootstrap();
  bootCalls = [...calls];

  httpServer = await kernel.getServiceAsync('http-server');
  app = httpServer.getRawApp();
  engine = await kernel.getServiceAsync('objectql');

  adminToken = await signIn(ADMIN.email, ADMIN.password);
  adminId = await userIdOf(ADMIN.email);
  await signUp(PLANNER_EMAIL);
  plannerId = await userIdOf(PLANNER_EMAIL);
  await engine.insert(
    'sys_user_permission_set',
    { id: 'ups_spike_planner', user_id: plannerId, permission_set: PLANNER_SET, granted_by: null },
    { context: { isSystem: true } },
  );
  plannerToken = await signIn(PLANNER_EMAIL, MEMBER_PASSWORD);
  await signUp(OUTSIDER_EMAIL);
  outsiderToken = await signIn(OUTSIDER_EMAIL, MEMBER_PASSWORD);

  seedRemoteRows();
}, BOOT_TIMEOUT);

afterAll(async () => {
  try { await httpServer?.close?.(); } catch { /* best-effort */ }
  try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
}, 60_000);

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------

describe('(a) defineStack accepts a datasource whose driver is a plugin-published `driver.<name>` service', () => {
  it('the datasource names the driver by the service suffix, and the engine routes the object to that instance', () => {
    expect(STACK.datasources?.[0]).toMatchObject({ name: DATASOURCE, driver: DATASOURCE, config: {} });
    expect(engine.getDriverByName(DATASOURCE)).toBe(driver);
    expect(engine.getDriverForObject(OBJECT)).toBe(driver);
  });

  it('auto-connect finds the driver already registered and leaves it alone; the boot connects it once', () => {
    const connection: any = kernel.getService('datasource-connection');
    expect(connection.getConnectionState?.(DATASOURCE)?.status).toBe('already-registered');
    expect(bootCalls.filter((c) => c.method === 'connect')).toHaveLength(1);
  });
});

describe('(b) the stack boots with `checkOnBoot: false` and no `introspectSchema`', () => {
  it('the boot came up, ran no DDL against the remote, and never asked it for a schema', () => {
    expect(typeof (driver as any).introspectSchema).toBe('undefined');
    expect(bootCalls.filter((c) => c.method === 'syncSchema')).toEqual([]);
  });

  it('the validation it skipped would have failed: a fresh sweep reports the object unvalidatable', async () => {
    const svc: any = kernel.getService('external-datasource');
    const report = await svc.validateAll();
    const row = report.results.find((r: any) => r.object === OBJECT);
    expect(row?.datasource).toBe(DATASOURCE);
    expect(row?.ok).toBe(false);
  });
});

describe('(c) GET /data/spike_node with the view\'s filter and sort reaches `driver.find` with a DriverQuery', () => {
  it('the view\'s filter arrives as `where`, its sort as `orderBy`, `top` as `limit`; no projection, no offset', async () => {
    // The plan view's filter as the console lowers it (`toFilterNode`), its
    // sort as `serializeOrderBy` writes it, and the console's page size.
    const plan = (STACK.views?.[0] as any)?.listViews?.plan;
    expect(plan?.filter).toEqual([{ field: 'archived', operator: 'equals', value: false }]);
    expect(plan?.sort).toEqual([{ field: 'start_date', order: 'asc' }]);
    const mark = calls.length;
    const filter = encodeURIComponent(JSON.stringify(['archived', '=', false]));
    const res = await as(adminToken, 'GET', `/data/${OBJECT}?filter=${filter}&sort=start_date&top=50`);
    const body = await readJson(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    // Exactly what the remote system is asked — the whole DriverQuery,
    // `object` included (the engine spreads it in although `DriverQuery`
    // omits it), then a second round trip for the total.
    expect(calls.slice(mark)).toEqual([
      {
        method: 'find',
        object: OBJECT,
        query: { where: { archived: false }, orderBy: [{ field: 'start_date', order: 'asc' }], limit: 50, object: OBJECT },
      },
      { method: 'count', object: OBJECT, query: { object: OBJECT, where: { archived: false } } },
    ]);
    expect((body.records as Row[]).map((r) => r.id)).toEqual(['n_root', 'n_cut', 'n_weld']);
  });
});

describe('(d) a formula over `current_user` on the external object evaluates per caller', () => {
  it('the planner reads `locked: false` on an unlocked node, the administrator reads `locked: true`', async () => {
    const asPlanner = await readJson(await as(plannerToken, 'GET', `/data/${OBJECT}/n_cut`));
    const asAdmin = await readJson(await as(adminToken, 'GET', `/data/${OBJECT}/n_cut`));
    expect(adminId).not.toBe(plannerId);
    expect(asPlanner.record).toMatchObject({ id: 'n_cut', planner: plannerId, plan_locked: false, locked: false });
    expect(asAdmin.record).toMatchObject({ id: 'n_cut', planner: plannerId, plan_locked: false, locked: true });
  });

  it('a locked plan reads `locked: true` for the planner too', async () => {
    const asPlanner = await readJson(await as(plannerToken, 'GET', `/data/${OBJECT}/n_weld`));
    expect(asPlanner.record).toMatchObject({ id: 'n_weld', plan_locked: true, locked: true });
  });
});

describe('(e) PATCH /data/spike_node/:id runs `beforeUpdate` first, then `driver.update`', () => {
  it('a hook refusal answers 409 with the declared message, and the driver is never asked to write', async () => {
    const mark = calls.length;
    const res = await as(plannerToken, 'PATCH', `/data/${OBJECT}/n_weld`, { start_date: '2026-11-10', end_date: '2026-11-14' });
    const body = await readJson(res);
    expect(res.status, JSON.stringify(body)).toBe(409);
    expect(body).toMatchObject({
      code: 'RESOURCE_CONFLICT',
      declaredCode: 'PLAN_LOCKED',
      error: 'This plan is locked; unlock it before rescheduling.',
    });
    // The hook read the pre-image through the driver, and nothing else.
    expect(calls.slice(mark).map((c) => c.method)).not.toContain('update');
    expect(callsSince(mark, 'findOne').length).toBeGreaterThanOrEqual(1);
    expect(rows.find((r) => r.id === 'n_weld')).toMatchObject({ start_date: '2026-11-09', end_date: '2026-11-13' });
  });

  it('an allowed write reaches `driver.update` last, carrying the hook\'s stamp, and the returned row is served', async () => {
    const mark = calls.length;
    const res = await as(plannerToken, 'PATCH', `/data/${OBJECT}/n_cut`, { start_date: '2026-11-03', end_date: '2026-11-07' });
    const body = await readJson(res);
    expect(res.status, JSON.stringify(body)).toBe(200);

    const seen = calls.slice(mark);
    expect(seen.at(-1)?.method).toBe('update');
    expect(callsSince(mark, 'update')).toHaveLength(1);
    const update = seen.at(-1)!;
    expect(update).toMatchObject({ object: OBJECT, id: 'n_cut' });
    // The patch, the hook's stamp, and what the engine adds on its own: the
    // id and the two audit stamps, which no remote column declares.
    expect(update.data).toMatchObject({ start_date: '2026-11-03', end_date: '2026-11-07', guard_note: 'checked', id: 'n_cut', updated_by: plannerId });
    expect(Object.keys(update.data as Row).sort()).toEqual(['end_date', 'guard_note', 'id', 'start_date', 'updated_at', 'updated_by']);
    // The row the driver returned is the row served, formula included.
    expect(body.record).toMatchObject({ id: 'n_cut', name: 'Cut', start_date: '2026-11-03', end_date: '2026-11-07', guard_note: 'checked', locked: false });
  });

  it('(e3) on the default sharing model, a member holding allowEdit is refused every edit: the ownership checks read columns no remote row carries', async () => {
    const mark = calls.length;
    const res = await as(plannerToken, 'PATCH', `/data/${OWNED}/o_1`, { name: 'Renamed' });
    const body = await readJson(res);
    expect(res.status, JSON.stringify(body)).toBe(403);
    expect(body?.code).toBe('PERMISSION_DENIED');
    const seen = calls.slice(mark).filter((c) => c.object === OWNED);
    expect(seen.map((c) => c.method)).not.toContain('update');
    // What the remote is asked for: `owner_id` (the sharing check) and
    // `created_by == current_user.id` (the platform ownership floor).
    expect(seen).toContainEqual({ method: 'find', object: OWNED, query: { where: { id: 'o_1' }, fields: ['id', 'owner_id'], limit: 1, object: OWNED } });
    expect(seen).toContainEqual({
      method: 'findOne',
      object: OWNED,
      query: { where: { $and: [{ id: 'o_1' }, { created_by: plannerId }] }, object: OWNED, limit: 1 },
    });
    expect(owned[0]).toEqual({ id: 'o_1', name: 'Remote row' });
  });
});

describe('(g) object permission sets apply to the external object', () => {
  it('a caller whose sets grant nothing on spike_node gets 403 on the list read, and the driver is never asked', async () => {
    const mark = calls.length;
    const res = await as(outsiderToken, 'GET', `/data/${OBJECT}`);
    const body = await readJson(res);
    expect(res.status, JSON.stringify(body)).toBe(403);
    expect(body?.code).toBe('PERMISSION_DENIED');
    expect(calls.slice(mark)).toEqual([]);
  });

  it('the same caller gets 403 on a PATCH; the remote sees one by-id read and no write', async () => {
    const mark = calls.length;
    const res = await as(outsiderToken, 'PATCH', `/data/${OBJECT}/n_cut`, { name: 'Renamed' });
    const body = await readJson(res);
    expect(res.status, JSON.stringify(body)).toBe(403);
    expect(body?.code).toBe('PERMISSION_DENIED');
    // The write door loads the record before it refuses — on a plugin driver
    // that is a round trip to the remote on behalf of a caller who may not read.
    expect(calls.slice(mark)).toEqual([
      { method: 'findOne', object: OBJECT, query: { where: { id: 'n_cut' }, object: OBJECT, limit: 1 } },
    ]);
    expect(rows.find((r) => r.id === 'n_cut')?.name).toBe('Cut');
  });
});
