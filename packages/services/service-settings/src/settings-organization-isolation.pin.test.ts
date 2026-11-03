// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_setting` rows belong to ONE organization — the identity the object
 * declares, `(organization_id, namespace, key, scope, user_id)`, carried by the
 * service that writes and reads them.
 *
 * ## Why the service has to carry it
 *
 * `SettingsService` reads and writes its store under its own system context,
 * which names no organization. Nothing downstream scopes such a call: the
 * driver's tenant scope needs a `tenantId` on the context, and the security
 * layer's organization wall stands aside for a system caller. So the
 * organization is in the service's own `where` and in every row it writes, or
 * it is nowhere.
 *
 * ## What is pinned
 *
 *  - identity: a tenant-scope or user-scope row carries the writing caller's
 *    organization, and a write by one organization neither reads, nor
 *    replaces, nor resets another's;
 *  - the cascade: a caller reads its own organization's row and no other — a
 *    row written with no organization is no organization's fallback (ADR-0131
 *    D8), under a wall and under `single` alike — and the global rung is read
 *    by every organization;
 *  - the lock pre-flight reads the same row the cascade does;
 *  - a locked row binds every writer below the platform rung — at an upper
 *    rung as before, and at the write's own rung too: an organization's
 *    administrator cannot save over its own organization's locked tenant row,
 *    nor over a locked global row, while a platform administrator
 *    (`manage_platform_settings`) and a trusted in-process caller still write
 *    through, and the row keeps its lock — through the service and through the
 *    settings route alike;
 *  - the refusal: under a walled posture a tenant-scope write that names no
 *    organization is refused whole, and writes nothing; under `single` it is
 *    not;
 *  - `single`: a process-wide reader that names no organization reads and
 *    writes as the one organization ADR-0131 D9 derives, so the default
 *    organization keeps its answers and a second organization-less write
 *    replaces the first instead of inserting beside it; where D9 derives none,
 *    such a reader has no tenant rung and its tenant write is refused;
 *  - a composition with no organization object (the lean embedding) keeps
 *    storing and reading its rows with no organization;
 *  - the posture is asked only for a caller that names no organization, on a
 *    key below the global rung — and when it cannot be read, that read or
 *    write fails rather than guessing.
 *
 * Driven over a REAL `ObjectQL` engine through the plugin's own adapter
 * (`wrapEngineAsSettingsEngine`); only the driver is a Map. Its matcher is
 * deliberately strict — equality and `$or` only, anything else refuses — so a
 * query shape it cannot express fails here instead of reading as "no row".
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { ObjectQL } from '@objectstack/objectql';
import { SysUser } from '@objectstack/platform-objects/identity';
import { SysPlatformSetting, SysSetting } from '@objectstack/platform-objects/system';
import type { TenancyPosture } from '@objectstack/spec/security';
import { SettingsService, type SettingsOrganizationSource } from './settings-service.js';
import { wrapEngineAsSettingsEngine } from './settings-service-plugin.js';
import { SettingsLockedError, type SettingsContext } from './settings-service.types.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { companySettingsManifest } from './manifests/company.manifest.js';

const SYS = { context: { isSystem: true } } as const;
const NS = 'org_isolation_fixture';
const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';

/** A driver over plain Maps. Equality and `$or` only; any other operator refuses. */
function makeMemoryDriver() {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  let nextId = 0;
  const rowsOf = (object: string) => {
    let s = store.get(object);
    if (!s) { s = new Map(); store.set(object, s); }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === '$or') return (v as any[]).some((b) => matches(row, b));
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v !== null && typeof v === 'object') throw new Error(`fake driver: unsupported condition on '${k}'`);
      return (row[k] ?? null) === (v ?? null);
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      const hits = [...rowsOf(object).values()].filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? hits.slice(0, ast.limit) : hits;
      return page.map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      for (const r of rowsOf(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const row = { ...data, id: (data.id as string) ?? `row_${nextId}` };
      rowsOf(object).set(row.id as string, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = rowsOf(object);
      const cur = s.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      s.set(id, next);
      return { ...next };
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const hits = await this.find(object, ast);
      const s = rowsOf(object);
      for (const r of hits) s.set(r.id as string, { ...s.get(r.id as string), ...data, id: r.id });
      return hits.length;
    },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async syncSchema() {}, async dropTable() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rowsOf };
}

