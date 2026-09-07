// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15351] The settings manifest gate supplies the EFFECTIVE tenancy posture to
 * `resolveAuthzContext`, so both posture-conditional API-key refusals are
 * reachable here — and the `tenantId` this seam hands onward is a vetted one.
 *
 * ## What was open, and how it was measured
 *
 * `resolveAuthzContext` gates BOTH posture-conditional API-key refusals on a
 * posture its CALLER supplies — `organization_required` (an org-less key under
 * a wall, `api-key.ts`) and `organization_membership_ended` (a key stamped with
 * an organization its owner has left, `resolve-authz-context.ts`).
 * `SettingsServicePlugin`'s `verifiedContextFromRequest` supplied none, so
 * neither guard ran. An API key's `tenantId` is
 * `sys_api_key.active_organization_id` copied verbatim: the caller's own stored
 * claim, never vetted against current membership.
 *
 * This door does not merely ADMIT the principal — it returns `authz.tenantId`
 * onward as the resolved settings tenant, so the unvetted claim became the
 * verdict a consumer acts on (`SettingsContext.tenantId` reaches the write
 * path's crypto handle context and both audit ledgers).
 *
 * Driven through the real `SettingsServicePlugin` over a real `ObjectQL`
 * engine, with a `tenancy` service reporting `isolated` on a REAL kernel:
 *
 * | door                                | before | after |
 * |:--|:--|:--|
 * | `PUT /api/settings/:ns`, ex-member's org-stamped key | **200, the row lands** | **403, zero rows** |
 * | `GET /api/settings/:ns`, same key   | **200, values served** | **403** |
 * | `GET /api/settings` (the listing)   | **200, the namespace enumerated** | **200, empty list** |
 * | an org-LESS key, same posture       | **200, the row lands** | **403, zero rows** |
 * | a CURRENT member's key (control)    | 200, row lands | 200, row lands — unchanged |
 * | no credential (control)             | 403 | 403 — unchanged |
 *
 * ## The wiring ablation, held permanently
 *
 * The three `mount()` shapes below differ in NOTHING but whether this seam can
 * resolve a posture: `no-async-registry` and `unregistered` re-admit the very
 * same ex-member the `isolated` case refuses. So the refusal is attributable to
 * the posture supply and to nothing else — a door that authenticated nobody
 * could not produce this table, and the CURRENT-member control proves it does
 * authenticate somebody.
 *
 * ## Real registry, real classification
 *
 * The `tenancy` service lives on a REAL `ObjectKernel`, so the
 * never-registered / registered-and-broken split (#13906 decision 1 option A)
 * comes from the registry's own rejections rather than from a hand-branded stub
 * at the seam under measurement. A hand-thrown error would pin the fixture, not
 * the classification.
 *
 * ## What is REAL here and what is a fixture
 *
 * `sys_setting` / `sys_setting_audit` are `@objectstack/platform-objects`
 * declarations this package already depends on: those rows are real, written
 * through the real engine and READ BACK OUT OF THE DRIVER'S STORE rather than
 * off a response body. The permission tables (`sys_api_key`, `sys_member`,
 * `sys_user*`, `sys_*permission_set`) belong to plugins this package must not
 * depend on, so they are answered at the engine seam from a fixture in the
 * SHIPPED aggregation shapes.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SysSetting, SysSettingAudit } from '@objectstack/platform-objects/system';
import type { SettingsManifest } from '@objectstack/spec/system';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import {
  ObjectKernel,
  hashApiKey,
  AUTHZ_STORE_UNAVAILABLE_CODE,
  AUTHZ_STORE_UNAVAILABLE_STATUS,
} from '@objectstack/core';
import type { SettingsContext } from './settings-service.types.js';

/**
 * The seam's own return value, captured through a PASS-THROUGH of the real
 * route registration — the real routes still mount and still run. Two readings
 * need it and neither is visible from a response body:
 *
 *  - the ADR-0112 envelope the broken-`tenancy` arm raises, which the settings
 *    route layer flattens to `500 INTERNAL_ERROR` (see the 503 describe below);
 *  - the `tenantId` this seam RETURNS, which is the half of this card that is
 *    not about admission at all.
 */
const captured = vi.hoisted(() => ({ contextFromRequest: undefined as
  | ((req: IHttpRequest) => SettingsContext | Promise<SettingsContext>)
  | undefined }));

vi.mock('./settings-routes.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('./settings-routes.js')>();
  return {
    ...real,
    registerSettingsRoutes: (http: any, service: any, opts: any = {}) => {
      captured.contextFromRequest = opts.contextFromRequest;
      return real.registerSettingsRoutes(http, service, opts);
    },
  };
});

