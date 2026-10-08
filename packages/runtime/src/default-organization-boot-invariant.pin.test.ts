// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3 / D9] The Default Organization is load-bearing under `single`,
 * pinned on a REAL kernel — the plugin set `objectstack dev` / `serve` compose,
 * registered in the order `@objectstack/verify`'s `bootStack` registers it.
 *
 * Kernel A — a fresh deployment nobody has signed up to (no dev admin:
 * `NODE_ENV` is not `development`), the shape a production install boots in:
 *
 *  - (a) the Default Organization exists before the HTTP listener accepts
 *    (`kernel:listening`), and before the first seed row is written; an
 *    `isSystem` insert on a tenant-column object with no organization lands
 *    stamped with it;
 *  - (d) every seed row is stamped with it — the `sys_business_unit` seed
 *    included, whose `sys_` namespace used to exempt it;
 *  - the first user to sign up over HTTP (the first-run owner wizard's path)
 *    is its owner.
 *
 * Kernel B — `objectstack dev`'s shape: the dev admin is created on
 * `kernel:ready`, AFTER the organization exists, so the membership reconciler
 * binds them as `member` before the owner bind learns they are the platform
 * admin:
 *
 *  - (c) the first admin ends as the ONE owner of the Default Organization —
 *    the reconciler's `member` row promoted in place (ADR-0093 D7: while the
 *    once-only bind is undecided) — and keeps the platform-admin standing the
 *    first-user promotion gives them.
 *
 * `AppPlugin` is registered BEFORE `AuthPlugin` on purpose: the kernel has to
 * start the auth plugin first from `AppPlugin`'s declared order-if-present
 * dependency, not from where a host happened to list it.
 *
 * Controls: an object declaring `tenancy: { enabled: false }` takes no
 * organization, seeded or inserted, so the stamp is a per-object derivation and
 * not a blanket write; the platform-admin standing of the first admin is read
 * back unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/rest';
import { AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { AppPlugin } from './app-plugin.js';
import { DefaultDatasourcePlugin } from './default-datasource-plugin.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';

const BOOT_TIMEOUT = 180_000;
const ORIGIN = 'http://localhost:3000';
const API = '/api/v1';
const SYS = { isSystem: true };
const FIRST_USER = { email: 'first-owner-15195@example.invalid', password: 'First-Owner-15195', name: 'First owner' };
/** `AuthPlugin`'s dev-admin defaults (`OS_SEED_ADMIN_*` unset). */
const DEV_ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };

const PIN_APP: any = {
  manifest: { id: 'com.pin.defaultorg15195', name: 'Default organization pins', version: '1.0.0' },
  objects: [
    { name: 'pin_ledger', label: 'Pin ledger', fields: { title: { type: 'text', label: 'Title' } } },
    {
      // ADR-0066: the declared way to hold rows that belong to no organization.
      name: 'pin_licence',
      label: 'Pin licence',
      tenancy: { enabled: false },
      fields: { title: { type: 'text', label: 'Title' } },
    },
  ],
  data: [
    {
      object: 'sys_business_unit',
      mode: 'upsert',
      externalId: 'id',
      records: [{ id: 'bu_pin_15195', name: 'Pin Head Office', code: 'PIN-HQ', kind: 'company', active: true }],
    },
    { object: 'pin_ledger', mode: 'upsert', externalId: 'title', records: [{ title: 'seeded one' }, { title: 'seeded two' }] },
    { object: 'pin_licence', mode: 'upsert', externalId: 'title', records: [{ title: 'seeded licence' }] },
  ],
};

const rowsOf = (r: unknown): Array<Record<string, any>> =>
  Array.isArray(r) ? r : ((r as { records?: Array<Record<string, any>> })?.records ?? []);