const MANIFEST = {
  namespace: NS,
  label: 'Organization isolation fixture',
  scope: 'tenant',
  specifiers: [
    { key: 'motto', type: 'text', label: 'Motto', scope: 'tenant', default: 'none' },
    { key: 'banner', type: 'text', label: 'Banner', scope: 'global', default: 'none' },
    { key: 'theme', type: 'text', label: 'Theme', scope: 'user', default: 'light' },
  ],
} as any;

let engine: ObjectQL;
let rowsOf: (object: string) => Map<string, Record<string, unknown>>;
let userId: string;

beforeEach(async () => {
  engine = new ObjectQL();
  const memory = makeMemoryDriver();
  rowsOf = memory.rowsOf;
  engine.registerDriver(memory.driver, true);
  await engine.init();
  for (const o of [SysUser, SysSetting, SysPlatformSetting]) {
    engine.registry.registerObject(o as any, '@objectstack/platform-objects');
  }
  const user = await engine.insert('sys_user', { name: 'Ada', email: 'ada@example.test' }, SYS);
  userId = String((user as any).id);
});

/**
 * ADR-0131 D9's answers, as the plugin's source hands them to the service: the
 * one organization derived, none derivable, or no organization object at all.
 */
const derived = (organizationId: string): SettingsOrganizationSource =>
  async () => ({ kind: 'derived', organizationId });
const NONE_DERIVABLE: SettingsOrganizationSource =
  async () => ({ kind: 'refuse', reason: 'no-organization', organizationCount: 0 });
const NO_ORGANIZATION_OBJECT: SettingsOrganizationSource = async () => ({ kind: 'no-organization-object' });

/**
 * A service bound to the real engine, under the given posture and with the
 * given answer for a caller that names no organization — by default a
 * composition with no organization object, which is what this rig registers.
 */
function settings(
  posture: TenancyPosture | undefined,
  organization: SettingsOrganizationSource = NO_ORGANIZATION_OBJECT,
): SettingsService {
  const svc = new SettingsService({ env: {} });
  svc.registerManifest(MANIFEST);
  svc.bindEngine(wrapEngineAsSettingsEngine(engine as any), undefined, {
    tenancyPosture: () => posture,
    organization,
  });
  return svc;
}

/** A row put straight into the store, as an earlier writer left it. */
async function seed(row: Record<string, unknown>): Promise<void> {
  await engine.insert('sys_setting', {
    namespace: NS, value_enc: null, encrypted: false, locked: false, locked_reason: null,
    user_id: null, ...row,
  }, SYS);
}

const settingRows = () => [...rowsOf('sys_setting').values()];
const inOrg = (organization: string, extra: SettingsContext = {}): SettingsContext => ({
  tenantId: organization, ...extra,
});

