// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 30 — spawns the real producer once per single-cause fixture: two real-kernel boots, one per posture (ObjectQL, the sqlite-wasm default datasource, Hono on port 0, auth, datasource admin, security, sharing, REST, the dispatcher and the spike's plugin driver) with real sign-ups, the `single` boot shared by the 12 cases (a) to (g) and itself the subject of (a) and (b), the `isolated` boot shared by the 6 cases of (h), plus the refused boot that is case (h6)'s subject; 4.6 s of cases in a local run against 2.9 s before the third boot; the single-boot file's slowest CI reading was 12.4 s (scheduled full-battery run 41255489006, Test Core shard log), scaled by the local ratio and x 1.25, rounded up — re-measure on the first scheduled run that carries (h)

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
 *
 * [#27277] Since P1 the engine holds this driver behind its correctness floor
 * (`external-driver-floor.ts` in objectql): a plugin driver on a non-managed
 * datasource is sent `where` and `orderBy` with `limit` EXTERNAL_ROW_CAP + 1,
 * and the engine applies the whole query to the rows it returns. `findOne` and
 * `count` are answered from that same read. The steps below pin what the
 * remote is asked under the floor.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { defineStack, defineView } from '@objectstack/spec';
import type { DriverQuery, IDataDriver, IExternalDatasourceService } from '@objectstack/spec/contracts';
import { ObjectQLPlugin, EXTERNAL_ROW_CAP, unwrapExternalDriverFloor } from '@objectstack/objectql';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/rest';
import { AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions, RLS_DENY_FILTER } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import {
  DatasourceAdminServicePlugin,
  ExternalDatasourceServicePlugin,
  createDefaultDatasourceDriverFactory,
  type DatasourceConnectionService,
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
    throw new Error(`spike_tree remote: a non-object where arrived: ${JSON.stringify(where)}`);
  }
  for (const [key, cond] of Object.entries(where as Record<string, unknown>)) {
    if (key === '$and') {
      if (!(cond as unknown[]).every((w) => matches(row, w))) return false;
      continue;
    }
    if (key.startsWith('$')) throw new Error(`spike_tree remote: unsupported combinator ${key}`);
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      for (const [op, value] of Object.entries(cond as Record<string, unknown>)) {
        if (op === '$eq') { if (row[key] !== value) return false; continue; }
        if (op === '$ne') { if (row[key] === value) return false; continue; }
        if (op === '$in') { if (!(value as unknown[]).includes(row[key])) return false; continue; }
        throw new Error(`spike_tree remote: unsupported operator ${op} on ${key}`);
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

let kernel: ObjectKernel;
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
    // [#27277] Behind the floor: one floored instance, wrapping this driver.
    const held = engine.getDriverByName(DATASOURCE)!;
    expect(held).not.toBe(driver);
    expect(unwrapExternalDriverFloor(held)).toBe(driver);
    expect(engine.getDriverForObject(OBJECT)).toBe(held);
  });

  it('auto-connect finds the driver already registered and leaves it alone; the boot connects it once', () => {
    const connection = kernel.getService<DatasourceConnectionService>('datasource-connection');
    expect(connection.getConnectionState(DATASOURCE)?.status).toBe('already-registered');
    expect(bootCalls.filter((c) => c.method === 'connect')).toHaveLength(1);
  });
});

describe('(b) the stack boots with `checkOnBoot: false` and no `introspectSchema`', () => {
  it('the boot came up, ran no DDL against the remote, and never asked it for a schema', () => {
    expect(typeof (driver as any).introspectSchema).toBe('undefined');
    expect(bootCalls.filter((c) => c.method === 'syncSchema')).toEqual([]);
  });

  it('the validation it skipped would have failed: a fresh sweep reports the object unvalidatable', async () => {
    const svc = kernel.getService<IExternalDatasourceService>('external-datasource');
    const report = await svc.validateAll();
    const row = report.results.find((r) => r.object === OBJECT);
    expect(row?.datasource).toBe(DATASOURCE);
    expect(row?.ok).toBe(false);
  });
});

