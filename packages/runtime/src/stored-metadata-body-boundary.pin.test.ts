// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21520] The stored-metadata family's boundary for app-authored bodies, end
 * to end in a composed kernel: a body may not touch the family's tables
 * (`sys_metadata` / `sys_metadata_history`) except by reading them through the
 * read seam; changes to metadata go through the metadata API.
 *
 * Every observation here is a NEUTRAL marker: a hook body appends a fixed
 * token to a free-text column (`tags` on `sys_metadata`, `change_note` on its
 * history, `status` on the ordinary table), and an action body writes the same
 * kind of token. Whether a body ran, or a write landed, is read off that
 * column — nothing else of a stored row is read.
 *
 *   ① binding — a body hook targeting a family table (string or list form, in
 *     the app bundle, or authored at runtime through the metadata door) is not
 *     bound, so the metadata door's own save does not run it; a wildcard body
 *     hook binds and is not run for a family table. Controls: the same hooks on
 *     an ordinary table bind and fire; a platform CODE hook on `sys_metadata`
 *     still fires on the metadata door's save.
 *   ② writing — an action body's write of a family table (an insert, and a
 *     predicate update) answers `403 PERMISSION_DENIED` and lands nothing, for
 *     the administrator and for a member (the body runs elevated for both).
 *     Control: the same body's write of an ordinary table lands.
 *
 * Composition: the in-process kernel `@objectstack/verify`'s `bootStack` mirrors
 * (engine, sqlite-wasm default datasource, HTTP server, the app, platform
 * objects, auth, security, sharing, REST, dispatcher), requests injected through
 * the HTTP app as signed-in users. The boot is paid in `beforeAll`, never inside
 * a case.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import type { ObjectQL } from '@objectstack/objectql';
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
const ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };
const MEMBER = { email: 'boundary-member@example.invalid', password: 'Member-Pass-123' };
const ORDINARY = 'boundary_note';

const js = (source: string, capabilities: string[] = []) => ({ language: 'js', source, capabilities, timeoutMs: 5000 });
/** Append `token` to a free-text column of the row being written. */
const append = (column: string, token: string) =>
  `ctx.input.${column} = (typeof ctx.input.${column} === 'string' ? ctx.input.${column} : '') + '|${token}';`;

const PIN_APP: any = {
  manifest: { id: 'com.pin.boundary21520', name: 'Body boundary pins', version: '1.0.0' },
  objects: [
    {
      name: ORDINARY,
      label: 'Boundary note',
      fields: {
        title: { type: 'text', label: 'Title' },
        status: { type: 'text', label: 'Status' },
      },
      actions: [
        {
          name: 'body_inserts_metadata',
          label: 'Body inserts a stored-metadata row',
          type: 'script',
          body: js(
            "await ctx.api.object('sys_metadata').insert({ name: 'boundary_body_row', type: 'note', metadata: '{}' });\nreturn { wrote: true };",
            ['api.write'],
          ),
        },
        {
          name: 'body_updates_metadata',
          label: 'Body updates stored-metadata rows by predicate',
          type: 'script',
          body: js(
            "await ctx.api.object('sys_metadata').update({ tags: '|body-wrote' }, { where: { type: 'action' }, multi: true });\nreturn { wrote: true };",
            ['api.write'],
          ),
        },
        {
          name: 'body_inserts_history',
          label: 'Body inserts a history row',
          type: 'script',
          body: js(
            "await ctx.api.object('sys_metadata_history').insert({ name: 'boundary_body_row', type: 'note', version: 1, operation_type: 'create', metadata: '{}' });\nreturn { wrote: true };",
            ['api.write'],
          ),
        },
        {
          name: 'body_inserts_ordinary',
          label: 'Body inserts an ordinary row (control)',
          type: 'script',
          body: js(`await ctx.api.object('${ORDINARY}').insert({ title: 'body-wrote' });\nreturn { wrote: true };`, ['api.write']),
        },
      ],
    },
  ],
  hooks: [
    { name: 'boundary_hook_on_metadata', object: 'sys_metadata', events: ['beforeInsert', 'beforeUpdate'], body: js(append('tags', 'explicit-ran')) },
    { name: 'boundary_hook_on_history', object: ['sys_metadata_history'], events: ['beforeInsert'], body: js(append('change_note', 'explicit-ran')) },
    {
      name: 'boundary_hook_wildcard',
      object: '*',
      events: ['beforeInsert', 'beforeUpdate'],
      body: js(
        `if (ctx.object === 'sys_metadata') { ${append('tags', 'wildcard-ran')} }\n`
        + `if (ctx.object === '${ORDINARY}') { ${append('status', 'wildcard-ran')} }`,
      ),
    },
    { name: 'boundary_hook_ordinary', object: ORDINARY, events: ['beforeInsert'], body: js(append('status', 'ordinary-ran')) },
  ],
  permissions: [
    {
      name: 'boundary_member_default',
      label: 'Boundary member default',
      isDefault: true,
      objects: { [ORDINARY]: { allowRead: true, allowCreate: true } },
    },
  ],
};