describe('a tenant-scope value belongs to the organization that wrote it (walled posture)', () => {
  it('a tenant-scope value written by one organization is not read by another', async () => {
    const svc = settings('isolated');
    await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));

    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).value).toBe('Alpha');
    const other = await svc.get(NS, 'motto', inOrg(ORG_B));
    expect(other.value).toBe('none');
    expect(other.source).toBe('default');
  });

  it('each organization reads its own value, and one organization\'s write leaves the other\'s unchanged', async () => {
    const svc = settings('isolated');
    await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));
    await svc.set(NS, 'motto', 'Beta', inOrg(ORG_B));

    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).value).toBe('Alpha');
    expect((await svc.get(NS, 'motto', inOrg(ORG_B))).value).toBe('Beta');
    // Two rows, each carrying the organization that wrote it — the second write
    // did not find, and rewrite, the first organization's row.
    expect(
      settingRows().map((r) => [r.organization_id, r.value]).sort(),
    ).toEqual([[ORG_A, 'Alpha'], [ORG_B, 'Beta']]);
  });

  it('one organization\'s reset leaves the other\'s value unchanged', async () => {
    const svc = settings('isolated');
    await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));
    await svc.set(NS, 'motto', 'Beta', inOrg(ORG_B));

    await svc.runAction(NS, 'reset', null, inOrg(ORG_A));

    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).source).toBe('default');
    const other = await svc.get(NS, 'motto', inOrg(ORG_B));
    expect(other.value).toBe('Beta');
    expect(other.source).toBe('tenant');
  });

  it('getMany and getNamespace answer per organization exactly as get does', async () => {
    const svc = settings('isolated');
    await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));
    await svc.set(NS, 'motto', 'Beta', inOrg(ORG_B));

    expect((await svc.getMany(NS, ['motto'], inOrg(ORG_A))).motto.value).toBe('Alpha');
    expect((await svc.getNamespace(NS, inOrg(ORG_B))).values.motto.value).toBe('Beta');
  });

  it('a global row is read by both organizations', async () => {
    const svc = settings('isolated');
    // A global key names no organization and is not refused under the wall.
    await svc.set(NS, 'banner', 'Everyone', {});

    for (const org of [ORG_A, ORG_B]) {
      const got = await svc.get(NS, 'banner', inOrg(org));
      expect(got.value).toBe('Everyone');
      expect(got.source).toBe('global');
    }
  });

  it('a row written with no organization answers no organization, and an organization\'s write lands beside it', async () => {
    await seed({ key: 'motto', scope: 'tenant', value: 'Legacy', organization_id: null });
    await seed({ key: 'theme', scope: 'user', user_id: userId, value: 'Legacy-dark', organization_id: null });
    const svc = settings('isolated');

    for (const org of [ORG_A, ORG_B]) {
      const got = await svc.get(NS, 'motto', inOrg(org));
      expect(got.value).toBe('none');
      expect(got.source).toBe('default');
      expect(got.cascadeChain?.some((e) => e.scope === 'tenant')).toBe(false);
      // The user rung likewise: the same user's organization-less row is not
      // their value in any organization.
      expect((await svc.getMany(NS, ['theme'], inOrg(org, { userId }))).theme.value).toBe('light');
    }

    await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));
    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).value).toBe('Alpha');
    expect((await svc.get(NS, 'motto', inOrg(ORG_B))).source).toBe('default');
    // The organization's write did not find, and rewrite, the organization-less row.
    expect(
      settingRows().filter((r) => r.key === 'motto').map((r) => [r.organization_id ?? null, r.value]).sort(),
    ).toEqual([[null, 'Legacy'], [ORG_A, 'Alpha']]);
  });

  it('a lock on a row written with no organization locks no organization\'s write', async () => {
    await seed({ key: 'theme', scope: 'tenant', value: 'dark', organization_id: null, locked: true });
    const svc = settings('isolated');
    await expect(svc.set(NS, 'theme', 'blue', inOrg(ORG_A, { userId }))).resolves.toBeDefined();
    expect((await svc.get(NS, 'theme', inOrg(ORG_A, { userId }))).value).toBe('blue');
  });

  it('a user-scope value carries the organization too: the same user reads it only in the organization it was set in', async () => {
    const svc = settings('isolated');
    await svc.set(NS, 'theme', 'dark', inOrg(ORG_A, { userId }));

    expect((await svc.get(NS, 'theme', inOrg(ORG_A, { userId }))).value).toBe('dark');
    expect((await svc.get(NS, 'theme', inOrg(ORG_B, { userId }))).value).toBe('light');
    expect(settingRows().map((r) => [r.scope, r.user_id, r.organization_id])).toEqual([['user', userId, ORG_A]]);
  });

  it('a lock on one organization\'s tenant row does not lock another organization\'s write', async () => {
    await seed({ key: 'theme', scope: 'tenant', value: 'dark', organization_id: ORG_A, locked: true });
    const svc = settings('isolated');

    await expect(svc.set(NS, 'theme', 'blue', inOrg(ORG_A, { userId }))).rejects.toBeInstanceOf(SettingsLockedError);
    await expect(svc.set(NS, 'theme', 'blue', inOrg(ORG_B, { userId }))).resolves.toBeDefined();
  });
});

