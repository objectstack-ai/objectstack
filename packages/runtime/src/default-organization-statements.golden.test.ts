// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24523] Statements per authenticated request, pinned on a REAL kernel — the
 * plugin set `default-organization-boot-invariant.pin.test.ts` composes, with
 * `objectstack dev`'s seeded administrator, whose first-user promotion writes
 * the `admin_full_access` grant OWNED BY THE DEFAULT ORGANIZATION (ADR-0131 D5).
 *
 * The batch-equivalence goldens' fixture holds only the organization-less
 * grant, so it never exercised the Default Organization read; this one holds
 * the organization-owned row. Before the memo, that read cost every such
 * request one `sys_organization` statement (two when the one organization is
 * not slugged `default`) on top of the organization-less admin's count.
 *
 * Counted: every statement the SQL driver issues inside the request's own
 * async context (knex's `query` event, the same listener `Server-Timing`'s
 * `db` span counts), so a background poller's statement is never counted.
 * Warm: two requests first, so the session, the localization cache and the
 * served metadata are warm before any count is read.
 *
 * Then the two retirements the memo owes (#21868 is the failure designed
 * against), read over HTTP as the standing `get-session` reports:
 *  - the Default Organization deleted and a new one created;
 *  - `default` moved off the Default Organization (its grant stops anchoring)
 *    and the organization made the only one again (it anchors again); moving
 *    `default` onto another organization is refused (ADR-0131 D5).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
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
import { relaxTenantColumns } from './pre-18-tenant-column.testkit.js';

const BOOT_TIMEOUT = 180_000;
const ORIGIN = 'http://localhost:3000';
const API = '/api/v1';
const SYS = { isSystem: true };
/** `AuthPlugin`'s dev-admin defaults (`OS_SEED_ADMIN_*` unset). */
const DEV_ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };
const GET_SESSION = '/auth/get-session';
const DATA_READ = '/data/pin_note?$top=1';

/**
 * The organization-less administrator's warm counts on this composition,
 * measured on `origin/main` 5a871e4e41: `get-session` 8, the data read 10.
 * An organization-less grant no longer anchors standing, so that administrator
 * is gone; the counts are the bar the organization-owned one is held to.
 * The organization-owned administrator paid 9 / 11 there (slug `default`) and
 * 10 / 12 (the sole organization slugged otherwise).
 */
const WARM = { [GET_SESSION]: 8, [DATA_READ]: 10 } as const;

const PIN_APP: any = {
  manifest: { id: 'com.pin.defaultorgmemo24523', name: 'Default organization memo pins', version: '1.0.0' },
  objects: [{ name: 'pin_note', label: 'Pin note', fields: { title: { type: 'text', label: 'Title' } } }],
  data: [{ object: 'pin_note', mode: 'upsert', externalId: 'title', records: [{ title: 'seeded note' }] }],
};

const rowsOf = (r: unknown): Array<Record<string, any>> =>
  Array.isArray(r) ? r : ((r as { records?: Array<Record<string, any>> })?.records ?? []);

const statements = new AsyncLocalStorage<string[]>();
let kernel: any;
let engine: any;
let app: any;
let token = '';
let prevNodeEnv: string | undefined;

const find = async (object: string, where: Record<string, unknown> = {}) =>
  rowsOf(await engine.find(object, { where, limit: 50, context: SYS }));

/** One authenticated request, and the statements the driver issued for it. */
async function request(path: string): Promise<{ status: number; body: any; sql: string[] }> {
  const sql: string[] = [];
  const res: Response = await statements.run(sql, () =>
    app.request(`${ORIGIN}${API}${path}`, { headers: { Authorization: `Bearer ${token}` } }),
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined, sql: [...sql] };
}

/** The warm statement counts of both requests, and the `sys_organization` statements among them. */
async function warm() {
  const out: Record<string, { count: number; organization: number }> = {};
  for (const path of [GET_SESSION, DATA_READ]) {
    await request(path);
    await request(path);
    const r = await request(path);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    out[path] = { count: r.sql.length, organization: r.sql.filter((s) => /sys_organization/.test(s)).length };
  }
  return out;
}