const { SettingsServicePlugin } = await import('./settings-service-plugin.js');

const OWNER_PACKAGE = 'com.objectstack.test.settings-admission-tenancy';
const NS = 'branding_tenancy';
const ROUTE_BASE = '/api/settings';

const RAW_MEMBER_KEY = 'osk_member_key_15351';
const RAW_EXMEMBER_KEY = 'osk_exmember_key_15351';
const RAW_ORGLESS_KEY = 'osk_orgless_key_15351';

/**
 * One plain key, `global` scope. Deliberately minimal: the shipped manifests
 * carry `visible` predicates and cross-field `required` rules, and this file's
 * subject is who gets through the door, not what the resolver does after.
 */
const manifest: SettingsManifest = {
  namespace: NS,
  version: 1,
  label: 'Branding (tenancy fixture)',
  scope: 'global',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [{ type: 'text', key: 'workspace_name', label: 'Workspace name', required: false }],
};

/**
 * The fixture's ONE where-matcher: equality plus `$in`, the two shapes the
 * shared resolver issues. Every other shape REFUSES loudly rather than reading
 * as a field that happened not to match — an unimplemented operator that
 * silently returns `false` turns "this fixture cannot express the query" into
 * "the row is not there", which is how a permission fixture comes to prove the
 * opposite of what it claims.
 */
function matchesWhere(row: any, where: any): boolean {
  for (const [field, cond] of Object.entries(where ?? {})) {
    if (field.startsWith('$')) throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
    if (cond !== null && typeof cond === 'object') {
      const ops = Object.keys(cond as object);
      if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray((cond as any).$in)) {
        throw new Error(`fixture where-matcher: unsupported operator shape on '${field}'`);
      }
      if (!(cond as any).$in.includes(row[field])) return false;
      continue;
    }
    if (row[field] !== cond) return false;
  }
  return true;
}

/**
 * The permission store in the SHIPPED aggregation shapes. All four principals
 * hold `setup.access` + `setup.write`, so a refusal below can only be the
 * tenancy wall — never a missing capability.
 *
 * `u_exmember`'s key still carries `active_organization_id: 'org_A'`; the row
 * that made that stamp true is simply gone from `sys_member`. That is the whole
 * defect: the stamp is the caller's own stored claim.
 */