/**
 * An organization's administrator: verified, holding the namespace's read and
 * write capabilities, inside its own organization — and not the platform.
 */
const orgAdmin = (organization: string): SettingsContext => ({
  enforced: true,
  permissions: ['setup.access', 'setup.write'],
  userId: `usr_admin_${organization}`,
  tenantId: organization,
});
/** A platform administrator, working inside an organization. */
const platformAdmin = (organization: string): SettingsContext => ({
  enforced: true,
  permissions: ['setup.access', 'setup.write', 'manage_platform_settings'],
  userId: 'usr_platform_admin',
  tenantId: organization,
});

/** A row put straight into the global rung's store, as the platform left it. */
async function seedGlobal(row: Record<string, unknown>): Promise<void> {
  await engine.insert('sys_platform_setting', {
    namespace: NS, value_enc: null, encrypted: false, locked: false, locked_reason: null, ...row,
  }, SYS);
}

/** The refusal a write ends in, or `null` when it lands. */
const refusalOf = (write: Promise<unknown>): Promise<any> => write.then(() => null, (e) => e);

describe('a locked row binds every writer below the platform rung', () => {
  const LOCK = { key: 'motto', scope: 'tenant', value: 'Platform motto', locked: true, locked_reason: 'Set by the platform.' };

  it('an organization administrator\'s save over its own organization\'s locked tenant row is refused, and the value is unchanged', async () => {
    await seed({ ...LOCK, organization_id: ORG_A });
    const svc = settings('isolated');

    const refusal = await refusalOf(svc.setMany(NS, { motto: 'Org A override' }, orgAdmin(ORG_A)));
    expect(refusal).toBeInstanceOf(SettingsLockedError);
    expect(refusal.code).toBe('SETTINGS_LOCKED');
    expect(refusal.reason).toBe('locked-by-tenant');
    expect(refusal.key).toBe('motto');

    const after = await svc.get(NS, 'motto', inOrg(ORG_A));
    expect(after.value).toBe('Platform motto');
    expect(settingRows().map((r) => [r.organization_id, r.value, r.locked])).toEqual([[ORG_A, 'Platform motto', true]]);
  });

  it('a reset over the locked row is a write too, and is refused the same way', async () => {
    await seed({ ...LOCK, organization_id: ORG_A });
    const svc = settings('isolated');

    const refusal = await refusalOf(svc.setMany(NS, { motto: null }, orgAdmin(ORG_A)));
    expect(refusal?.code).toBe('SETTINGS_LOCKED');
    expect(refusal?.reason).toBe('locked-by-tenant');
    const reset = await refusalOf(svc.runAction(NS, 'reset', null, orgAdmin(ORG_A)));
    expect(reset?.code).toBe('SETTINGS_LOCKED');
    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).value).toBe('Platform motto');
  });

  it('what the read reports as locked is what the write refuses: get, getMany and getNamespace all say locked', async () => {
    await seed({ ...LOCK, organization_id: ORG_A });
    const svc = settings('isolated');
    const ctx = orgAdmin(ORG_A);

    const one = await svc.get(NS, 'motto', ctx);
    expect(one.locked).toBe(true);
    expect(one.lockedReason).toBe('Set by the platform.');
    expect((await svc.getMany(NS, ['motto'], ctx)).motto.locked).toBe(true);
    expect((await svc.getNamespace(NS, ctx)).values.motto.locked).toBe(true);
    expect((await refusalOf(svc.set(NS, 'motto', 'x', ctx)))?.code).toBe('SETTINGS_LOCKED');
  });

  it('a platform administrator writes through the lock, and the row keeps its lock', async () => {
    await seed({ ...LOCK, organization_id: ORG_A });
    const svc = settings('isolated');

    await svc.setMany(NS, { motto: 'Platform motto, revised' }, platformAdmin(ORG_A));
    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).value).toBe('Platform motto, revised');
    expect(settingRows().map((r) => [r.organization_id, r.value, r.locked])).toEqual([
      [ORG_A, 'Platform motto, revised', true],
    ]);
    // The lock still binds the organization's administrator after that write.
    expect((await refusalOf(svc.set(NS, 'motto', 'Org A override', orgAdmin(ORG_A))))?.code).toBe('SETTINGS_LOCKED');
  });

  it('a trusted in-process caller writes through the lock', async () => {
    await seed({ ...LOCK, organization_id: ORG_A });
    const svc = settings('isolated');

    await svc.set(NS, 'motto', 'Seeded by the platform', inOrg(ORG_A));
    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).value).toBe('Seeded by the platform');
  });

  it('another organization\'s administrator is not bound by it', async () => {
    await seed({ ...LOCK, organization_id: ORG_A });
    const svc = settings('isolated');

    await svc.setMany(NS, { motto: 'Org B value' }, orgAdmin(ORG_B));
    expect((await svc.get(NS, 'motto', inOrg(ORG_B))).value).toBe('Org B value');
    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).value).toBe('Platform motto');
  });

  it('an unlocked tenant row is saved over as before', async () => {
    await seed({ ...LOCK, organization_id: ORG_A, locked: false });
    const svc = settings('isolated');

    await svc.setMany(NS, { motto: 'Org A value' }, orgAdmin(ORG_A));
    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).value).toBe('Org A value');
  });

  it('a locked global row refuses a non-platform write of the global key, and the platform administrator writes through it', async () => {
    await seedGlobal({ key: 'banner', value: 'Platform banner', locked: true, locked_reason: 'Set by the platform.' });
    const svc = settings('isolated');

    const refusal = await refusalOf(svc.setMany(NS, { banner: 'Org A banner' }, orgAdmin(ORG_A)));
    expect(refusal?.code).toBe('SETTINGS_LOCKED');
    expect(refusal?.reason).toBe('locked-by-global');
    expect((await svc.get(NS, 'banner', inOrg(ORG_A))).value).toBe('Platform banner');

    await svc.setMany(NS, { banner: 'Platform banner, revised' }, platformAdmin(ORG_A));
    const after = await svc.get(NS, 'banner', inOrg(ORG_B));
    expect(after.value).toBe('Platform banner, revised');
    expect(after.locked).toBe(true);
  });

  it('a locked upper rung still refuses the platform administrator\'s write below it', async () => {
    await seedGlobal({ key: 'motto', value: 'Platform motto', locked: true, locked_reason: 'Set by the platform.' });
    const svc = settings('isolated');

    const refusal = await refusalOf(svc.setMany(NS, { motto: 'Org A motto' }, platformAdmin(ORG_A)));
    expect(refusal?.code).toBe('SETTINGS_LOCKED');
    expect(refusal?.reason).toBe('locked-by-global');
  });

  it('the user rung carries no lock: the read reports none and the owner\'s write is not refused', async () => {
    await seed({ key: 'theme', scope: 'user', user_id: userId, value: 'dark', organization_id: ORG_A, locked: true });
    const svc = settings('isolated');
    const ctx: SettingsContext = { ...orgAdmin(ORG_A), userId };

    expect((await svc.get(NS, 'theme', ctx)).locked).toBe(false);
    await svc.setMany(NS, { theme: 'blue' }, ctx);
    expect((await svc.get(NS, 'theme', ctx)).value).toBe('blue');
  });

  it('the in-memory store keeps the lock through the platform\'s write as the engine does', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(MANIFEST);
    await (svc as any).upsertRow({
      namespace: NS, key: 'motto', scope: 'tenant', user_id: null, organization_id: ORG_A,
      value: 'Platform motto', value_enc: null, encrypted: false, locked: true, locked_reason: 'Set by the platform.',
    });

    expect((await refusalOf(svc.set(NS, 'motto', 'Org A override', orgAdmin(ORG_A))))?.reason).toBe('locked-by-tenant');
    await svc.set(NS, 'motto', 'Platform motto, revised', platformAdmin(ORG_A));
    const after = await svc.get(NS, 'motto', inOrg(ORG_A));
    expect(after.value).toBe('Platform motto, revised');
    expect(after.locked).toBe(true);
    expect((await refusalOf(svc.set(NS, 'motto', 'Org A override', orgAdmin(ORG_A))))?.reason).toBe('locked-by-tenant');
  });
});

