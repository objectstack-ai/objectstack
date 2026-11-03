// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 40 — spawns the real producer once per single-cause fixture: one real-kernel boot under the `isolated` posture shared by every case plus one refused boot that is its case's subject; each boot carries ObjectQL, sqlite-wasm, Hono on port 0, auth, security, sharing, REST and the probe's plugin driver

/**
 * Under a walled tenancy posture every external object states its organization
 * scope — the reference probe, at the HTTP door, with two organizations.
 *
 * Composition: the plugin-driver spike's (`plugin-driver-external-object.spike.test.ts`)
 * plus the posture request `OS_TENANCY_POSTURE=isolated`, the platform owner
 * declaration a walled boot needs, and a stand-in `org-scoping` provider (the
 * same stand-in `@objectstack/verify`'s `multiTenant: 'posture-only'` mounts).
 * Two members, each in one organization, read the same objects.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { defineStack } from '@objectstack/spec';
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
const MEMBER_PASSWORD = 'Member-Pass-123';

const DATASOURCE = 'probe_remote';
/** States nothing about its organization scope — as the guide's example declares it. */
const UNDECLARED = 'probe_undeclared';
/** Declares its own `organization_id`. */
const WALLED = 'probe_walled';
/** Declares `tenancy: { enabled: false }`. */
const SHARED = 'probe_shared';
/** A local (platform-stored) object — the control. */
const LOCAL = 'probe_local';
const READER_SET = 'probe_reader';
const ORG_A = 'org_probe_a';
const ORG_B = 'org_probe_b';
const A_EMAIL = 'a@probe.test';
const B_EMAIL = 'b@probe.test';

type Row = Record<string, unknown>;
type Call = { method: string; object?: string; query?: unknown };

function matches(row: Row, where: unknown): boolean {
  if (where === undefined || where === null) return true;
  for (const [key, cond] of Object.entries(where as Record<string, unknown>)) {
    if (key === '$and') { if (!(cond as unknown[]).every((w) => matches(row, w))) return false; continue; }
    if (key.startsWith('$')) throw new Error(`probe remote: unsupported combinator ${key}`);
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      for (const [op, value] of Object.entries(cond as Record<string, unknown>)) {
        if (op === '$eq') { if (row[key] !== value) return false; continue; }
        if (op === '$in') { if (!(value as unknown[]).includes(row[key])) return false; continue; }
        throw new Error(`probe remote: unsupported operator ${op} on ${key}`);
      }
      continue;
    }
    if (row[key] !== cond) return false;
  }
  return true;
}

const refuse = (what: string) => async (): Promise<never> => { throw new Error(`probe driver: ${what} is not part of the probe`); };

function createProbeDriver(tables: Record<string, Row[]>, calls: Call[]) {
  const rowsOf = (object: string): Row[] => tables[object] ?? [];
  const driver = {
    name: DATASOURCE,
    version: '0.0.1',
    supports: { transactionsUnsupported: true },
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    execute: refuse('execute'),
    async find(object: string, query: DriverQuery = {}) {
      calls.push({ method: 'find', object, query: JSON.parse(JSON.stringify(query)) });
      const matched = rowsOf(object).filter((r) => matches(r, query.where));
      return matched.map((r) => ({ ...r }));
    },
    async findOne(object: string, query: DriverQuery = {}) {
      calls.push({ method: 'findOne', object, query: JSON.parse(JSON.stringify(query)) });
      const hit = rowsOf(object).find((r) => matches(r, query.where));
      return hit ? { ...hit } : null;
    },
    async count(object: string, query: DriverQuery = {}) {
      calls.push({ method: 'count', object, query: JSON.parse(JSON.stringify(query)) });
      return rowsOf(object).filter((r) => matches(r, query.where)).length;
    },
    create: refuse('create'), update: refuse('update'), upsert: refuse('upsert'), delete: refuse('delete'),
    bulkCreate: refuse('bulkCreate'), bulkUpdate: refuse('bulkUpdate'), bulkDelete: refuse('bulkDelete'),
    beginTransaction: refuse('beginTransaction'), commit: refuse('commit'), rollback: refuse('rollback'),
    async syncSchema() {},
    dropTable: refuse('dropTable'),
  };
  return driver as typeof driver & IDataDriver;
}

function driverPlugin(driver: IDataDriver): Plugin {
  return {
    name: 'com.probe.driver',
    version: '1.0.0',
    init: async (ctx: PluginContext) => { ctx.registerService(`driver.${driver.name}`, driver); },
  };
}

