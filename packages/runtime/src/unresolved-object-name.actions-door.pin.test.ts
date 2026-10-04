// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21516] One name space for the engine's in-process verbs and the data door,
 * pinned at the door a deployment exposes: an action body run through REST
 * `/actions`.
 *
 * A sandboxed body's object API reaches the engine's in-process verbs. Those
 * verbs used to hand a name the schema registry does not resolve to the driver
 * as a raw table name, so a body could read a table by a name the generic data
 * door refuses with `404 OBJECT_NOT_FOUND` — and every in-process guard keyed by
 * a registered object name could be stepped around by naming the target some
 * other way. The engine now refuses that name with the door's own envelope.
 *
 * The target is a table that EXISTS and holds a row, created out of band at the
 * driver and registered nowhere: the class the card measured, without naming
 * any protected table. Pinned, per the triage ruling:
 *   - the measured exit now answers not-found, for a member and an
 *     administrator (the action runs elevated, so both reach the same engine);
 *   - a registered name read the same way is the control;
 *   - the data door's own answer for the same name is the reference.
 *
 * Composition: the plugin set, in order, `@objectstack/verify`'s `bootStack`
 * uses (it mirrors `objectstack dev` / `serve`), as the #21454 reader-seam pins
 * assemble it; the boot is paid in `beforeAll`, never inside a case.
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
const ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };
const MEMBER = { email: 'pin-21516-member@example.invalid', password: 'Member-Pass-123' };

/** A table that exists at the driver and that no registry entry names. */
const UNREGISTERED = 'pin_offbook_21516';
/** The value the out-of-band row carries: what no answer below may contain. */
const SENTINEL = 'offbook-sentinel-21516';
/** The control row, written through the data door on the registered object. */
const CONTROL_TITLE = 'registered-control-21516';

const body = (source: string) => ({ language: 'js', source, capabilities: ['api.read'], timeoutMs: 5000 });

const PIN_APP: any = {
  manifest: { id: 'com.pin.unresolved21516', name: 'Unresolved name pins', version: '1.0.0' },
  objects: [
    {
      name: 'pin_note',
      label: 'Pin note',
      fields: { title: { type: 'text', label: 'Title' } },
      actions: [
        {
          name: 'body_reads_unregistered',
          label: 'Body reads an unregistered name',
          type: 'script',
          body: body(`const rows = await ctx.api.object('${UNREGISTERED}').find({});\nreturn { rows };`),
        },
        {
          name: 'body_reads_registered',
          label: 'Body reads a registered name',
          type: 'script',
          body: body(`const rows = await ctx.api.object('pin_note').find({});\nreturn { rows };`),
        },
      ],
    },
  ],
  permissions: [
    {
      name: 'pin_21516_member_default',
      label: 'Pin member default',
      isDefault: true,
      objects: { pin_note: { allowRead: true, allowCreate: true } },
    },
  ],
};

let kernel: any;
let httpServer: any;
let app: any;
let engine: any;
let adminToken: string;
let memberToken: string;
let prevNodeEnv: string | undefined;

const req = (path: string, init?: RequestInit) => app.request(`${ORIGIN}${API}${path}`, init);
const as = (token: string | undefined, method: string, path: string, payload?: unknown) =>
  req(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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

/** The ADR-0112 code, wherever the door's envelope carries it. */
const codeOf = (payload: any): unknown => payload?.error?.code ?? payload?.code;

async function signIn(who: { email: string; password: string }): Promise<string> {
  const res = await req('/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(who),
  });
  if (!res.ok) throw new Error(`pin signIn failed: ${res.status} ${await res.text()}`);
  return (await res.json() as any).token;
}