const PERMISSION_TABLES: Record<string, any[]> = {
  sys_api_key: [
    { id: 'key_member', key: hashApiKey(RAW_MEMBER_KEY), user_id: 'u_member', active_organization_id: 'org_A', revoked: false },
    { id: 'key_exmember', key: hashApiKey(RAW_EXMEMBER_KEY), user_id: 'u_exmember', active_organization_id: 'org_A', revoked: false },
    { id: 'key_orgless', key: hashApiKey(RAW_ORGLESS_KEY), user_id: 'u_orgless', revoked: false },
  ],
  // `u_exmember` and `u_session_exmember` are deliberately ABSENT: the
  // memberships that backed their stamps ended. `u_orgless` never had one.
  sys_member: [{ id: 'm1', user_id: 'u_member', organization_id: 'org_A' }],
  sys_user: [
    { id: 'u_member', email: 'u_member@acme.test' },
    { id: 'u_exmember', email: 'u_exmember@acme.test' },
    { id: 'u_orgless', email: 'u_orgless@acme.test' },
    { id: 'u_session_exmember', email: 'u_session_exmember@acme.test' },
  ],
  sys_user_position: [],
  sys_position: [],
  sys_position_permission_set: [],
  sys_user_permission_set: [
    { id: 'ups_member', user_id: 'u_member', permission_set_id: 'ps_settings', organization_id: null },
    { id: 'ups_exmember', user_id: 'u_exmember', permission_set_id: 'ps_settings', organization_id: null },
    { id: 'ups_orgless', user_id: 'u_orgless', permission_set_id: 'ps_settings', organization_id: null },
    { id: 'ups_session', user_id: 'u_session_exmember', permission_set_id: 'ps_settings', organization_id: null },
  ],
  sys_permission_set: [
    { id: 'ps_settings', name: 'settings_admin', system_permissions: ['setup.access', 'setup.write'] },
  ],
};
const PERMISSION_OBJECTS = new Set(Object.keys(PERMISSION_TABLES));

type Store = Map<string, Map<string, Record<string, unknown>>>;