/** A platform-shaped CODE hook on `sys_metadata` (registered as code, never a body): counts its runs. */
let platformHookRuns = 0;
const PLATFORM_HOOK_PLUGIN: Plugin = {
  name: 'pin.boundary21520.platform-hook',
  version: '0.0.0',
  init: async () => {},
  start: async (ctx: PluginContext) => {
    const ql = ctx.getService<ObjectQL>('objectql');
    for (const event of ['afterInsert', 'afterUpdate']) {
      ql.registerHook(event, async () => { platformHookRuns += 1; }, { object: 'sys_metadata', packageId: 'pin.platform' });
    }
  },
};

let kernel: any;
let httpServer: any;
let app: any;
let adminToken: string;
let memberToken: string;
let prevNodeEnv: string | undefined;
/** The metadata door's answer to saving a runtime-authored hook on `sys_metadata` (printed, not asserted). */
let recordedFamilyHookSaveStatus: number | undefined;

const req = (path: string, init?: RequestInit) => app.request(`${ORIGIN}${API}${path}`, init);
const as = (token: string | undefined, method: string, path: string, body?: unknown) =>
  req(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function engine(): Promise<any> {
  return kernel.getServiceAsync('objectql');
}

/** One free-text column of the rows matching `where`, read in-process. */
async function columnOf(object: string, where: Record<string, unknown>, column: string): Promise<string[]> {
  const rows: any[] = await (await engine()).find(object, { where, fields: ['id', column], context: { isSystem: true } });
  return rows.map((r) => String(r?.[column] ?? ''));
}

async function signIn(who: { email: string; password: string }): Promise<string> {
  const res = await req('/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(who),
  });
  if (!res.ok) throw new Error(`pin signIn failed: ${res.status}`);
  return (await res.json()).token;
}

async function signUpMember(): Promise<string> {
  // Default audience posture is invite_only: enter through a pending invitation.
  await (await engine()).insert(
    'sys_invitation',
    {
      id: 'inv_pin_21520',
      email: MEMBER.email,
      status: 'pending',
      organization_id: 'org_pin_audience_gate',
      role: 'member',
      inviter_id: 'usr_pin_audience_gate',
      expires_at: new Date(Date.now() + 3_600_000),
    },
    { context: { isSystem: true } },
  );
  const res = await req('/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: MEMBER.email, password: MEMBER.password, name: 'boundary member' }),
  });
  if (!res.ok) throw new Error(`pin signUp failed: ${res.status}`);
  return (await res.json()).token;
}

async function waitFor(predicate: () => Promise<boolean>, ms = 15_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** Save an `action` item through the metadata door, as the administrator: the platform's own family write. */
async function saveThroughMetadataDoor(name: string, label: string): Promise<Response> {
  return as(adminToken, 'PUT', `/meta/action/${name}`, {
    name,
    label,
    objectName: ORDINARY,
    type: 'script',
    body: js('return { ok: true };'),
  });
}

beforeAll(async () => {
  prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development'; // the dev-admin seed, as `objectstack dev` / bootStack arm it

  kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
  await kernel.use(new HonoServerPlugin({ port: 0 }));
  await kernel.use(new AppPlugin(PIN_APP));
  await kernel.use(new PlatformObjectsPlugin());
  await kernel.use(new AuthPlugin({ secret: 'body-boundary-21520-secret', autoDefaultOrganization: false }));
  await kernel.use(PLATFORM_HOOK_PLUGIN);
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(PIN_APP)));
  await kernel.use(new SharingServicePlugin());
  await kernel.use(createRestApiPlugin({}));
  await kernel.use(createDispatcherPlugin({}));
  await kernel.bootstrap();

  httpServer = await kernel.getServiceAsync('http-server');
  app = httpServer.getRawApp();
  adminToken = await signIn(ADMIN);
  memberToken = await signUpMember();
}, BOOT_TIMEOUT);

afterAll(async () => {
  console.info(`[#21520 pin] metadata door save of a runtime-authored family-table hook answered: ${recordedFamilyHookSaveStatus}`);
  try { await httpServer?.close?.(); } catch { /* best-effort */ }
  try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
}, 60_000);