describe('(c) GET /data/spike_node with the view\'s filter and sort reaches `driver.find` with a DriverQuery', () => {
  it('the view\'s filter arrives as `where`, its sort as `orderBy`; `top` is the engine\'s, the remote is asked for the cap', async () => {
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

    // Exactly what the remote system is asked — `where` and `orderBy`, which
    // it may push down, `object` (the engine spreads it in although
    // `DriverQuery` omits it), and the floor's cap in place of `top`; then a
    // second round trip for the total, which the floor answers from a read
    // of the same shape (#27277).
    expect(calls.slice(mark)).toEqual([
      {
        method: 'find',
        object: OBJECT,
        query: { where: { archived: false }, orderBy: [{ field: 'start_date', order: 'asc' }], limit: EXTERNAL_ROW_CAP + 1, object: OBJECT },
      },
      { method: 'find', object: OBJECT, query: { object: OBJECT, where: { archived: false }, limit: EXTERNAL_ROW_CAP + 1 } },
    ]);
    // `n_root` and `n_cut` tie on `start_date`. The engine now orders the
    // page itself, and a paged read breaks a tie by `id` (the partition rule
    // `driver-sql` follows), so `n_cut` comes first.
    expect((body.records as Row[]).map((r) => r.id)).toEqual(['n_cut', 'n_root', 'n_weld']);
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
    // [#27277] The floor answers `findOne` from a capped `find`.
    expect(callsSince(mark, 'find').length).toBeGreaterThanOrEqual(1);
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

  it('(e3) on the default sharing model, a member holding allowEdit is refused every edit: no declared owner, so the member\'s read scope admits no row (404)', async () => {
    const mark = calls.length;
    const res = await as(plannerToken, 'PATCH', `/data/${OWNED}/o_1`, { name: 'Renamed' });
    const body = await readJson(res);
    // [#27425] The undeclared `owner_id` proves no owner, so the member's read
    // scope admits no row and the edit's pre-image read finds none: 404, not
    // the 403 it answered while the read went unscoped.
    expect(res.status, JSON.stringify(body)).toBe(404);
    expect(body?.code).toBe('RECORD_NOT_FOUND');
    const seen = calls.slice(mark).filter((c) => c.object === OWNED);
    expect(seen.map((c) => c.method)).not.toContain('update');
    // What the remote is asked for: `owner_id` by id (the sharing check), and
    // the scoped pre-image read, which carries the deny-all sentinel.
    // [#27277] Under the floor the remote sees each as a capped `find`; the
    // engine applies the projection and `limit: 1` itself.
    expect(seen).toContainEqual({ method: 'find', object: OWNED, query: { where: { id: 'o_1' }, limit: EXTERNAL_ROW_CAP + 1, object: OWNED } });
    expect(seen).toContainEqual({
      method: 'find',
      object: OWNED,
      query: { where: { $and: [{ id: 'o_1' }, { id: '__deny_all__' }] }, object: OWNED, limit: EXTERNAL_ROW_CAP + 1 },
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

  it('the same caller gets 403 on a PATCH; the remote sees no read and no write', async () => {
    const mark = calls.length;
    const res = await as(outsiderToken, 'PATCH', `/data/${OBJECT}/n_cut`, { name: 'Renamed' });
    const body = await readJson(res);
    expect(res.status, JSON.stringify(body)).toBe(403);
    expect(body?.code).toBe('PERMISSION_DENIED');
    // The write door judges the update before it looks the record up, as it
    // judges a delete, so a caller who may not update the object costs the
    // remote no round trip at all.
    expect(calls.slice(mark)).toEqual([]);
    expect(rows.find((r) => r.id === 'n_cut')?.name).toBe('Cut');
  });
});

// ---------------------------------------------------------------------------
// (h) Under a walled tenancy posture every external object states its
// organization scope (ADR-0015 §10)
// ---------------------------------------------------------------------------
//
// The boot above runs the `single` posture, where no wall is enforced and no
// declaration is owed — `spike_node` and `spike_owned` state nothing and boot;
// that block is this one's control. This block boots the same composition
// again under `isolated`: the posture request, the platform owner a walled boot
// declares, and the stand-in `org-scoping` provider `@objectstack/verify`
// mounts for `multiTenant: 'posture-only'`. Two members, each in one
// organization, read the same objects through the HTTP door.

/** Declares its own `organization_id`: the remote rows carry the column and the driver returns it. */
const WALLED = 'spike_walled';
/** Declares `organization_id` too, but its driver IGNORES `where` — the engine's floor re-applies it. */
const WALLED_BLIND = 'spike_walled_blind';
/** Declares `tenancy: { enabled: false }`: shared by every organization. */
const SHARED = 'spike_shared';
/** Declares `systemFields: { tenant: false }`: the same, spelled on the system fields. */
const SHARED_SYSTEM_FIELDS = 'spike_shared_sf';
/** A local object, stored by the platform — the walled control. */
const LOCAL = 'spike_local';
/** Registered AFTER the boot and stating nothing: denied, never read as shared. */
const LATE = 'spike_late';
/** States nothing at boot: the boot is refused by name. */
const UNDECLARED = 'spike_undeclared';
/** Declares `tenancy.tenantField` naming a column the wall does not read: refused the same way. */
const FOREIGN_FIELD = 'spike_foreign_field';
const WALLED_SET = 'spike_walled_reader';
const ORG_A = 'org_spike_a';
const ORG_B = 'org_spike_b';
const A_EMAIL = 'a@spike-walled.test';
const B_EMAIL = 'b@spike-walled.test';

const walledTables: Record<string, Row[]> = {
  [WALLED]: [
    { id: 'w_a', name: 'A walled', organization_id: ORG_A },
    { id: 'w_b', name: 'B walled', organization_id: ORG_B },
    // A row the remote serves with NO organization column: nobody's.
    { id: 'w_none', name: 'No organization' },
  ],
  [WALLED_BLIND]: [
    { id: 'wb_a', name: 'A blind', organization_id: ORG_A },
    { id: 'wb_b', name: 'B blind', organization_id: ORG_B },
    { id: 'wb_none', name: 'No organization' },
  ],
  [SHARED]: [{ id: 's_1', name: 'Shared 1' }, { id: 's_2', name: 'Shared 2' }],
  [SHARED_SYSTEM_FIELDS]: [{ id: 'sf_1', name: 'Shared SF 1' }],
  [LATE]: [{ id: 'l_a', name: 'A late', organization_id: ORG_A }, { id: 'l_b', name: 'B late', organization_id: ORG_B }],
};
const walledCalls: Call[] = [];

/** The spike driver over the walled tables, blind to `where` on exactly one object. */
function createWalledDriver(): IDataDriver {
  const inner = createSpikeTreeDriver(walledTables, walledCalls);
  const blind = {
    ...inner,
    async find(object: string, query: DriverQuery = {}) {
      if (object !== WALLED_BLIND) return inner.find(object, query);
      walledCalls.push({ method: 'find', object, query: snapshot(query) });
      return (walledTables[object] ?? []).map((r) => ({ ...r }));
    },
  };
  return blind as unknown as IDataDriver;
}

/** The `org-scoping` stand-in `@objectstack/verify` mounts for `multiTenant: 'posture-only'`. */
const orgScopingStandIn: Plugin & { supportedPostures: readonly string[] } = {
  name: 'com.spike.simulated-org-scoping',
  version: '1.0.0',
  providesServices: ['org-scoping'],
  supportedPostures: ['group', 'isolated'],
  init: async (ctx: PluginContext) => { ctx.registerService('org-scoping', orgScopingStandIn); },
};

const externalObject = (name: string, remoteName: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  datasource: DATASOURCE,
  external: { remoteName },
  sharingModel: 'public_read_write' as const,
  fields: { name: { type: 'text' as const, label: 'Name' } },
  ...extra,
});

const WALLED_DATASOURCE = {
  name: DATASOURCE,
  label: 'Spike remote (plugin driver, walled)',
  driver: DATASOURCE,
  schemaMode: 'external' as const,
  config: {},
  external: { allowWrites: false, validation: { onMismatch: 'fail' as const, checkOnBoot: false } },
};

const WALLED_STACK = defineStack({
  manifest: { id: 'com.spike.plugin-driver-walled', name: 'Plugin driver spike, walled', version: '1.0.0', type: 'app' },
  datasources: [WALLED_DATASOURCE],
  objects: [
    externalObject(WALLED, 'walled', { fields: { name: { type: 'text', label: 'Name' }, organization_id: { type: 'text', label: 'Organization' } } }),
    externalObject(WALLED_BLIND, 'walled_blind', { fields: { name: { type: 'text', label: 'Name' }, organization_id: { type: 'text', label: 'Organization' } } }),
    externalObject(SHARED, 'shared', { tenancy: { enabled: false } }),
    externalObject(SHARED_SYSTEM_FIELDS, 'shared_sf', { systemFields: { tenant: false } }),
    { name: LOCAL, label: LOCAL, sharingModel: 'public_read_write', fields: { name: { type: 'text', label: 'Name' } } },
  ],
  permissions: [
    {
      name: WALLED_SET,
      label: 'Walled reader',
      objects: {
        [WALLED]: { allowRead: true },
        [WALLED_BLIND]: { allowRead: true },
        [SHARED]: { allowRead: true },
        [SHARED_SYSTEM_FIELDS]: { allowRead: true },
        [LOCAL]: { allowRead: true, allowCreate: true },
      },
    },
  ],
});

/** The same stack with the two objects a walled boot refuses. */
const REFUSED_STACK = defineStack({
  manifest: { id: 'com.spike.plugin-driver-refused', name: 'Plugin driver spike, refused', version: '1.0.0', type: 'app' },
  datasources: [WALLED_DATASOURCE],
  objects: [
    externalObject(SHARED, 'shared', { tenancy: { enabled: false } }),
    externalObject(UNDECLARED, 'undeclared'),
    externalObject(FOREIGN_FIELD, 'foreign', {
      tenancy: { enabled: true, tenantField: 'remote_org' },
      fields: { name: { type: 'text', label: 'Name' }, remote_org: { type: 'text', label: 'Remote org' } },
    }),
  ],
});

async function composeWalled(stack: unknown, walledDriver: IDataDriver): Promise<ObjectKernel> {
  const k = new ObjectKernel();
  await k.use(new ObjectQLPlugin());
  await k.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
  await k.use(new HonoServerPlugin({ port: 0 }));
  await k.use(spikeTreeDriverPlugin(walledDriver));
  await k.use(orgScopingStandIn);
  await k.use(new AppPlugin(stack as any));
  await k.use(new PlatformObjectsPlugin());
  await k.use(new AuthPlugin({ secret: 'plugin-driver-external-object-spike-walled-secret' }));
  await k.use(new DatasourceAdminServicePlugin({ driverFactory: createDefaultDatasourceDriverFactory() }));
  await k.use(new ExternalDatasourceServicePlugin());
  await k.use(createExternalValidationPlugin());
  await k.use(new SecurityPlugin(appSecurityPluginOptions(stack as any)));
  await k.use(new SharingServicePlugin());
  await k.use(createRestApiPlugin({}));
  await k.use(createDispatcherPlugin({}));
  return k;
}

describe('(h) under the `isolated` posture every external object states its organization scope', () => {
  let wKernel: ObjectKernel;
  let wHttp: any;
  let wApp: any;
  let wEngine: any;
  let tokenA: string;
  let tokenB: string;
  const prevEnv: Record<string, string | undefined> = {};

  const wReq = (path: string, init?: RequestInit) => wApp.request(`${ORIGIN}${API}${path}`, init);
  const wAs = (token: string, method: string, path: string, payload?: unknown) =>
    wReq(path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    });
  const idsOf = (body: any): string[] => ((body?.records ?? []) as Row[]).map((r) => String(r.id)).sort();
  const whereSentTo = (object: string): unknown =>
    (walledCalls.filter((c) => c.object === object && c.method === 'find').at(-1)?.query as { where?: unknown } | undefined)?.where;

  /** Make `email` a member of `org` holding the reader set, then sign in: the session carries the one membership. */
  async function memberOf(email: string, org: string): Promise<string> {
    await wEngine.insert('sys_invitation', {
      id: `inv_spike_walled_${email.split('@')[0]}`, email, status: 'pending', organization_id: org,
      role: 'member', inviter_id: 'usr_spike_walled_inviter', expires_at: new Date(Date.now() + 3_600_000),
    }, { context: { isSystem: true, tenantId: org } });
    const signedUp = await wReq('/auth/sign-up/email', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: MEMBER_PASSWORD, name: email.split('@')[0] }),
    });
    if (!signedUp.ok) throw new Error(`walled signUp failed: ${signedUp.status} ${await signedUp.text()}`);
    const users = await wEngine.find('sys_user', { where: { email }, limit: 1, context: { isSystem: true } });
    const userId = String(users?.[0]?.id);
    await wEngine.insert('sys_member', { id: `mem_${userId}`, organization_id: org, user_id: userId, role: 'member' }, { context: { isSystem: true, tenantId: org } });
    await wEngine.insert('sys_user_permission_set', { id: `ups_${userId}`, user_id: userId, permission_set: WALLED_SET, granted_by: null }, { context: { isSystem: true, tenantId: org } });
    const signedIn = await wReq('/auth/sign-in/email', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: MEMBER_PASSWORD }),
    });
    if (!signedIn.ok) throw new Error(`walled signIn failed: ${signedIn.status} ${await signedIn.text()}`);
    return ((await signedIn.json()) as any).token;
  }

  beforeAll(async () => {
    for (const k of ['NODE_ENV', 'OS_TENANCY_POSTURE', 'OS_PLATFORM_OWNER_EMAIL']) prevEnv[k] = process.env[k];
    process.env.NODE_ENV = 'development';
    process.env.OS_TENANCY_POSTURE = 'isolated';
    process.env.OS_PLATFORM_OWNER_EMAIL = ADMIN.email;

    wKernel = await composeWalled(WALLED_STACK, createWalledDriver());
    await wKernel.bootstrap();
    wHttp = await wKernel.getServiceAsync('http-server');
    wApp = wHttp.getRawApp();
    wEngine = await wKernel.getServiceAsync('objectql');
    await wEngine.insert('sys_organization', { id: ORG_A, name: 'Org A', slug: ORG_A }, { context: { isSystem: true } });
    await wEngine.insert('sys_organization', { id: ORG_B, name: 'Org B', slug: ORG_B }, { context: { isSystem: true } });
    tokenA = await memberOf(A_EMAIL, ORG_A);
    tokenB = await memberOf(B_EMAIL, ORG_B);
  }, BOOT_TIMEOUT);

  afterAll(async () => {
    try { await wHttp?.close?.(); } catch { /* best-effort */ }
    try { await wKernel?.shutdown?.(); } catch { /* best-effort */ }
    for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }, 60_000);

  it('(h1) an external object declaring its own `organization_id` is walled: A reads only A, B only B, and a row without the column reads to no one', async () => {
    const a = await wAs(tokenA, 'GET', `/data/${WALLED}`);
    const bodyA = await readJson(a);
    expect(a.status, JSON.stringify(bodyA)).toBe(200);
    expect(idsOf(bodyA)).toEqual(['w_a']);
    // The remote is asked for A's organization and nothing else.
    expect(JSON.stringify(whereSentTo(WALLED))).toContain(`"organization_id":"${ORG_A}"`);
    const b = await wAs(tokenB, 'GET', `/data/${WALLED}`);
    const bodyB = await readJson(b);
    expect(b.status, JSON.stringify(bodyB)).toBe(200);
    expect(idsOf(bodyB)).toEqual(['w_b']);
  });

  it('(h2) a driver that ignores `where` stays walled: the floor re-applies the organization predicate to what it answered', async () => {
    const a = await wAs(tokenA, 'GET', `/data/${WALLED_BLIND}`);
    const bodyA = await readJson(a);
    expect(a.status, JSON.stringify(bodyA)).toBe(200);
    expect(idsOf(bodyA)).toEqual(['wb_a']);
    // The predicate WAS sent — the driver chose to ignore it — and the row
    // without an organization column is filtered to no one.
    expect(JSON.stringify(whereSentTo(WALLED_BLIND))).toContain(`"organization_id":"${ORG_A}"`);
    const b = await wAs(tokenB, 'GET', `/data/${WALLED_BLIND}`);
    expect(idsOf(await readJson(b))).toEqual(['wb_b']);
  });

  it('(h3) an external object declaring `tenancy: { enabled: false }` or `systemFields: { tenant: false }` is shared: A and B read the same rows', async () => {
    for (const object of [SHARED, SHARED_SYSTEM_FIELDS]) {
      const a = await wAs(tokenA, 'GET', `/data/${object}`);
      const bodyA = await readJson(a);
      expect(a.status, JSON.stringify(bodyA)).toBe(200);
      const b = await wAs(tokenB, 'GET', `/data/${object}`);
      const bodyB = await readJson(b);
      expect(idsOf(bodyA)).toEqual((walledTables[object] ?? []).map((r) => String(r.id)).sort());
      expect(idsOf(bodyB)).toEqual(idsOf(bodyA));
      // No organization predicate reaches the remote: the object has no such column.
      expect(JSON.stringify(whereSentTo(object) ?? null)).not.toContain('organization_id');
    }
  });

  it('(h4) CONTROL: a local object stays walled under the same boot', async () => {
    expect((await wAs(tokenA, 'POST', `/data/${LOCAL}`, { name: 'A local' })).status).toBeLessThan(300);
    expect((await wAs(tokenB, 'POST', `/data/${LOCAL}`, { name: 'B local' })).status).toBeLessThan(300);
    const a = await readJson(await wAs(tokenA, 'GET', `/data/${LOCAL}`));
    const b = await readJson(await wAs(tokenB, 'GET', `/data/${LOCAL}`));
    expect((a.records as Row[]).map((r) => r.name)).toEqual(['A local']);
    expect((b.records as Row[]).map((r) => r.name)).toEqual(['B local']);
  });

  it('(h5) an external object registered AFTER the boot that states no scope is denied: zero rows for every organization, never shared', async () => {
    wEngine.registry.registerObject({
      name: LATE,
      label: 'Late',
      datasource: DATASOURCE,
      external: { remoteName: 'late' },
      sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name' } },
    });
    await wEngine.syncObjectSchema(LATE);
    // No stack permission can name an object the stack does not declare, so the
    // verdict is read where the HTTP door reads it: the security service's read
    // filter for each member — the Layer 0 wall, with no business policy beside it.
    const security = wKernel.getService<{ getReadFilter(object: string, ctx: unknown): Promise<unknown> }>('security');
    const forA = await security.getReadFilter(LATE, { userId: 'usr_spike_a', tenantId: ORG_A, positions: [] });
    const forB = await security.getReadFilter(LATE, { userId: 'usr_spike_b', tenantId: ORG_B, positions: [] });
    // The spec's frozen deny sentinel, by identity (ADR-0139 D2 step 2).
    expect(forA).toBe(RLS_DENY_FILTER);
    expect(forB).toBe(RLS_DENY_FILTER);
    // …and what a read carrying that filter asks the remote: nothing it holds.
    const mark = walledCalls.length;
    const rows = await wEngine.find(LATE, { where: forA, context: { isSystem: true } });
    expect(rows).toEqual([]);
    const seen = walledCalls.slice(mark).filter((c) => c.object === LATE);
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) expect(JSON.stringify(call.query)).toMatch(/__rls_deny__|__deny_all__/);
    // CONTROL: the same member on the declared shared object reads unwalled.
    expect(await security.getReadFilter(SHARED, { userId: 'usr_spike_a', tenantId: ORG_A, positions: [] })).toBeUndefined();
  });

  it('(h6) an external object that states no scope at boot is refused BY NAME, with the three ways out; so is a `tenancy.tenantField` the wall cannot read', async () => {
    const refused = await composeWalled(REFUSED_STACK, createSpikeTreeDriver({}, []));
    let thrown: unknown;
    try {
      await refused.bootstrap();
    } catch (e) {
      thrown = e;
    } finally {
      try { await refused.shutdown(); } catch { /* best-effort */ }
    }
    expect(thrown).toBeInstanceOf(Error);
    const error = thrown as Error & { name: string; objects?: Array<{ object: string }> };
    expect(error.name).toBe('ExternalObjectOrganizationScopeUndeclaredError');
    expect(error.objects?.map((o) => o.object)).toEqual([FOREIGN_FIELD, UNDECLARED]);
    expect(error.message).toContain("'isolated' tenancy posture every external object states its organization scope");
    expect(error.message).toContain(`'${UNDECLARED}'`);
    expect(error.message).toContain('`organization_id` field of its own');
    expect(error.message).toContain('`tenancy: { enabled: false }`');
    expect(error.message).toContain('`systemFields: { tenant: false }`');
    expect(error.message).toContain(`'${FOREIGN_FIELD}' declares \`tenancy.tenantField: 'remote_org'\``);
    expect(error.message).toContain("`external.columnMap: { remote_org: 'organization_id' }`");
    // The declared object is not named.
    expect(error.message).not.toContain(`'${SHARED}'`);
  }, BOOT_TIMEOUT);
});