const json = (payload: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

interface Booted {
  kernel: any;
  httpServer: any;
  engine: any;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  find: (object: string, where?: Record<string, unknown>) => Promise<Array<Record<string, any>>>;
  /** Every insert's object, in order, as the engine saw it. */
  inserts: string[];
  /** The `role` of every `sys_member` row inserted, in order. */
  memberInsertRoles: unknown[];
  /** The organizations that existed when `kernel:listening` fired (the listener opens on it). */
  orgsAtListening?: Array<Record<string, any>>;
}

async function boot(secret: string): Promise<Booted> {
  const booted = { inserts: [], memberInsertRoles: [] } as unknown as Booted;
  const probe: Plugin = {
    name: 'pin.default-org-15195.probe',
    version: '0.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    init: async (ctx: PluginContext) => {
      const ql = ctx.getService<ObjectQL>('objectql');
      ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
        if (opCtx.operation === 'insert') {
          booted.inserts.push(String(opCtx.object));
          if (opCtx.object === 'sys_member') booted.memberInsertRoles.push(opCtx.data?.role);
        }
        await next();
      });
      ctx.hook('kernel:listening', async () => {
        booted.orgsAtListening = rowsOf(
          await ql.find('sys_organization', { fields: ['id', 'slug'], limit: 5, context: SYS }),
        );
      });
    },
  };
  const kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
  await kernel.use(new HonoServerPlugin({ port: 0 }));
  await kernel.use(new AppPlugin(PIN_APP));
  await kernel.use(new PlatformObjectsPlugin());
  // The production default: `autoDefaultOrganization` on.
  await kernel.use(new AuthPlugin({ secret }));
  await kernel.use(probe);
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(PIN_APP)));
  await kernel.use(new SharingServicePlugin());
  await kernel.use(createRestApiPlugin({}));
  await kernel.use(createDispatcherPlugin({}));
  await kernel.bootstrap();

  booted.kernel = kernel;
  booted.httpServer = await kernel.getServiceAsync('http-server');
  booted.engine = await kernel.getServiceAsync('objectql');
  const app = booted.httpServer.getRawApp();
  booted.request = (path, init) => app.request(`${ORIGIN}${API}${path}`, init);
  booted.find = async (object, where = {}) =>
    rowsOf(await booted.engine.find(object, { where, limit: 50, context: SYS }));
  return booted;
}

async function shutdown(booted: Booted | undefined): Promise<void> {
  try { await booted?.httpServer?.close?.(); } catch { /* best-effort */ }
  try { await booted?.kernel?.shutdown?.(); } catch { /* best-effort */ }
}

/** Sign in, then read the session the way the console does. */
async function sessionOf(booted: Booted, who: { email: string; password: string }) {
  const signIn = await booted.request('/auth/sign-in/email', json(who));
  expect(signIn.status, await signIn.clone().text()).toBe(200);
  const token = ((await signIn.json()) as { token: string }).token;
  const session = await booted.request('/auth/get-session', { headers: { Authorization: `Bearer ${token}` } });
  return ((await session.json()) as { user?: { isPlatformAdmin?: boolean; positions?: string[] } }).user;
}

async function membershipsOf(booted: Booted, email: string) {
  const [user] = await booted.find('sys_user', { email });
  return (await booted.find('sys_member', { user_id: user.id }))
    .map((m) => ({ organization_id: m.organization_id, role: m.role }));
}

