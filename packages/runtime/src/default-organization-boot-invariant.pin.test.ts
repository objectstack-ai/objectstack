// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3 / D9] The Default Organization is load-bearing under `single`,
 * pinned on a REAL kernel — the plugin set `objectstack dev` / `serve` compose,
 * registered in the order `@objectstack/verify`'s `bootStack` registers it.
 *
 * A fresh deployment with nobody signed up yet (no dev admin: `NODE_ENV` is not
 * `development` here), which is the shape a production install boots in:
 *
 *  - (a) the Default Organization exists before the HTTP listener accepts
 *    (`kernel:listening`), and before the first seed row is written; an
 *    `isSystem` insert on a tenant-column object with no organization lands
 *    stamped with it;
 *  - (d) every seed row is stamped with it — the `sys_business_unit` seed
 *    included, whose `sys_` namespace used to exempt it;
 *  - (c) the first user to sign up is the organization's OWNER, although the
 *    membership reconciler binds every new user as `member` the moment they
 *    are created (the organization now predates them) — and keeps the
 *    platform-admin standing the first-user promotion gives them.
 *
 * `AppPlugin` is registered BEFORE `AuthPlugin` on purpose: the kernel has to
 * start the auth plugin first from `AppPlugin`'s declared order-if-present
 * dependency, not from where a host happened to list it.
 *
 * Controls: an object declaring `tenancy: { enabled: false }` takes no
 * organization, seeded or inserted, so the stamp is a per-object derivation and
 * not a blanket write; the platform-admin standing of the first user is read
 * back unchanged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
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

/** What the probe saw while the kernel booted. */
const seen: { inserts: string[]; orgsAtListening?: Array<Record<string, unknown>> } = { inserts: [] };

const rowsOf = (r: unknown): Array<Record<string, any>> =>
  Array.isArray(r) ? r : ((r as { records?: Array<Record<string, any>> })?.records ?? []);

/**
 * Records every insert's object in order, and the organizations that exist when
 * `kernel:listening` fires — the hook the HTTP server opens its listener on.
 */
const PROBE: any = {
  name: 'pin.default-org-15195.probe',
  dependencies: ['com.objectstack.engine.objectql'],
  async init(ctx: any) {
    const ql = ctx.getService('objectql');
    ql.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      if (opCtx.operation === 'insert') seen.inserts.push(String(opCtx.object));
      await next();
    });
    ctx.hook('kernel:listening', async () => {
      seen.orgsAtListening = rowsOf(await ql.find('sys_organization', { fields: ['id', 'slug'], limit: 5, context: SYS }));
    });
  },
};

let kernel: any;
let httpServer: any;
let app: any;
let engine: any;

const req = (path: string, init?: RequestInit) => app.request(`${ORIGIN}${API}${path}`, init);
const json = (payload: unknown, token?: string): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(payload),
});

async function find(object: string, where: Record<string, unknown> = {}): Promise<Array<Record<string, any>>> {
  return rowsOf(await engine.find(object, { where, limit: 50, context: SYS }));
}

beforeAll(async () => {
  kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
  await kernel.use(new HonoServerPlugin({ port: 0 }));
  await kernel.use(new AppPlugin(PIN_APP));
  await kernel.use(new PlatformObjectsPlugin());
  // The production default: `autoDefaultOrganization` on.
  await kernel.use(new AuthPlugin({ secret: 'default-org-15195-pin-secret' }));
  await kernel.use(PROBE);
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(PIN_APP)));
  await kernel.use(new SharingServicePlugin());
  await kernel.use(createRestApiPlugin({}));
  await kernel.use(createDispatcherPlugin({}));
  await kernel.bootstrap();

  httpServer = await kernel.getServiceAsync('http-server');
  app = httpServer.getRawApp();
  engine = await kernel.getServiceAsync('objectql');
}, BOOT_TIMEOUT);

afterAll(async () => {
  try { await httpServer?.close?.(); } catch { /* best-effort */ }
  try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
}, 60_000);