/** The settings routes over the same engine, with the caller each request resolves to. */
class RouteHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) { this.routes.set(`${method} ${path}`, handler); }
  get(path: string, h: RouteHandler) { this.add('GET', path, h); return this as any; }
  post(path: string, h: RouteHandler) { this.add('POST', path, h); return this as any; }
  put(path: string, h: RouteHandler) { this.add('PUT', path, h); return this as any; }
  delete(path: string, h: RouteHandler) { this.add('DELETE', path, h); return this as any; }
  patch(path: string, h: RouteHandler) { this.add('PATCH', path, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

describe('the settings route answers a locked row the way the service does', () => {
  const COMPANY = companySettingsManifest.namespace;

  async function companyRoutes() {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(companySettingsManifest);
    svc.bindEngine(wrapEngineAsSettingsEngine(engine as any), undefined, {
      tenancyPosture: () => 'isolated',
      organization: NO_ORGANIZATION_OBJECT,
    });
    let caller: SettingsContext = {};
    const http = new RouteHttp();
    registerSettingsRoutes(http, svc, { contextFromRequest: () => caller });
    const put = async (ctx: SettingsContext, body: Record<string, unknown>) => {
      caller = ctx;
      const state: { status: number; body?: any } = { status: 200 };
      const req: IHttpRequest = { params: { namespace: COMPANY }, query: {}, body, headers: {}, method: 'PUT', path: '/' };
      const res: IHttpResponse = {
        json: vi.fn((data) => { state.body = data; }) as any,
        send: vi.fn() as any,
        status: vi.fn((code: number) => { state.status = code; return res; }) as any,
        header: vi.fn(() => res) as any,
      };
      await http.routes.get('PUT /api/settings/:namespace')!(req, res);
      return state;
    };
    return { svc, put };
  }

  beforeEach(async () => {
    await engine.insert('sys_setting', {
      namespace: COMPANY, key: 'legal_name', scope: 'tenant', user_id: null, organization_id: ORG_A,
      value: 'Platform Legal Name', value_enc: null, encrypted: false, locked: true, locked_reason: 'Set by the platform.',
    }, SYS);
  });

  it('an organization administrator\'s PUT over its own locked row is 409 SETTINGS_LOCKED naming the key and the tenant lock', async () => {
    const { svc, put } = await companyRoutes();

    const r = await put(orgAdmin(ORG_A), { legal_name: 'Org A Override' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SETTINGS_LOCKED');
    expect(r.body.error.details).toEqual({ namespace: COMPANY, key: 'legal_name', reason: 'locked-by-tenant' });
    expect((await svc.get(COMPANY, 'legal_name', inOrg(ORG_A))).value).toBe('Platform Legal Name');
  });

  it('a platform administrator\'s PUT over it lands, and another organization\'s administrator is not bound by it', async () => {
    const { svc, put } = await companyRoutes();

    expect((await put(platformAdmin(ORG_A), { legal_name: 'Revised Legal Name' })).status).toBe(200);
    expect((await svc.get(COMPANY, 'legal_name', inOrg(ORG_A))).value).toBe('Revised Legal Name');
    expect((await put(orgAdmin(ORG_B), { legal_name: 'Org B Legal Name' })).status).toBe(200);
    expect((await svc.get(COMPANY, 'legal_name', inOrg(ORG_B))).value).toBe('Org B Legal Name');
  });
});

describe('a tenant-scope write that names no organization', () => {
  for (const posture of ['isolated', 'group'] as const) {
    it(`is refused whole under the '${posture}' posture, and nothing is written — while the same write from an organization lands`, async () => {
      const svc = settings(posture);

      const refusal = await svc.setMany(NS, { motto: 'Nobody' }, { userId }).then(() => null, (e) => e);
      expect(refusal, 'the organization-less write must refuse').not.toBeNull();
      expect(refusal.code).toBe('SETTINGS_VALIDATION');
      expect(refusal.fields).toEqual([
        expect.objectContaining({ field: 'motto', code: 'invalid_value', constraint: { scope: 'tenant' } }),
      ]);
      expect(settingRows()).toHaveLength(0);

      // A reset is a write too: it is refused the same way.
      const reset = await svc.setMany(NS, { motto: null }, { userId }).then(() => null, (e) => e);
      expect(reset?.code).toBe('SETTINGS_VALIDATION');
      expect(settingRows()).toHaveLength(0);

      // Positive control — the identical write, from inside an organization.
      await svc.setMany(NS, { motto: 'Alpha' }, inOrg(ORG_A, { userId }));
      expect(settingRows().map((r) => [r.organization_id, r.value])).toEqual([[ORG_A, 'Alpha']]);
    });
  }

  it("is not refused under the 'single' posture, nor where no posture is reported: it lands in the one organization D9 derives", async () => {
    for (const posture of ['single', undefined] as const) {
      const svc = settings(posture, derived(ORG_A));
      await svc.set(NS, 'motto', `free-${String(posture)}`, {});
      expect((await svc.get(NS, 'motto', {})).value).toBe(`free-${String(posture)}`);
      expect((await svc.get(NS, 'motto', inOrg(ORG_A))).value).toBe(`free-${String(posture)}`);
    }
    // One row, the organization's: the second write found the first.
    expect(settingRows().map((r) => [r.organization_id, r.value])).toEqual([[ORG_A, 'free-undefined']]);
  });

  it("is refused under 'single' where D9 derives no organization, and nothing is written", async () => {
    const svc = settings('single', NONE_DERIVABLE);
    const refusal = await svc.setMany(NS, { motto: 'Nobody' }, { userId }).then(() => null, (e) => e);
    expect(refusal?.code).toBe('SETTINGS_VALIDATION');
    expect(settingRows()).toHaveLength(0);
  });

  for (const posture of ['isolated', 'group'] as const) {
    it(`under the '${posture}' posture, a reader that names no organization reads no tenant or user row — neither an organization's nor one written with none`, async () => {
      const svc = settings(posture);
      await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));
      await svc.set(NS, 'theme', 'dark', inOrg(ORG_A, { userId }));
      expect((await svc.get(NS, 'motto', {})).source).toBe('default');

      await seed({ key: 'motto', scope: 'tenant', value: 'Legacy', organization_id: null });
      await seed({ key: 'theme', scope: 'user', user_id: userId, value: 'Legacy-dark', organization_id: null });
      const got = await svc.get(NS, 'motto', {});
      expect(got.source).toBe('default');
      expect(got.cascadeChain?.some((e) => e.scope === 'tenant')).toBe(false);
      expect((await svc.get(NS, 'theme', { userId })).source).toBe('default');
      expect((await svc.getNamespace(NS, { userId })).values.motto.source).toBe('default');
    });
  }
});

describe('the posture is read only where it decides something', () => {
  function withFailingPosture(): SettingsService {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(MANIFEST);
    svc.bindEngine(wrapEngineAsSettingsEngine(engine as any), undefined, {
      tenancyPosture: () => { throw new Error('tenancy unreadable'); },
    });
    return svc;
  }

  it('a caller that names an organization, and any read of a global key, never ask it', async () => {
    await settings('isolated').set(NS, 'banner', 'Everyone', {});
    const svc = withFailingPosture();
    await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));
    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).value).toBe('Alpha');
    expect((await svc.get(NS, 'banner', {})).value).toBe('Everyone');
    expect((await svc.getMany(NS, ['banner'], {})).banner.value).toBe('Everyone');
  });

  it('an unreadable posture is not guessed at for a caller that names no organization: the read and the write fail', async () => {
    const svc = withFailingPosture();
    await expect(svc.get(NS, 'motto', {})).rejects.toThrow('tenancy unreadable');
    await expect(svc.set(NS, 'motto', 'Nobody', {})).rejects.toThrow('tenancy unreadable');
    expect(settingRows()).toHaveLength(0);
  });
});