async function standing() {
  const r = await request(GET_SESSION);
  expect(r.status).toBe(200);
  return { standing: r.body?.user?.isPlatformAdmin === true, organizationReads: r.sql.filter((s) => /sys_organization/.test(s)).length };
}

async function adminGrant() {
  const [user] = await find('sys_user', { email: DEV_ADMIN.email });
  const [grant] = await find('sys_user_permission_set', { user_id: user.id, permission_set: 'admin_full_access' });
  return grant;
}

beforeAll(async () => {
  prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development'; // the dev-admin seed, as `objectstack dev` arms it
  kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
  await kernel.use(new HonoServerPlugin({ port: 0 }));
  await kernel.use(new AppPlugin(PIN_APP));
  await kernel.use(new PlatformObjectsPlugin());
  await kernel.use(new AuthPlugin({ secret: 'default-org-memo-24523-pin-secret' }));
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(PIN_APP)));
  await kernel.use(new SharingServicePlugin());
  await kernel.use(createRestApiPlugin({}));
  await kernel.use(createDispatcherPlugin({}));
  await kernel.bootstrap();
  engine = await kernel.getServiceAsync('objectql');
  app = (await kernel.getServiceAsync('http-server')).getRawApp();
  (engine as any).getDriver('sys_user').knex.on('query', (q: { sql?: unknown }) => {
    statements.getStore()?.push(String(q?.sql ?? ''));
  });
  const signIn = await app.request(`${ORIGIN}${API}/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(DEV_ADMIN),
  });
  expect(signIn.status, await signIn.clone().text()).toBe(200);
  token = ((await signIn.json()) as { token: string }).token;
}, BOOT_TIMEOUT);

afterAll(async () => {
  try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
}, 60_000);

describe('[#24523] statements per warm request: an organization-owned admin grant costs what an organization-less one did', () => {
  it('the fixture: the promoted administrator\'s grant is owned by the Default Organization, slugged `default`', async () => {
    const [organization] = await find('sys_organization');
    expect(organization.slug).toBe('default');
    expect((await adminGrant()).organization_id).toBe(organization.id);
    expect((await standing()).standing).toBe(true);
  });

  it('⭐ slugged `default`: get-session 8 and the data read 10, with no sys_organization statement', async () => {
    expect(await warm()).toEqual({
      [GET_SESSION]: { count: WARM[GET_SESSION], organization: 0 },
      [DATA_READ]: { count: WARM[DATA_READ], organization: 0 },
    });
  });

  it('⭐ the sole organization slugged otherwise: the same counts', async () => {
    const [organization] = await find('sys_organization');
    await engine.update('sys_organization', { id: organization.id, slug: 'acme' }, { context: SYS });
    expect(await warm()).toEqual({
      [GET_SESSION]: { count: WARM[GET_SESSION], organization: 0 },
      [DATA_READ]: { count: WARM[DATA_READ], organization: 0 },
    });
    expect((await standing()).standing).toBe(true);
  });

  it('CONTROL — the organization-less grant anchors nothing: on either slug, no standing, and no sys_organization statement is issued for it', async () => {
    // An organization-less grant exists only on a store built before 18.x
    // (ADR-0131 D1 makes a fresh tenant column NOT NULL): this table is that
    // store's, relaxed through its driver's own drift apply door.
    await relaxTenantColumns((engine as any).getDriver('sys_user_permission_set'), ['sys_user_permission_set']);
    const grant = await adminGrant();
    const [organization] = await find('sys_organization');
    await engine.update('sys_user_permission_set', { id: grant.id, organization_id: null }, { context: SYS });
    const sole = { reads: await warm(), standing: await standing() };
    await engine.update('sys_organization', { id: organization.id, slug: 'default' }, { context: SYS });
    const slugged = { reads: await warm(), standing: await standing() };
    await engine.update('sys_user_permission_set', { id: grant.id, organization_id: organization.id }, { context: SYS });
    for (const { reads, standing: s } of [sole, slugged]) {
      expect(s).toEqual({ standing: false, organizationReads: 0 });
      expect(reads[GET_SESSION].organization).toBe(0);
      expect(reads[DATA_READ].organization).toBe(0);
    }
    // The positive leg: the same row, owned by the Default Organization again, anchors.
    expect((await standing()).standing).toBe(true);
  });
});

describe('[#24523 / #21868] a sys_organization write retires the memoised Default Organization', () => {
  it('⭐ the Default Organization deleted and recreated: the next request reads the new id', async () => {
    const [old] = await find('sys_organization', { slug: 'default' });
    await standing(); // the control above wrote the organization: read it once
    expect(await standing()).toEqual({ standing: true, organizationReads: 0 });

    // [#24948] CONTROL: an organization rows still name is not deleted, and
    // standing survives the refusal. (The delete drops the memo before it is
    // judged, so the next request re-reads once; the one after is warm.)
    const refused = await engine.delete('sys_organization', { where: { id: old.id }, context: SYS }).then(() => null, (e: any) => e);
    expect(refused?.code).toBe('DELETE_RESTRICTED');
    expect(refused?.status).toBe(409);
    expect(await find('sys_organization', { id: old.id })).toHaveLength(1);
    expect((await standing()).standing).toBe(true);
    expect(await standing()).toEqual({ standing: true, organizationReads: 0 });

    // The ruled remedy: move what the organization owns, then delete it. The
    // rows wait in a holding organization while the Default Organization is
    // deleted and recreated.
    const owned: Array<{ object: string }> = await engine.organizationOwnedRowCounts(old.id);
    expect(owned.length, 'PREMISE: rows name the Default Organization').toBeGreaterThan(0);
    const holding = await engine.insert('sys_organization', { name: 'Holding', slug: 'holding' }, { context: SYS });
    const moved: Array<{ object: string; id: string }> = [];
    // Grants first: moving a membership makes plugin-security grant its
    // organization-admin set in the target, which a later grant move would duplicate.
    const grantsFirst = [...owned].sort((a, b) =>
      Number(b.object === 'sys_user_permission_set') - Number(a.object === 'sys_user_permission_set'));
    for (const { object } of grantsFirst) {
      for (const row of await find(object, { organization_id: old.id })) {
        await engine.update(object, { id: row.id, organization_id: holding.id }, { context: SYS });
        moved.push({ object, id: row.id });
      }
    }
    await engine.delete('sys_organization', { where: { id: old.id }, context: SYS });
    const created = await engine.insert('sys_organization', { name: 'Default Organization', slug: 'default' }, { context: SYS });
    expect(created.id).not.toBe(old.id);
    // Everything the old one owned, the promotion's grant included, now belongs to the recreated one.
    for (const { object, id } of moved) {
      await engine.update(object, { id, organization_id: created.id }, { context: SYS });
    }
    await engine.delete('sys_organization', { where: { id: holding.id }, context: SYS });

    // A memo still answering the deleted id would withhold standing here.
    expect(await standing()).toEqual({ standing: true, organizationReads: 1 });
    expect(await standing()).toEqual({ standing: true, organizationReads: 0 });
  });

  it('⭐ `default` moved off the Default Organization: its grant stops anchoring, and anchors again once it is the only one', async () => {
    const [from] = await find('sys_organization', { slug: 'default' });
    const to = await engine.insert('sys_organization', { name: 'Second', slug: 'second' }, { context: SYS });
    expect(await standing()).toEqual({ standing: true, organizationReads: 1 });
    expect(await standing()).toEqual({ standing: true, organizationReads: 0 });

    await engine.update('sys_organization', { id: from.id, slug: 'first' }, { context: SYS });
    // The withdrawing direction: a memo still answering `from` would keep conferring standing.
    expect((await standing()).standing).toBe(false);

    // [ADR-0131 D5] `default` cannot be moved ONTO another organization: that
    // is the platform-admin anchor captured, and the last-administrator guard
    // refuses it for every context.
    const refused = await engine.update('sys_organization', { id: to.id, slug: 'default' }, { context: SYS }).then(() => null, (e: any) => e);
    expect(refused?.code).toBe('PERMISSION_DENIED');
    expect(refused?.status).toBe(403);

    // The conferring direction: `to` deleted, `from` is the only organization,
    // so the Default Organization again. A memo still answering "none" would
    // withhold standing here.
    await engine.delete('sys_organization', { where: { id: to.id }, context: SYS });
    expect((await standing()).standing).toBe(true);
    expect(await standing()).toEqual({ standing: true, organizationReads: 0 });
  });
});