describe('[ADR-0131 D3] (a) the Default Organization exists before the listener and before the seeds', () => {
  it('kernel:listening sees exactly the Default Organization, on a boot nobody has signed up to', async () => {
    expect(seen.orgsAtListening?.map((o) => o.slug)).toEqual(['default']);
    // Nobody signed up: the organization did not wait for an admin.
    expect(await find('sys_user')).toEqual([]);
  });

  it('the organization row is written before the first seed row', () => {
    const organization = seen.inserts.indexOf('sys_organization');
    const firstSeed = seen.inserts.findIndex((o) => o === 'sys_business_unit' || o === 'pin_ledger');
    // Both were observed — the order below compares two real writes.
    expect(organization).toBeGreaterThanOrEqual(0);
    expect(firstSeed).toBeGreaterThanOrEqual(0);
    expect(organization).toBeLessThan(firstSeed);
  });

  it('an isSystem insert on a tenant-column object with no organization lands stamped with it', async () => {
    const [org] = await find('sys_organization');
    const row = await engine.insert('pin_ledger', { title: 'system write, no organization' }, { context: SYS });
    expect((await find('pin_ledger', { id: row.id }))[0]?.organization_id).toBe(org.id);
    // CONTROL — an object that declares no tenancy takes no organization.
    const licence = await engine.insert('pin_licence', { title: 'system write, tenancy off' }, { context: SYS });
    expect((await find('pin_licence', { id: licence.id }))[0]?.organization_id ?? null).toBeNull();
  });
});

describe('[ADR-0131 D3 / D9] (d) every seed row carries the Default Organization, `sys_` seeds included', () => {
  it('the app seed and the sys_business_unit seed are stamped; the tenancy-off control is not', async () => {
    const [org] = await find('sys_organization');
    const ledger = await find('pin_ledger', { title: { $in: ['seeded one', 'seeded two'] } });
    expect(ledger.map((r) => r.organization_id)).toEqual([org.id, org.id]);
    const units = await find('sys_business_unit', { id: 'bu_pin_15195' });
    expect(units.map((r) => r.organization_id)).toEqual([org.id]);
    // CONTROL — the seed WAS written, and with no organization, where the
    // object declares none: the census reads the column, it is not a constant.
    const licences = await find('pin_licence', { title: 'seeded licence' });
    expect(licences.map((r) => r.organization_id ?? null)).toEqual([null]);
  });
});

describe('[ADR-0131 D3 / ADR-0093 D7] (c) the first user of a fresh `single` deployment is the owner', () => {
  it('signs up as the first user, ends as the one owner of the Default Organization, and keeps platform-admin standing', async () => {
    const signUp = await req('/auth/sign-up/email', json(FIRST_USER));
    expect(signUp.status, await signUp.clone().text()).toBe(200);
    const signIn = await req('/auth/sign-in/email', json({ email: FIRST_USER.email, password: FIRST_USER.password }));
    expect(signIn.status).toBe(200);
    const token = ((await signIn.json()) as { token: string }).token;

    const [org] = await find('sys_organization');
    const [user] = await find('sys_user', { email: FIRST_USER.email });
    const memberships = (await find('sys_member', { user_id: user.id }))
      .map((m) => ({ organization_id: m.organization_id, role: m.role }));
    // ONE membership, promoted in place: not `member`, and not a second row.
    expect(memberships).toEqual([{ organization_id: org.id, role: 'owner' }]);

    // CONTROL — the platform-admin standing the first-user promotion gives is
    // unchanged by the organization existing first.
    const session = await app.request(`${ORIGIN}${API}/auth/get-session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sessionUser = ((await session.json()) as { user?: { isPlatformAdmin?: boolean; positions?: string[] } }).user;
    expect(sessionUser?.isPlatformAdmin).toBe(true);
    expect(sessionUser?.positions).toContain('platform_admin');
  });
});