/** A driver over plain Maps — enough of `IDataDriver` for the settings write path. */
function makeMemoryDriver() {
  const store: Store = new Map();
  let nextId = 0;
  const copy = (r: Record<string, unknown>) => ({ ...r });
  const rowsOf = (object: string) => {
    let s = store.get(object);
    if (!s) { s = new Map(); store.set(object, s); }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return (row[k] ?? null) === (v ?? null);
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = [...rowsOf(object).values()].filter((r) => matches(r, ast?.where));
      // The caller's bound, applied AFTER the filter and held BY PRESENCE, and
      // BEFORE the copy — a limit-blind double answers more rows than the
      // caller asked for, and one that touches rows outside the bound reads
      // work the engine it stands in for would never have done.
      const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      return page.map(copy);
    },
    async findOne(object: string, ast: any) {
      for (const r of rowsOf(object).values()) if (matches(r, ast?.where)) return copy(r);
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `row_${nextId}`;
      const row = { ...data, id };
      rowsOf(object).set(id, row);
      return copy(row);
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = rowsOf(object);
      const cur = s.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      s.set(id, next);
      return copy(next);
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && rowsOf(object).has(id) ? this.update(object, id, data) : this.create(object, data);
    },
    async delete(object: string, id: string) { return rowsOf(object).delete(id); },
    // ⛔ Not `find().length`: a bound is a page size, never a population size.
    async count(object: string, ast: any) {
      return [...rowsOf(object).values()].filter((r) => matches(r, ast?.where)).length;
    },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(object, ast);
      const s = rowsOf(object);
      for (const r of rows) s.set(r.id as string, { ...s.get(r.id as string), ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(object: string, ast: any) {
      const rows = await this.find(object, ast);
      for (const r of rows) rowsOf(object).delete(r.id as string);
      return rows.length;
    },
    async syncSchema() {}, async dropTable() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rowsOf };
}

/** Minimal `IHttpServer` that just keeps the handlers so a route can be invoked. */
class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) {
    this.routes.set(`${method} ${path}`, handler);
  }
  get(p: string, h: RouteHandler) { this.add('GET', p, h); return this as any; }
  post(p: string, h: RouteHandler) { this.add('POST', p, h); return this as any; }
  put(p: string, h: RouteHandler) { this.add('PUT', p, h); return this as any; }
  delete(p: string, h: RouteHandler) { this.add('DELETE', p, h); return this as any; }
  patch(p: string, h: RouteHandler) { this.add('PATCH', p, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

type Tenancy =
  | { kind: 'unregistered' }
  | { kind: 'service'; posture: string }
  | { kind: 'factory-throws' }
  | { kind: 'no-async-registry' };

interface Mounted {
  http: MockHttp;
  /** REAL `sys_setting` rows, read out of the driver's own store. */
  settingRows: () => Record<string, unknown>[];
  /** REAL `sys_setting_audit` rows — where this seam's `tenantId` lands. */
  auditRows: () => Record<string, unknown>[];
  contextFromRequest: (req: IHttpRequest) => SettingsContext | Promise<SettingsContext>;
}

/**
 * Boot the REAL `SettingsServicePlugin` through its production sequence
 * (`init` → `start` → the `kernel:ready` hook), with its services on a REAL
 * `ObjectKernel` so `getServiceAsync('tenancy')` resolves through the real
 * registry.
 */
async function mount(tenancy: Tenancy): Promise<Mounted> {
  const engine = new ObjectQL();
  const { driver, rowsOf } = makeMemoryDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(SysSetting as any, OWNER_PACKAGE);
  engine.registry.registerObject(SysSettingAudit as any, OWNER_PACKAGE);

  // The permission tables belong to plugins this package must not depend on,
  // so they are answered here. Every other read — `sys_setting`,
  // `sys_setting_audit` — goes to the real engine untouched.
  const realFind = engine.find.bind(engine);
  (engine as any).find = async (object: string, q: any = {}) => {
    if (!PERMISSION_OBJECTS.has(object)) return realFind(object, q);
    const rows = (PERMISSION_TABLES[object] ?? []).filter((row) => matchesWhere(row, q?.where));
    // The caller's bound is held BY PRESENCE, never re-derived here.
    return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
  };

  const http = new MockHttp();

  // `gracefulShutdown: false` — a fixture kernel must not hook the test
  // runner's process signals.
  const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
  kernel.registerService('objectql', engine);
  kernel.registerService('http-server', http);
  kernel.registerService('auth', {
    api: {
      getSession: async ({ headers }: any) => {
        const uid = headers?.get?.('x-fixture-session-user');
        return uid
          ? { user: { id: uid }, session: { id: 'sess_1', activeOrganizationId: 'org_A' } }
          : null;
      },
    },
  });
  if (tenancy.kind === 'service') {
    kernel.registerService('tenancy', { posture: tenancy.posture });
  } else if (tenancy.kind === 'factory-throws') {
    // The REAL "registered and FAILED to construct" class: the registry's own
    // unbranded rejection, not a stub thrown at the seam under measurement.
    kernel.registerServiceFactory('tenancy', () => {
      throw new Error('tenancy backend unavailable');
    });
  }
  // 'unregistered' → nothing registered: the branded not-registered rejection.

  // Bound OUT of the `any`-typed literal below: a lookup call nested inside a
  // `: any` declaration is the #4251 erasure shape.
  const getService = kernel.getService.bind(kernel);
  const registerService = kernel.registerService.bind(kernel);
  let readyHook: (() => Promise<void>) | undefined;
  const ctx: any = {
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    registerService,
    getService,
    hook: (event: string, fn: () => Promise<void>) => { if (event === 'kernel:ready') readyHook = fn; },
    // A `KernelBase`-shaped host (`LiteKernel`) exposes `getKernel()` and has
    // NO `getServiceAsync` at all — the shape the seam must answer quietly
    // rather than dereference into a `TypeError` (#15997).
    getKernel: () => (tenancy.kind === 'no-async-registry' ? { getService } : kernel),
  };

  captured.contextFromRequest = undefined;
  const plugin = new SettingsServicePlugin({
    manifests: [manifest],
    env: {},
    // The bundled `mail`/`sms`/`storage`/`ai` handlers register against
    // manifests this fixture does not load; opting out keeps the boot to the
    // one namespace under test.
    actionHandlers: {},
  });
  await plugin.init(ctx);
  await plugin.start(ctx);
  await readyHook!();

  return {
    http,
    settingRows: () => [...rowsOf('sys_setting').values()],
    auditRows: () => [...rowsOf('sys_setting_audit').values()],
    contextFromRequest: captured.contextFromRequest!,
  };
}

async function invoke(m: Mounted, route: string, req: Partial<IHttpRequest>) {
  const handler = m.http.routes.get(route)!;
  const state: { status: number; body?: any } = { status: 200 };
  const res = {
    json: vi.fn((data: any) => { state.body = data; }),
    send: vi.fn(),
    status: vi.fn((code: number) => { state.status = code; return res; }),
    header: vi.fn(() => res),
  } as unknown as IHttpResponse;
  await handler({ query: {}, params: {}, headers: {}, ...req } as IHttpRequest, res);
  return state;
}

const put = (m: Mounted, headers: Record<string, string>, value = 'ObjectStack') =>
  invoke(m, `PUT ${ROUTE_BASE}/:namespace`, {
    method: 'PUT', path: `${ROUTE_BASE}/${NS}`, params: { namespace: NS } as any,
    headers, body: { workspace_name: value } as any,
  });

const getNs = (m: Mounted, headers: Record<string, string>) =>
  invoke(m, `GET ${ROUTE_BASE}/:namespace`, {
    method: 'GET', path: `${ROUTE_BASE}/${NS}`, params: { namespace: NS } as any, headers,
  });

const listNs = (m: Mounted, headers: Record<string, string>) =>
  invoke(m, `GET ${ROUTE_BASE}`, { method: 'GET', path: ROUTE_BASE, headers });

const KEY = (raw: string) => ({ 'x-api-key': raw });

let savedPosture: string | undefined;
beforeEach(() => {
  savedPosture = process.env.OS_TENANCY_POSTURE;
  delete process.env.OS_TENANCY_POSTURE;
});
afterEach(() => {
  if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
  else process.env.OS_TENANCY_POSTURE = savedPosture;
  vi.restoreAllMocks();
});

describe('#15351 — under a wall-enforcing posture the settings doors refuse an unbacked key', () => {
  it("refuses an ex-member's org-stamped key at PUT and lands NOTHING in sys_setting", async () => {
    const m = await mount({ kind: 'service', posture: 'isolated' });
    const res = await put(m, KEY(RAW_EXMEMBER_KEY));

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('SETTINGS_FORBIDDEN');
    // Read back FROM THE STORE, never off the response body.
    expect(m.settingRows()).toHaveLength(0);
    expect(m.auditRows()).toHaveLength(0);
  });

  it("refuses an ex-member's org-stamped key at GET /:namespace (the read leak)", async () => {
    const m = await mount({ kind: 'service', posture: 'isolated' });
    const res = await getNs(m, KEY(RAW_EXMEMBER_KEY));
    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe('SETTINGS_FORBIDDEN');
  });

  it('stops an ex-member enumerating the namespace through GET /api/settings', async () => {
    // The listing is not a refusal but a FILTER (`listManifests`): an enforced
    // caller sees only what it may read. With no capabilities resolved, that is
    // the empty list — pinned so the leak cannot come back as a 200 that still
    // names the namespace.
    const m = await mount({ kind: 'service', posture: 'isolated' });
    const res = await listNs(m, KEY(RAW_EXMEMBER_KEY));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { manifests: [] } });
  });

  it('refuses an organization-less key where the posture requires one', async () => {
    const m = await mount({ kind: 'service', posture: 'isolated' });
    const res = await put(m, KEY(RAW_ORGLESS_KEY));
    expect(res.status).toBe(403);
    expect(m.settingRows()).toHaveLength(0);
  });

  it("CONTROL — a CURRENT member's key on the same posture still writes", async () => {
    // Without this the suite above would pass on a door that authenticates
    // nobody. The `sys_member` row is the ONLY difference from the first case.
    const m = await mount({ kind: 'service', posture: 'isolated' });
    const res = await put(m, KEY(RAW_MEMBER_KEY));

    expect(res.status).toBe(200);
    const rows = m.settingRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ namespace: NS, key: 'workspace_name' });
    expect(String(rows[0].value)).toContain('ObjectStack');
    // And the member's key really is read back, too.
    expect((await getNs(m, KEY(RAW_MEMBER_KEY))).status).toBe(200);
  });

  it('CONTROL — no credential is still the anonymous refusal, and writes nothing', async () => {
    const m = await mount({ kind: 'service', posture: 'isolated' });
    const res = await put(m, {});
    expect(res.status).toBe(403);
    expect(m.settingRows()).toHaveLength(0);
  });
});