/** The `org-scoping` stand-in `@objectstack/verify` mounts for `multiTenant: 'posture-only'`. */
const orgScopingStandIn: Plugin & { supportedPostures: readonly string[] } = {
  name: 'com.probe.simulated-org-scoping',
  version: '1.0.0',
  providesServices: ['org-scoping'],
  supportedPostures: ['group', 'isolated'],
  init: async (ctx: PluginContext) => { ctx.registerService('org-scoping', orgScopingStandIn); },
};

const STACK = defineStack({
  manifest: { id: 'com.probe.external-scope', name: 'External scope probe', version: '1.0.0', type: 'app' },
  datasources: [
    {
      name: DATASOURCE, label: 'Probe remote', driver: DATASOURCE, schemaMode: 'external', config: {},
      external: { allowWrites: false, validation: { onMismatch: 'fail', checkOnBoot: false } },
    },
  ],
  objects: [
    {
      name: UNDECLARED, label: 'Undeclared', datasource: DATASOURCE, external: { remoteName: 'undeclared' },
      sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name' } },
    },
    {
      name: WALLED, label: 'Walled', datasource: DATASOURCE, external: { remoteName: 'walled' },
      sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name' }, organization_id: { type: 'text', label: 'Organization' } },
    },
    {
      name: SHARED, label: 'Shared', datasource: DATASOURCE, external: { remoteName: 'shared' },
      sharingModel: 'public_read_write', tenancy: { enabled: false },
      fields: { name: { type: 'text', label: 'Name' } },
    },
    {
      name: LOCAL, label: 'Local', sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name' } },
    },
  ],
  permissions: [
    {
      name: READER_SET, label: 'Probe reader',
      objects: {
        [UNDECLARED]: { allowRead: true }, [WALLED]: { allowRead: true },
        [SHARED]: { allowRead: true }, [LOCAL]: { allowRead: true, allowCreate: true },
      },
    },
  ],
});

const tables: Record<string, Row[]> = {
  [UNDECLARED]: [{ id: 'u_a', name: 'A undeclared' }, { id: 'u_b', name: 'B undeclared' }],
  [WALLED]: [
    { id: 'w_a', name: 'A walled', organization_id: ORG_A },
    { id: 'w_b', name: 'B walled', organization_id: ORG_B },
    { id: 'w_none', name: 'No organization' },
  ],
  [SHARED]: [{ id: 's_1', name: 'Shared 1' }, { id: 's_2', name: 'Shared 2' }],
};
const calls: Call[] = [];
const driver = createProbeDriver(tables, calls);

let kernel: ObjectKernel;
let httpServer: any;
let app: any;
let engine: any;
let tokenA: string;
let tokenB: string;
let bootError: unknown;
const prevEnv: Record<string, string | undefined> = {};

const req = (path: string, init?: RequestInit) => app.request(`${ORIGIN}${API}${path}`, init);
const as = (token: string, method: string, path: string, payload?: unknown) =>
  req(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}
async function signIn(email: string, password: string): Promise<string> {
  const res = await req('/auth/sign-in/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`probe signIn failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as any).token;
}
async function signUp(email: string, org: string): Promise<void> {
  await engine.insert('sys_invitation', {
    id: `inv_probe_${email.split('@')[0]}`, email, status: 'pending', organization_id: org,
    role: 'member', inviter_id: 'usr_probe_inviter', expires_at: new Date(Date.now() + 3_600_000),
  }, { context: { isSystem: true, tenantId: org } });
  const res = await req('/auth/sign-up/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: MEMBER_PASSWORD, name: email.split('@')[0] }),
  });
  if (!res.ok) throw new Error(`probe signUp failed: ${res.status} ${await res.text()}`);
}
async function userIdOf(email: string): Promise<string> {
  const users = await engine.find('sys_user', { where: { email }, limit: 1, context: { isSystem: true } });
  const id = users?.[0]?.id;
  if (typeof id !== 'string') throw new Error(`probe: no sys_user row for ${email}`);
  return id;
}
/** Make `email` a member of `org` holding the reader set, then sign in: the session carries the one membership. */
async function memberOf(email: string, org: string): Promise<string> {
  await signUp(email, org);
  const userId = await userIdOf(email);
  await engine.insert('sys_member', { id: `mem_${userId}`, organization_id: org, user_id: userId, role: 'member' }, { context: { isSystem: true, tenantId: org } });
  await engine.insert('sys_user_permission_set', { id: `ups_${userId}`, user_id: userId, permission_set: READER_SET, granted_by: null }, { context: { isSystem: true, tenantId: org } });
  return signIn(email, MEMBER_PASSWORD);
}