describe("posture 'single': the default organization keeps its answers", () => {
  const DEFAULT_ORG = 'org_default';

  it('a row stored with no organization is not the default organization\'s, for either reader', async () => {
    await seed({ key: 'motto', scope: 'tenant', value: 'Acme', organization_id: null });
    await seed({ key: 'theme', scope: 'user', user_id: userId, value: 'Acme-dark', organization_id: null });
    const svc = settings('single', derived(DEFAULT_ORG));
    for (const ctx of [inOrg(DEFAULT_ORG), {}]) {
      const got = await svc.get(NS, 'motto', ctx);
      expect(got.value).toBe('none');
      expect(got.source).toBe('default');
      expect((await svc.get(NS, 'theme', { ...ctx, userId })).value).toBe('light');
    }
  });

  it('the default organization\'s write is read by itself and by a process-wide reader that names no organization', async () => {
    await seed({ key: 'motto', scope: 'tenant', value: 'Acme', organization_id: null });
    const svc = settings('single', derived(DEFAULT_ORG));
    await svc.set(NS, 'motto', 'Acme Corp', inOrg(DEFAULT_ORG));

    expect((await svc.get(NS, 'motto', inOrg(DEFAULT_ORG))).value).toBe('Acme Corp');
    expect((await svc.get(NS, 'motto', {})).value).toBe('Acme Corp');
  });

  it('a process-wide writer that names no organization writes the default organization\'s row, and its second write replaces the first', async () => {
    const svc = settings('single', derived(DEFAULT_ORG));
    await svc.set(NS, 'motto', 'one', {});
    await svc.set(NS, 'motto', 'two', {});
    await svc.set(NS, 'theme', 'dark', { userId });

    expect((await svc.get(NS, 'motto', {})).value).toBe('two');
    expect((await svc.get(NS, 'motto', inOrg(DEFAULT_ORG))).value).toBe('two');
    expect((await svc.get(NS, 'theme', inOrg(DEFAULT_ORG, { userId }))).value).toBe('dark');
    expect(settingRows().map((r) => [r.scope, r.organization_id, r.value]).sort()).toEqual([
      ['tenant', DEFAULT_ORG, 'two'],
      ['user', DEFAULT_ORG, 'dark'],
    ]);
  });

  it('the default organization\'s reset reads back the default for both readers', async () => {
    const svc = settings('single', derived(DEFAULT_ORG));
    await svc.set(NS, 'motto', 'Acme Corp', inOrg(DEFAULT_ORG));
    await svc.runAction(NS, 'reset', null, inOrg(DEFAULT_ORG));

    expect((await svc.get(NS, 'motto', inOrg(DEFAULT_ORG))).source).toBe('default');
    expect((await svc.get(NS, 'motto', {})).source).toBe('default');
  });
});

describe('a composition with no organization object (the lean embedding, ADR-0131 D9 note)', () => {
  it('stores and reads its rows with no organization, which no organization reads', async () => {
    const svc = settings('single', NO_ORGANIZATION_OBJECT);
    await svc.set(NS, 'motto', 'Lean', {});
    await svc.set(NS, 'motto', 'Lean again', {});
    expect((await svc.get(NS, 'motto', {})).value).toBe('Lean again');
    expect(settingRows().map((r) => [r.organization_id ?? null, r.value])).toEqual([[null, 'Lean again']]);
    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).source).toBe('default');
  });
});

describe('the in-memory store keeps the same identity', () => {
  it('two organizations each read their own value with no engine bound', async () => {
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(MANIFEST);
    await svc.set(NS, 'motto', 'Alpha', inOrg(ORG_A));
    await svc.set(NS, 'motto', 'Beta', inOrg(ORG_B));

    expect((await svc.get(NS, 'motto', inOrg(ORG_A))).value).toBe('Alpha');
    expect((await svc.get(NS, 'motto', inOrg(ORG_B))).value).toBe('Beta');
  });
});