describe('#15351 — THE WIRING ABLATION, held permanently', () => {
  // These two mounts differ from the refusing case in NOTHING but whether this
  // seam can resolve a posture. They are also both RULED behaviours, not
  // regressions: a host with no `tenancy` service has no wall to be walled out
  // of, and a `KernelBase`/`LiteKernel` host has no async registry at all
  // (#15997). Either way, they re-admit the very caller the posture refuses,
  // which is what makes the refusal above attributable to the fix.

  it('omit the async registry ⇒ the ex-member is ADMITTED again and the row lands', async () => {
    const m = await mount({ kind: 'no-async-registry' });
    const res = await put(m, KEY(RAW_EXMEMBER_KEY));
    expect(res.status).toBe(200);
    expect(m.settingRows()).toHaveLength(1);
  });

  it('`tenancy` NEVER registered ⇒ the quiet answer, the ex-member is admitted', async () => {
    // ⚠️ The half of decision-1-option-A that a blanket `catch { undefined }`
    // and a fail-closed rewrite would both get wrong — in opposite directions.
    const m = await mount({ kind: 'unregistered' });
    const res = await put(m, KEY(RAW_EXMEMBER_KEY));
    expect(res.status).toBe(200);
    expect(m.settingRows()).toHaveLength(1);
  });
});