function compose(stack: unknown): ObjectKernel {
  const k = new ObjectKernel();
  // `use` is awaited in beforeAll; collected here so a refused boot composes the same way.
  (k as any).__probeUse = async () => {
    await k.use(new ObjectQLPlugin());
    await k.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
    await k.use(new HonoServerPlugin({ port: 0 }));
    await k.use(driverPlugin(driver));
    await k.use(orgScopingStandIn);
    await k.use(new AppPlugin(stack as any));
    await k.use(new PlatformObjectsPlugin());
    await k.use(new AuthPlugin({ secret: 'external-object-organization-scope-probe-secret' }));
    await k.use(new DatasourceAdminServicePlugin({ driverFactory: createDefaultDatasourceDriverFactory() }));
    await k.use(new ExternalDatasourceServicePlugin());
    await k.use(createExternalValidationPlugin());
    await k.use(new SecurityPlugin(appSecurityPluginOptions(stack as any)));
    await k.use(new SharingServicePlugin());
    await k.use(createRestApiPlugin({}));
    await k.use(createDispatcherPlugin({}));
  };
  return k;
}

beforeAll(async () => {
  for (const k of ['NODE_ENV', 'OS_TENANCY_POSTURE', 'OS_PLATFORM_OWNER_EMAIL']) prevEnv[k] = process.env[k];
  process.env.NODE_ENV = 'development';
  process.env.OS_TENANCY_POSTURE = 'isolated';
  process.env.OS_PLATFORM_OWNER_EMAIL = ADMIN.email;

  kernel = compose(STACK);
  await (kernel as any).__probeUse();
  try {
    await kernel.bootstrap();
  } catch (e) {
    bootError = e;
    return;
  }
  httpServer = await kernel.getServiceAsync('http-server');
  app = httpServer.getRawApp();
  engine = await kernel.getServiceAsync('objectql');
  await engine.insert('sys_organization', { id: ORG_A, name: 'Org A', slug: ORG_A }, { context: { isSystem: true } });
  await engine.insert('sys_organization', { id: ORG_B, name: 'Org B', slug: ORG_B }, { context: { isSystem: true } });
  tokenA = await memberOf(A_EMAIL, ORG_A);
  tokenB = await memberOf(B_EMAIL, ORG_B);
}, BOOT_TIMEOUT);

afterAll(async () => {
  try { await httpServer?.close?.(); } catch { /* best-effort */ }
  try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
  for (const [k, v] of Object.entries(prevEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}, 60_000);

const idsOf = (body: any): string[] => ((body?.records ?? body?.data ?? []) as Row[]).map((r) => String(r.id)).sort();

describe('BEFORE READINGS — the tree as found', () => {
  it('the boot came up (or did not), recorded', () => {
    // eslint-disable-next-line no-console
    console.log('[probe] boot error:', bootError instanceof Error ? bootError.message : bootError);
    expect(true).toBe(true);
  });

  it('the undeclared external object: what A and B read', async () => {
    if (bootError) return;
    const a = await as(tokenA, 'GET', `/data/${UNDECLARED}`);
    const b = await as(tokenB, 'GET', `/data/${UNDECLARED}`);
    const bodyA = await readJson(a); const bodyB = await readJson(b);
    // eslint-disable-next-line no-console
    console.log('[probe] undeclared: A', a.status, idsOf(bodyA), 'B', b.status, idsOf(bodyB), 'last driver where:', JSON.stringify(calls.filter((c) => c.object === UNDECLARED).at(-1)?.query));
  });

  it('the walled external object: what A and B read', async () => {
    if (bootError) return;
    const a = await as(tokenA, 'GET', `/data/${WALLED}`);
    const b = await as(tokenB, 'GET', `/data/${WALLED}`);
    const bodyA = await readJson(a); const bodyB = await readJson(b);
    // eslint-disable-next-line no-console
    console.log('[probe] walled: A', a.status, idsOf(bodyA), 'B', b.status, idsOf(bodyB), 'last driver where:', JSON.stringify(calls.filter((c) => c.object === WALLED).at(-1)?.query));
  });

  it('the shared external object and the local control', async () => {
    if (bootError) return;
    const s = await as(tokenA, 'GET', `/data/${SHARED}`);
    const bodyS = await readJson(s);
    await as(tokenA, 'POST', `/data/${LOCAL}`, { name: 'A local' });
    await as(tokenB, 'POST', `/data/${LOCAL}`, { name: 'B local' });
    const la = await as(tokenA, 'GET', `/data/${LOCAL}`);
    const lb = await as(tokenB, 'GET', `/data/${LOCAL}`);
    const bodyLa = await readJson(la); const bodyLb = await readJson(lb);
    // eslint-disable-next-line no-console
    console.log('[probe] shared: A', s.status, idsOf(bodyS), '| local: A', la.status, (bodyLa?.records ?? []).map((r: Row) => r.name), 'B', lb.status, (bodyLb?.records ?? []).map((r: Row) => r.name));
  });
});
