// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25693] An unclaimed file is served only within its organization.
 *
 * A file with neither an attachments scope nor a field owner (an upload no
 * record has claimed, or one whose owner let go) has no parent record to
 * derive access from. The download door asks for a signed-in caller first
 * (#22431), and then judges the file as every other organization-scoped row
 * is read: the organization wall's verdict for the posture in force, and the
 * driver's tenant term for the reach (`isWithinCallerOrganization`,
 * `storage-service-plugin.ts`). No organization comparison is written in
 * `@objectstack/service-storage`, so the posture alone decides who is in
 * reach.
 *
 * ## What is real
 *
 * One `ObjectQL` engine over `SqlDriver` (sqlite `:memory:`, the project's
 * ruled test backend) under the posture each block names, with the real
 * `StorageServicePlugin` booted and its door mounted exactly as it ships
 * (`start()` → `composeStorageRoutes`): the session gate, the download
 * authorizer and its `resolveRequestExecutionContext`, the real `sys_file` /
 * `sys_attachment` objects and a real local storage adapter. Each case calls
 * both download doors (`/files/:fileId/url` and `/files/:fileId`) and, where it
 * is served, follows the minted URL to the bytes.
 *
 * ## The stand-ins, and only these
 *
 *   - Authentication: an `auth` service whose session read answers the user
 *     and the active organization two test headers name.
 *   - The permission store `resolveAuthzContext` reads for the door's caller:
 *     `sys_member` answers the fixture's memberships (which is how a session's
 *     organization claim is vetted under a walled posture), and every other
 *     object this fixture never registered answers empty (no grants).
 *   - The `tenancy` service: the posture, and the engine is given the same one.
 *
 * `@objectstack/objectql` resolves through its `exports` to `dist/` here
 * (`KNOWN_UNALIASED_TEST_IMPORTS`); the subject of these pins is this
 * package's own source, imported relatively.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IStorageService, RouteHandler } from '@objectstack/spec/contracts';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { StorageServicePlugin } from './storage-service-plugin.js';

type Posture = 'single' | 'group' | 'isolated';

const BASE = '/api/v1/storage';
const URL_DOOR = `${BASE}/files/:fileId/url`;
const REDIRECT_DOOR = `${BASE}/files/:fileId`;
const RAW_DOOR = `${BASE}/_local/raw/:token`;

const ORG_A = 'org_a';
const ORG_B = 'org_b';

/** Member of `org_a`; uploaded every unclaimed file below. */
const UPLOADER = 'u_uploader';
/** Member of `org_a`; not the uploader. */
const COLLEAGUE = 'u_colleague';
/** Member of `org_b` only. */
const OUTSIDER = 'u_outsider';
/** A member of no organization. */
const NO_ORGANIZATION = 'u_no_org';
/** Member of `org_b` only, whose session still names `org_a`. */
const FORMER_MEMBER = 'u_former';
/** Member of both organizations. */
const BOTH = 'u_both';

const MEMBERSHIPS: Array<{ user_id: string; organization_id: string }> = [
  { user_id: UPLOADER, organization_id: ORG_A },
  { user_id: COLLEAGUE, organization_id: ORG_A },
  { user_id: OUTSIDER, organization_id: ORG_B },
  { user_id: FORMER_MEMBER, organization_id: ORG_B },
  { user_id: BOTH, organization_id: ORG_A },
  { user_id: BOTH, organization_id: ORG_B },
];

/** Unclaimed: the default `user` scope, no field owner. */
const F_UNCLAIMED = 'f_unclaimed_aa';
/** Unclaimed, opted into anonymous download. */
const F_PUBLIC = 'f_public_ab';
/** Attachments scope, attached to an `org_a` record, uploaded by someone else. */
const F_ATTACHED = 'f_attached_ac';

const silentLogger = () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child() { return this; },
});

/** The fixture's ONE where-matcher for `sys_member`: equality on the keys the resolver reads. */
function membershipsWhere(where: unknown): Array<Record<string, unknown>> {
  const w = (where ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(w)) {
    if (key !== 'user_id' && key !== 'organization_id') {
      throw new Error(`fixture sys_member matcher: unsupported key '${key}'`);
    }
  }
  return MEMBERSHIPS.filter((m) => Object.entries(w).every(([k, v]) => (m as Record<string, unknown>)[k] === v));
}

function makeHttpServer() {
  const routes = new Map<string, RouteHandler>();
  const put = (m: string) => (path: string, handler: RouteHandler) => { routes.set(`${m}:${path}`, handler); };
  return {
    routes,
    server: {
      get: put('GET'), post: put('POST'), put: put('PUT'),
      delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    },
  };
}