describe('kernel A — a fresh `single` deployment nobody has signed up to', () => {
  let A: Booted;
  beforeAll(async () => { A = await boot('default-org-15195-pin-secret-a'); }, BOOT_TIMEOUT);
  afterAll(async () => { await shutdown(A); }, 60_000);

  describe('[ADR-0131 D3] (a) the Default Organization exists before the listener and before the seeds', () => {
    it('kernel:listening sees exactly the Default Organization, on a boot nobody has signed up to', async () => {
      expect(A.orgsAtListening?.map((o) => o.slug)).toEqual(['default']);
      // Nobody signed up: the organization did not wait for an admin.
      expect(await A.find('sys_user')).toEqual([]);
    });

    it('the organization row is written before the first seed row', () => {
      const organization = A.inserts.indexOf('sys_organization');
      const firstSeed = A.inserts.findIndex((o) => o === 'sys_business_unit' || o === 'pin_ledger');
      // Both were observed — the order below compares two real writes.
      expect(organization).toBeGreaterThanOrEqual(0);
      expect(firstSeed).toBeGreaterThanOrEqual(0);
      expect(organization).toBeLessThan(firstSeed);
    });

    it('an isSystem insert on a tenant-column object with no organization lands stamped with it', async () => {
      const [org] = await A.find('sys_organization');
      const row = await A.engine.insert('pin_ledger', { title: 'system write, no organization' }, { context: SYS });
      expect((await A.find('pin_ledger', { id: row.id }))[0]?.organization_id).toBe(org.id);
      // CONTROL — an object that declares no tenancy takes no organization.
      const licence = await A.engine.insert('pin_licence', { title: 'system write, tenancy off' }, { context: SYS });
      expect((await A.find('pin_licence', { id: licence.id }))[0]?.organization_id ?? null).toBeNull();
    });
  });

  describe('[ADR-0131 D3 / D9] (d) every seed row carries the Default Organization, `sys_` seeds included', () => {
    it('the app seed and the sys_business_unit seed are stamped; the tenancy-off control is not', async () => {
      const [org] = await A.find('sys_organization');
      const ledger = await A.find('pin_ledger', { title: { $in: ['seeded one', 'seeded two'] } });
      expect(ledger.map((r) => r.organization_id)).toEqual([org.id, org.id]);
      const units = await A.find('sys_business_unit', { id: 'bu_pin_15195' });
      expect(units.map((r) => r.organization_id)).toEqual([org.id]);
      // CONTROL — the seed WAS written, and with no organization, where the
      // object declares none: the census reads the column, it is not a constant.
      const licences = await A.find('pin_licence', { title: 'seeded licence' });
      expect(licences.map((r) => r.organization_id ?? null)).toEqual([null]);
    });
  });

  describe('[ADR-0131 D3] the first user to sign up over HTTP is the owner', () => {
    it('ends as the one owner of the Default Organization, with platform-admin standing', async () => {
      const signUp = await A.request('/auth/sign-up/email', json(FIRST_USER));
      expect(signUp.status, await signUp.clone().text()).toBe(200);
      const [org] = await A.find('sys_organization');
      expect(await membershipsOf(A, FIRST_USER.email)).toEqual([{ organization_id: org.id, role: 'owner' }]);
      const user = await sessionOf(A, FIRST_USER);
      expect(user?.isPlatformAdmin).toBe(true);
      expect(user?.positions).toContain('platform_admin');
    });
  });
});

describe('kernel B — `objectstack dev`: the dev admin is created after the organization exists', () => {
  let B: Booted;
  let prevNodeEnv: string | undefined;
  beforeAll(async () => {
    prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development'; // the dev-admin seed, as `objectstack dev` / bootStack arm it
    B = await boot('default-org-15195-pin-secret-b');
  }, BOOT_TIMEOUT);
  afterAll(async () => {
    await shutdown(B);
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
  }, 60_000);

  describe('[ADR-0131 D3 / ADR-0093 D7] (c) the first admin of a fresh `single` deployment is the owner', () => {
    it('the reconciler bound them `member`, and that row was promoted in place to `owner`', async () => {
      // The precondition the promotion exists for: the organization predates
      // the admin, so the reconciler's `member` row is the first membership.
      expect(B.memberInsertRoles).toEqual(['member']);
      const [org] = await B.find('sys_organization');
      // ONE membership, promoted in place: not `member`, and not a second row.
      expect(await membershipsOf(B, DEV_ADMIN.email)).toEqual([{ organization_id: org.id, role: 'owner' }]);
    });

    it('CONTROL — the platform-admin standing the first-user promotion gives is unchanged', async () => {
      const user = await sessionOf(B, DEV_ADMIN);
      expect(user?.isPlatformAdmin).toBe(true);
      expect(user?.positions).toContain('platform_admin');
    });
  });
});