async function signUpMember(): Promise<string> {
  // Default audience posture is invite_only: enter through a pending invitation,
  // the lane `@objectstack/verify`'s signUp takes.
  await engine.insert(
    'sys_invitation',
    {
      id: 'inv_pin_21516',
      email: MEMBER.email,
      status: 'pending',
      organization_id: 'org_pin_21516',
      role: 'member',
      inviter_id: 'usr_pin_21516',
      expires_at: new Date(Date.now() + 3_600_000),
    },
    { context: { isSystem: true } },
  );
  const res = await req('/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: MEMBER.email, password: MEMBER.password, name: 'pin member' }),
  });
  if (!res.ok) throw new Error(`pin signUp failed: ${res.status} ${await res.text()}`);
  return (await res.json() as any).token;
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
  await kernel.use(new AuthPlugin({ secret: 'unresolved-name-21516-secret', autoDefaultOrganization: false }));
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(PIN_APP)));
  await kernel.use(new SharingServicePlugin());
  await kernel.use(createRestApiPlugin({}));
  await kernel.use(createDispatcherPlugin({}));
  await kernel.bootstrap();

  httpServer = await kernel.getServiceAsync('http-server');
  app = httpServer.getRawApp();
  engine = await kernel.getServiceAsync('objectql');

  // The out-of-band table, created and written at the DRIVER (host code's
  // declared internal path), and registered nowhere.
  const driver = engine.getDriverByName(engine.getDefaultDriverName());
  await driver.syncSchema(UNREGISTERED, {
    name: UNREGISTERED,
    fields: { id: { name: 'id', type: 'text', primaryKey: true }, secret: { name: 'secret', type: 'text' } },
  });
  await driver.create(UNREGISTERED, { id: 'offbook_1', secret: SENTINEL });

  adminToken = await signIn(ADMIN);
  memberToken = await signUpMember();
  const seeded = await as(adminToken, 'POST', '/data/pin_note', { title: CONTROL_TITLE });
  if (seeded.status >= 300) throw new Error(`pin seed refused: ${seeded.status} ${JSON.stringify(await readJson(seeded))}`);
}, BOOT_TIMEOUT);

afterAll(async () => {
  try { await httpServer?.close?.(); } catch { /* best-effort */ }
  try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
}, 60_000);

describe('[#21516] precondition and reference', () => {
  it('the table exists at the driver and holds the row; no registry entry names it', async () => {
    expect(engine.registry.getObject(UNREGISTERED)).toBeUndefined();
    const driver = engine.getDriverByName(engine.getDefaultDriverName());
    const rows: any[] = await driver.find(UNREGISTERED, {});
    expect(rows.map((r) => r.secret)).toEqual([SENTINEL]);
  });

  it('the generic data door answers 404 OBJECT_NOT_FOUND for the same name', async () => {
    const res = await as(adminToken, 'GET', `/data/${UNREGISTERED}`);
    const payload = await readJson(res);
    expect(res.status).toBe(404);
    expect(codeOf(payload)).toBe('OBJECT_NOT_FOUND');
    expect(JSON.stringify(payload)).not.toContain(SENTINEL);
  });
});

describe('[#21516] an action body via /actions reading a name the registry does not resolve', () => {
  for (const [role, token] of [['administrator', () => adminToken], ['member', () => memberToken]] as const) {
    it(`invoked by the ${role}: answers not-found, and nothing of the table reaches the answer`, async () => {
      const res = await as(token(), 'POST', '/actions/pin_note/body_reads_unregistered', { params: {} });
      const payload = await readJson(res);
      expect({ status: res.status, code: codeOf(payload) }).toEqual({ status: 404, code: 'OBJECT_NOT_FOUND' });
      expect(JSON.stringify(payload)).not.toContain(SENTINEL);
    });
  }
});

describe('[#21516] CONTROL — the same body shape on a registered name', () => {
  for (const [role, token] of [['administrator', () => adminToken], ['member', () => memberToken]] as const) {
    it(`invoked by the ${role}: served`, async () => {
      const res = await as(token(), 'POST', '/actions/pin_note/body_reads_registered', { params: {} });
      const payload = await readJson(res);
      expect(res.status).toBe(200);
      expect(JSON.stringify(payload)).toContain(CONTROL_TITLE);
    });
  }
});