describe('[#21520] ① binding — a body hook targeting a family table is not bound', () => {
  it('the metadata door\'s save runs no body bound to a family table, and still fires the platform code hook', async () => {
    const before = platformHookRuns;
    const res = await saveThroughMetadataDoor('boundary_saved_one', 'Saved once');
    expect(res.status, JSON.stringify(await readJson(res))).toBeLessThan(300);

    const tags = await columnOf('sys_metadata', { type: 'action', name: 'boundary_saved_one' }, 'tags');
    expect(tags.length, 'the metadata door stored no row').toBeGreaterThan(0);
    for (const value of tags) {
      expect(value, 'an explicitly-bound body ran on the save').not.toContain('explicit-ran');
      expect(value, 'a wildcard body ran on the save').not.toContain('wildcard-ran');
    }
    const notes = await columnOf('sys_metadata_history', { type: 'action', name: 'boundary_saved_one' }, 'change_note');
    for (const value of notes) expect(value, 'a list-form body ran on the history row').not.toContain('explicit-ran');

    expect(platformHookRuns, 'the platform code hook did not fire on the save').toBeGreaterThan(before);
  });

  it('control: the same app\'s hooks on an ordinary table bind and fire, the wildcard among them', async () => {
    const res = await as(adminToken, 'POST', `/data/${ORDINARY}`, { title: 'boundary-control' });
    expect(res.status).toBeLessThan(300);
    const [status] = await columnOf(ORDINARY, { title: 'boundary-control' }, 'status');
    expect(status).toContain('ordinary-ran');
    expect(status).toContain('wildcard-ran');
  });

  it('a hook authored at runtime through the metadata door is not bound to a family table; an ordinary one is', async () => {
    const familyHook = await as(adminToken, 'PUT', '/meta/hook/boundary_authored_on_metadata', {
      name: 'boundary_authored_on_metadata',
      object: 'sys_metadata',
      events: ['beforeInsert', 'beforeUpdate'],
      body: js(append('tags', 'authored-ran')),
    });
    const ordinaryHook = await as(adminToken, 'PUT', '/meta/hook/boundary_authored_ordinary', {
      name: 'boundary_authored_ordinary',
      object: ORDINARY,
      events: ['beforeInsert'],
      body: js(append('status', 'authored-ran')),
    });
    expect(ordinaryHook.status, JSON.stringify(await readJson(ordinaryHook))).toBeLessThan(300);
    // Recorded, not asserted: whether the metadata door accepts the family hook
    // at save is the save door's question; this boundary refuses it at bind.
    recordedFamilyHookSaveStatus = familyHook.status;

    // The resync has bound the ordinary authored hook once it fires…
    const bound = await waitFor(async () => {
      await as(adminToken, 'POST', `/data/${ORDINARY}`, { title: 'boundary-authored-probe' });
      const statuses = await columnOf(ORDINARY, { title: 'boundary-authored-probe' }, 'status');
      return statuses.some((s) => s.includes('authored-ran'));
    });
    expect(bound, 'the runtime-authored ordinary hook never bound').toBe(true);

    // …and by then the family one, had it bound, would run on this save.
    const res = await saveThroughMetadataDoor('boundary_saved_two', 'Saved after the authored hooks');
    expect(res.status).toBeLessThan(300);
    for (const value of await columnOf('sys_metadata', { type: 'action', name: 'boundary_saved_two' }, 'tags')) {
      expect(value, 'a runtime-authored body ran on the save').not.toContain('authored-ran');
    }
  }, 30_000);
});

describe('[#21520] ② writing — an action body may not write a family table', () => {
  for (const [role, token] of [['administrator', () => adminToken], ['member', () => memberToken]] as const) {
    it(`invoked by the ${role}: each family write answers 403 PERMISSION_DENIED and lands nothing`, async () => {
      for (const action of ['body_inserts_metadata', 'body_updates_metadata', 'body_inserts_history']) {
        const res = await as(token(), 'POST', `/actions/${ORDINARY}/${action}`, { params: {} });
        const payload = await readJson(res);
        expect(res.status, `${action}: ${JSON.stringify(payload)}`).toBe(403);
        expect(payload?.error?.code ?? payload?.code, action).toBe('PERMISSION_DENIED');
      }
      expect(await columnOf('sys_metadata', { name: 'boundary_body_row' }, 'name')).toEqual([]);
      expect(await columnOf('sys_metadata_history', { name: 'boundary_body_row' }, 'name')).toEqual([]);
      for (const value of await columnOf('sys_metadata', { type: 'action' }, 'tags')) {
        expect(value, 'the predicate update landed').not.toContain('body-wrote');
      }
    });

    it(`invoked by the ${role}: the same body's write of an ordinary table lands (control)`, async () => {
      const before = (await columnOf(ORDINARY, { title: 'body-wrote' }, 'title')).length;
      const res = await as(token(), 'POST', `/actions/${ORDINARY}/body_inserts_ordinary`, { params: {} });
      expect(res.status, JSON.stringify(await readJson(res))).toBe(200);
      expect((await columnOf(ORDINARY, { title: 'body-wrote' }, 'title')).length).toBe(before + 1);
    });
  }
});