describe('#15351 — the posture is the EFFECTIVE one, never the requested one', () => {
  it('admits the ex-member when the service reports `single` and the ENV asks for `isolated`', async () => {
    // ⭐ The discriminator. `resolveTenancyPosture()` — the value a "reuse what
    // is already in scope" fix would carry to this seam — answers `isolated`
    // here. The posture IN FORCE is `single`, so there is no wall to be walled
    // out of and refusing would break working automation (ADR-0093 D4/D5).
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const m = await mount({ kind: 'service', posture: 'single' });
    const res = await put(m, KEY(RAW_EXMEMBER_KEY));
    expect(res.status).toBe(200);
    expect(m.settingRows()).toHaveLength(1);
  });

  it('refuses the ex-member when the service reports `isolated` and the ENV asks for nothing', async () => {
    // The same discriminator from the other side: a requested-posture fix reads
    // "no posture requested" here and admits.
    delete process.env.OS_TENANCY_POSTURE;
    const m = await mount({ kind: 'service', posture: 'isolated' });
    const res = await put(m, KEY(RAW_EXMEMBER_KEY));
    expect(res.status).toBe(403);
    expect(m.settingRows()).toHaveLength(0);
  });
});

describe("#15351 — the RETURNED tenantId is vetted, not the caller's own stored claim", () => {
  // The half of this card that is not about admission: this seam hands
  // `authz.tenantId` onward as `SettingsContext.tenantId`, which reaches the
  // crypto handle context and both audit ledgers.

  it("drops a SESSION's stale organization claim instead of returning it", async () => {
    // `u_session_exmember` has no `sys_member` row; the session still carries
    // `activeOrganizationId: 'org_A'`. Under a wall the claim is DROPPED
    // (#15409 ruled option B — a session is a person, not a binding), so the
    // settings tenant is `undefined` rather than an organization the caller
    // left. Reachable here only because the posture is now supplied.
    const m = await mount({ kind: 'service', posture: 'isolated' });
    const ctx = await m.contextFromRequest({
      headers: { 'x-fixture-session-user': 'u_session_exmember' },
    } as any as IHttpRequest);
    expect(ctx.userId).toBe('u_session_exmember');
    expect(ctx.tenantId).toBeUndefined();
  });

  it('ABLATION — with no posture resolvable the same session keeps the stale claim', async () => {
    const m = await mount({ kind: 'no-async-registry' });
    const ctx = await m.contextFromRequest({
      headers: { 'x-fixture-session-user': 'u_session_exmember' },
    } as any as IHttpRequest);
    expect(ctx.userId).toBe('u_session_exmember');
    expect(ctx.tenantId).toBe('org_A');
  });

  it("CONTROL — a CURRENT member's session keeps its organization under the same posture", async () => {
    const m = await mount({ kind: 'service', posture: 'isolated' });
    const ctx = await m.contextFromRequest({
      headers: { 'x-fixture-session-user': 'u_member' },
    } as any as IHttpRequest);
    expect(ctx.tenantId).toBe('org_A');
  });

  it("CONTROL — a CURRENT member's KEY still carries its organization onward", async () => {
    const m = await mount({ kind: 'service', posture: 'isolated' });
    const ctx = await m.contextFromRequest({ headers: KEY(RAW_MEMBER_KEY) } as any as IHttpRequest);
    expect(ctx.tenantId).toBe('org_A');
  });

  it("the ex-member's key yields NO principal and NO tenant at all", async () => {
    const m = await mount({ kind: 'service', posture: 'isolated' });
    const ctx = await m.contextFromRequest({ headers: KEY(RAW_EXMEMBER_KEY) } as any as IHttpRequest);
    expect(ctx.userId).toBeUndefined();
    expect(ctx.tenantId).toBeUndefined();
    expect(ctx.enforced).toBe(true);
  });
});