interface Harness {
  engine: ObjectQL;
  routes: Map<string, RouteHandler>;
  rootDir: string;
}

async function boot(posture: Posture): Promise<Harness> {
  const rootDir = join(tmpdir(), `os-25693-${posture}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });

  const engine = new ObjectQL({ logger: silentLogger() } as any);
  engine.registerDriver(new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }) as any, true);
  await engine.init();
  engine.setTenancyPostureProvider(() => posture);

  // The data door the plugin is handed: the real engine, except for the
  // permission store `resolveAuthzContext` reads, which this fixture never
  // registers — `sys_member` answers the fixture's memberships, everything
  // else answers empty.
  const dataEngine = new Proxy(engine, {
    get(target, prop) {
      if (prop === 'find') {
        return (object: string, query?: EngineQueryOptions) => {
          if (target.getSchema(object)) return target.find(object, query);
          return Promise.resolve(object === 'sys_member' ? membershipsWhere(query?.where) : []);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  const services = new Map<string, unknown>();
  const hooks: Array<() => Promise<void> | void> = [];
  const http = makeHttpServer();
  const ctx = {
    logger: silentLogger(),
    registerService: (name: string, svc: unknown) => { services.set(name, svc); },
    getService: <T>(name: string): T => {
      if (!services.has(name)) throw new Error(`service '${name}' not registered`);
      return services.get(name) as T;
    },
    getServiceAsync: async <T>(name: string): Promise<T> => {
      if (!services.has(name)) throw new Error(`service '${name}' not registered`);
      return services.get(name) as T;
    },
    hook: (event: string, fn: () => Promise<void> | void) => {
      if (event === 'kernel:ready') hooks.push(fn);
    },
  };
  ctx.registerService('objectql', dataEngine);
  ctx.registerService('http-server', http.server);
  ctx.registerService('tenancy', { posture });
  // The plugin registers the real `sys_file` / `sys_attachment` through this.
  ctx.registerService('manifest', { register: (manifest: any) => engine.registerApp(manifest) });
  ctx.registerService('auth', {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const userId = headers.get('x-test-user');
        if (!userId) return undefined;
        const activeOrganizationId = headers.get('x-test-org') ?? undefined;
        return { user: { id: userId }, session: { activeOrganizationId } };
      },
    },
  });

  const plugin = new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false });
  await plugin.init(ctx as any);
  engine.registerApp({
    id: 'com.objectstack.test.unclaimed-file-organization-scope',
    name: 'Unclaimed file organization scope',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [{ name: 'xorg_case', label: 'Case', fields: { title: { name: 'title', type: 'text' } } }],
  } as never);
  await engine.syncSchemas();

  // Every row below is written for `org_a`, the way the upload door writes it:
  // the acting organization as the system insert's `tenantId`.
  const inA = { context: { isSystem: true, tenantId: ORG_A } };
  const fileRow = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    key: `user/${id}.txt`,
    name: `${id}.txt`,
    size: 12,
    mime_type: 'text/plain',
    scope: 'user',
    acl: 'private',
    status: 'committed',
    owner_id: UPLOADER,
    ...extra,
  });
  await engine.insert('sys_file', fileRow(F_UNCLAIMED) as any, inA);
  await engine.insert('sys_file', fileRow(F_PUBLIC, { acl: 'public_read' }) as any, inA);
  await engine.insert(
    'sys_file',
    fileRow(F_ATTACHED, { key: `attachments/${F_ATTACHED}.txt`, scope: 'attachments', owner_id: 'u_someone_else' }) as any,
    inA,
  );
  await engine.insert('xorg_case', { id: 'case_a', title: 'A' } as any, inA);
  await engine.insert('sys_attachment', {
    id: 'att_a', file_id: F_ATTACHED, parent_object: 'xorg_case', parent_id: 'case_a',
    file_name: `${F_ATTACHED}.txt`, mime_type: 'text/plain', size: 12,
  } as any, inA);

  await plugin.start(ctx as any);
  for (const h of hooks) await h();

  const storage = ctx.getService<IStorageService>('storage');
  for (const id of [F_UNCLAIMED, F_PUBLIC]) await storage.upload(`user/${id}.txt`, Buffer.from(`bytes of ${id}`));
  await storage.upload(`attachments/${F_ATTACHED}.txt`, Buffer.from(`bytes of ${F_ATTACHED}`));

  return { engine, routes: http.routes, rootDir };
}

async function teardown(h: Harness | undefined): Promise<void> {
  if (!h) return;
  try { await h.engine.destroy(); } catch { /* already torn down */ }
  await fs.rm(h.rootDir, { recursive: true, force: true });
}

interface DoorAnswer {
  url: { status: number; code: string | undefined; body: unknown };
  redirect: { status: number; code: string | undefined; location: string | undefined };
  /** The bytes behind the minted URL, when one was minted. */
  bytes?: string;
}

function makeRes() {
  const res: any = {
    _status: 200, _json: undefined, _headers: {} as Record<string, string>, _sent: undefined,
    json(data: any) { res._json = data; return res; },
    send(data: any) { res._sent = data; return res; },
    status(code: number) { res._status = code; return res; },
    header(name: string, value: string) { res._headers[name] = value; return res; },
  };
  return res;
}

/** What both download doors tell `caller` (or an anonymous request) about one file. */
async function ask(
  h: Harness,
  fileId: string,
  caller?: { user: string; org?: string },
): Promise<DoorAnswer> {
  const headers: Record<string, string> = {};
  if (caller) {
    headers['x-test-user'] = caller.user;
    if (caller.org) headers['x-test-org'] = caller.org;
  }
  const call = async (route: string, params: Record<string, string>) => {
    const res = makeRes();
    await h.routes.get(`GET:${route}`)!({ params, query: {}, headers, method: 'GET', path: route } as any, res);
    return res;
  };
  const url = await call(URL_DOOR, { fileId });
  const redirect = await call(REDIRECT_DOOR, { fileId });
  const answer: DoorAnswer = {
    url: { status: url._status, code: url._json?.error?.code, body: url._json },
    redirect: { status: redirect._status, code: redirect._json?.error?.code, location: redirect._headers.Location },
  };
  const minted: string | undefined = url._json?.data?.url;
  if (minted) {
    const raw = await call(RAW_DOOR, { token: minted.split('/').pop()! });
    answer.bytes = Buffer.isBuffer(raw._sent) ? raw._sent.toString('utf8') : String(raw._sent);
  }
  return answer;
}

/** Both doors refused with one status and code, no URL minted, nothing about the file disclosed. */
function expectRefused(a: DoorAnswer, status: number, code: string, label: string) {
  expect(a.url.status, `${label}: url door`).toBe(status);
  expect(a.url.code, `${label}: url door`).toBe(code);
  expect(a.redirect.status, `${label}: redirect door`).toBe(status);
  expect(a.redirect.code, `${label}: redirect door`).toBe(code);
  expect(a.redirect.location, `${label}: redirect door`).toBeUndefined();
  expect(a.bytes, label).toBeUndefined();
  const text = JSON.stringify(a.url.body);
  for (const secret of [ORG_A, UPLOADER, '.txt']) expect(text.includes(secret), `${label}: ${secret}`).toBe(false);
}

/** Both doors served, and the minted URL carries the file's own bytes. */
function expectServed(a: DoorAnswer, fileId: string, label: string) {
  expect(a.url.status, `${label}: url door`).toBe(200);
  expect(a.redirect.status, `${label}: redirect door`).toBe(302);
  expect(a.redirect.location, `${label}: redirect door`).toContain('/_local/raw/');
  expect(a.bytes, label).toBe(`bytes of ${fileId}`);
}

describe('[#25693] an unclaimed file is served only within its organization — isolated posture', () => {
  let h: Harness;
  beforeAll(async () => { h = await boot('isolated'); });
  afterAll(async () => { await teardown(h); });

  it('PREMISE: the file is unclaimed, committed and written for org_a', async () => {
    const row = await h.engine.findOne('sys_file', { where: { id: F_UNCLAIMED } }, { context: { isSystem: true, tenantId: ORG_A } });
    expect(row).toMatchObject({ scope: 'user', acl: 'private', status: 'committed', owner_id: UPLOADER, organization_id: ORG_A });
    expect(row?.ref_object ?? null).toBeNull();
  });

  it('is refused to a caller acting in another organization: 403 FILE_DOWNLOAD_DENIED at both doors', async () => {
    expectRefused(await ask(h, F_UNCLAIMED, { user: OUTSIDER, org: ORG_B }), 403, 'FILE_DOWNLOAD_DENIED', 'other organization');
  });

  it('is refused to a signed-in caller who acts in no organization', async () => {
    expectRefused(await ask(h, F_UNCLAIMED, { user: NO_ORGANIZATION }), 403, 'FILE_DOWNLOAD_DENIED', 'no organization');
  });

  it("is refused to a caller whose session names the file's organization without a membership in it", async () => {
    expectRefused(await ask(h, F_UNCLAIMED, { user: FORMER_MEMBER, org: ORG_A }), 403, 'FILE_DOWNLOAD_DENIED', 'claim without membership');
  });

  it('answers the refusal the door gives a parent-governed file the caller may not read: same status, code family, no record named', async () => {
    const unclaimed = await ask(h, F_UNCLAIMED, { user: OUTSIDER, org: ORG_B });
    const attached = await ask(h, F_ATTACHED, { user: OUTSIDER, org: ORG_B });
    expect(unclaimed.url.status).toBe(attached.url.status);
    expect(attached.url.code).toBe('ATTACHMENT_DOWNLOAD_DENIED');
    expect(unclaimed.url.code).toBe('FILE_DOWNLOAD_DENIED');
  });

  it('is served to a member of its organization who did not upload it', async () => {
    expectServed(await ask(h, F_UNCLAIMED, { user: COLLEAGUE, org: ORG_A }), F_UNCLAIMED, 'colleague');
  });

  it('is served to its uploader acting in its organization', async () => {
    expectServed(await ask(h, F_UNCLAIMED, { user: UPLOADER, org: ORG_A }), F_UNCLAIMED, 'uploader');
  });

  it('is served to its uploader acting elsewhere: the owner rule every private file follows', async () => {
    expectServed(await ask(h, F_UNCLAIMED, { user: UPLOADER, org: ORG_B }), F_UNCLAIMED, 'uploader elsewhere');
    expectServed(await ask(h, F_UNCLAIMED, { user: UPLOADER }), F_UNCLAIMED, 'uploader in no organization');
  });

  it('is refused to an anonymous caller 401 AUTH_REQUIRED, as before', async () => {
    expectRefused(await ask(h, F_UNCLAIMED), 401, 'AUTH_REQUIRED', 'anonymous');
  });

  it("CONTROL: an acl: 'public_read' file is still served to anyone, signed in or not", async () => {
    expectServed(await ask(h, F_PUBLIC, { user: OUTSIDER, org: ORG_B }), F_PUBLIC, 'public, other organization');
    expectServed(await ask(h, F_PUBLIC), F_PUBLIC, 'public, anonymous');
  });

  it('CONTROL: an attached file keeps its parent-derived verdict', async () => {
    expectRefused(await ask(h, F_ATTACHED, { user: OUTSIDER, org: ORG_B }), 403, 'ATTACHMENT_DOWNLOAD_DENIED', 'attached, other organization');
    expectServed(await ask(h, F_ATTACHED, { user: COLLEAGUE, org: ORG_A }), F_ATTACHED, 'attached, colleague');
  });
});

describe('[#25693] the posture in force decides the reach — group posture', () => {
  let h: Harness;
  beforeAll(async () => { h = await boot('group'); });
  afterAll(async () => { await teardown(h); });

  it("is served to a member of the file's organization acting in another of their organizations", async () => {
    expectServed(await ask(h, F_UNCLAIMED, { user: BOTH, org: ORG_B }), F_UNCLAIMED, 'member of both');
  });

  it('is refused to a caller who holds no membership in its organization', async () => {
    expectRefused(await ask(h, F_UNCLAIMED, { user: OUTSIDER, org: ORG_B }), 403, 'FILE_DOWNLOAD_DENIED', 'other organization');
  });
});

describe('[#25693] the single posture is unchanged — one tenant, no wall', () => {
  let h: Harness;
  beforeAll(async () => { h = await boot('single'); });
  afterAll(async () => { await teardown(h); });

  it('is served to every signed-in caller, whatever organization the session names', async () => {
    expectServed(await ask(h, F_UNCLAIMED, { user: OUTSIDER, org: ORG_B }), F_UNCLAIMED, 'session naming another organization');
    expectServed(await ask(h, F_UNCLAIMED, { user: NO_ORGANIZATION }), F_UNCLAIMED, 'no organization');
    expectServed(await ask(h, F_UNCLAIMED, { user: COLLEAGUE, org: ORG_A }), F_UNCLAIMED, 'colleague');
  });

  it('is still refused to an anonymous caller 401 AUTH_REQUIRED', async () => {
    expectRefused(await ask(h, F_UNCLAIMED), 401, 'AUTH_REQUIRED', 'anonymous');
  });
});