describe('#15351 — decision 1 option A: a BROKEN tenancy service is an outage, not a quiet admit', () => {
  it('the seam raises the ADR-0112 503 envelope rather than resolving a context', async () => {
    const m = await mount({ kind: 'factory-throws' });
    // ⛔ `toThrow()` alone would pass for any error, including the `TypeError`
    // a careless dereference raises. The envelope is the claim.
    const err = await Promise.resolve(m.contextFromRequest({ headers: KEY(RAW_EXMEMBER_KEY) } as any))
      .then(() => undefined, (e: unknown) => e);
    expect(err).toBeDefined();
    expect((err as any).code).toBe(AUTHZ_STORE_UNAVAILABLE_CODE);
    expect((err as any).status).toBe(AUTHZ_STORE_UNAVAILABLE_STATUS);
    expect((err as any).object).toBe('tenancy');
  });

  it('the door does NOT admit, and nothing lands', async () => {
    const m = await mount({ kind: 'factory-throws' });
    const res = await put(m, KEY(RAW_EXMEMBER_KEY));
    // ⚠️ MEASURED, not endorsed: the settings route layer has no
    // `isAuthzStoreUnavailableError` arm, so the branded 503 the seam raises is
    // flattened into `500 INTERNAL_ERROR` here. That flattening is PRE-EXISTING
    // — #13279's permission-store re-raise already reached this same `else`
    // branch — and repairing the transport's envelope mapping is a different
    // defect from supplying the posture, so it is filed rather than ridden in.
    // What this card owns is pinned either way: the outage is NOT a quiet
    // admit.
    expect(res.status).toBe(500);
    expect(m.settingRows()).toHaveLength(0);
  });

  it('the GET listing is an outage too, never a silently empty list', async () => {
    const m = await mount({ kind: 'factory-throws' });
    const res = await listNs(m, KEY(RAW_MEMBER_KEY));
    expect(res.status).toBe(500);
  });
});
