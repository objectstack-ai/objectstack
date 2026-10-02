// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21454] REACH PROBE — two in-process reader contexts against the
 * stored-metadata-body family (`sys_metadata` / `sys_metadata_history`: the
 * `metadata` body column and the `checksum` content-hash column).
 *
 * A measurement, not a fix. It asks one question per context: does the
 * context, as a served stack composes it, hand back the family's stored body
 * or stored content hash UNPROJECTED? And it asks it beside a CONTROL — the
 * same row read through a family door (the generic data door) — because a
 * probe whose control does not show the projected / keyed form measures
 * nothing.
 *
 * Contexts:
 *   ① a sandboxed body's object API — `ctx.api.object(...)` resolved by
 *     `buildSandboxApi` (`sandbox/body-runner.ts`):
 *       ①a an action body, dispatched by the REST `/actions` door;
 *       ①b a hook (automation) body, fired by a data-door insert;
 *       ①c an action body AUTHORED AT RUNTIME through the `/meta` door;
 *   ② an action handler's engine handle — `ctx.engine.find`
 *     (`buildActionEngineFacade`, `action-execution.ts`), a code handler
 *     registered with `engine.registerAction`, dispatched by `/actions`.
 *
 * Composition: an in-process `ObjectKernel` assembled from the same plugins,
 * in the same order, that `@objectstack/verify`'s `bootStack` uses (it mirrors
 * `objectstack dev` / `serve`) — engine, declared default datasource
 * (sqlite-wasm), HTTP server, the app, platform objects, auth, security,
 * sharing, REST and the dispatcher — with requests injected through the HTTP
 * app, signed in as real users. Two of `bootStack`'s plugins are absent
 * because this package does not depend on them: the settings service (the
 * crypto provider — so the keyed hash runs on the process-scoped ephemeral key
 * the family already declares for that case) and analytics (on neither path).
 *
 * The credential is a synthetic sentinel. It is stored by the production
 * writer (`PUT /meta/datasource/:name`, as the administrator) in the one
 * credential slot the datasource write door still admits.
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
const MEMBER = { email: 'probe-member@example.invalid', password: 'Member-Pass-123' };

/** The synthetic credential — stored in the datasource body's still-writable credential slot. */
const SENTINEL = 'reach-probe-sentinel-6c1e9b';
const DS_NAME = 'probe_ds';

/** What every context reads: the stored row of the probe datasource. */
const FAMILY_READ_SOURCE = `const rows = await ctx.api.object('sys_metadata').find({ where: { type: 'datasource', name: '${DS_NAME}' } });`;

const actionBody = {
  language: 'js',
  source: `${FAMILY_READ_SOURCE}\nreturn { rows };`,
  capabilities: ['api.read'],
  timeoutMs: 5000,
};

const PROBE_APP: any = {
  manifest: { id: 'com.probe.reach21454', name: 'Reach probe', version: '1.0.0' },
  objects: [
    {
      name: 'probe_note',
      label: 'Probe note',
      fields: {
        title: { type: 'text', label: 'Title' },
        observed: { type: 'textarea', label: 'Observed' },
      },
      actions: [
        // ①a — a sandboxed action body.
        { name: 'probe_body_reads_family', label: 'Probe body read', type: 'script', body: actionBody },
        // ② — declared here; its handler is code registered by PROBE_HANDLER_PLUGIN.
        { name: 'probe_handler_reads_family', label: 'Probe handler read', type: 'script' },
      ],
    },
  ],
  hooks: [
    // ①b — a sandboxed hook (automation) body: it records what it read on the row being inserted.
    {
      name: 'probe_hook_reads_family',
      object: 'probe_note',
      events: ['beforeInsert'],
      body: {
        language: 'js',
        source: `if (ctx.input.title !== 'probe-hook') return;\n${FAMILY_READ_SOURCE}\nctx.input.observed = JSON.stringify(rows);`,
        capabilities: ['api.read'],
        timeoutMs: 5000,
      },
    },
  ],
  permissions: [
    {
      name: 'probe_member_default',
      label: 'Probe member default',
      isDefault: true,
      objects: { probe_note: { allowRead: true, allowCreate: true } },
    },
  ],
};

/** ② — host code registering an action handler, the way a plugin does. */
const PROBE_HANDLER_PLUGIN: any = {
  name: 'probe.reach21454.handler',
  version: '0.0.0',
  init: async () => {},
  start: async (ctx: any) => {
    const ql: any = ctx.getService('objectql');
    ql.registerAction(
      'probe_note',
      'probe_handler_reads_family',
      async (actionCtx: any) => {
        const rows = await actionCtx.engine.find('sys_metadata', {
          where: { type: 'datasource', name: DS_NAME },
        });
        return { rows };
      },
      'probe.reach21454.handler',
    );
  },
};

type Form = 'stored-cleartext' | 'projected' | 'keyed' | 'withheld' | 'refused' | 'no-row' | 'unexpected';
interface Reading {
  context: string;
  door: string;
  role: string;
  status: number;
  bodyForm: Form;
  hashForm: Form;
  code?: string;
  note?: string;
}

const READINGS: Reading[] = [];

let kernel: any;
let httpServer: any;
let app: any;
let adminToken: string;
let memberToken: string;
let storedRow: Record<string, any>;
let storedHistory: { rows: number; carriesCredential: boolean };
let prevNodeEnv: string | undefined;

const req = (path: string, init?: RequestInit) => app.request(`${ORIGIN}${API}${path}`, init);
const as = (token: string | undefined, method: string, path: string, body?: unknown) =>
  req(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Every object anywhere in `value` that carries a `metadata` key (a family row as served). */
function familyRowsIn(value: unknown, out: Array<Record<string, any>> = []): Array<Record<string, any>> {
  if (Array.isArray(value)) {
    for (const v of value) familyRowsIn(v, out);
  } else if (value && typeof value === 'object') {
    const obj = value as Record<string, any>;
    if ('metadata' in obj && ('checksum' in obj || 'type' in obj)) out.push(obj);
    for (const v of Object.values(obj)) familyRowsIn(v, out);
  }
  return out;
}

function bodyFormOf(status: number, payload: unknown): Form {
  if (status >= 400) return 'refused';
  const rows = familyRowsIn(payload);
  if (rows.length === 0) return JSON.stringify(payload ?? null).includes(SENTINEL) ? 'stored-cleartext' : 'no-row';
  const text = JSON.stringify(rows.map((r) => r.metadata));
  if (text.includes(SENTINEL)) return 'stored-cleartext';
  return rows.every((r) => r.metadata === undefined || r.metadata === null) ? 'withheld' : 'projected';
}

function hashFormOf(status: number, payload: unknown): Form {
  if (status >= 400) return 'refused';
  const rows = familyRowsIn(payload);
  if (rows.length === 0) return 'no-row';
  const served = rows.map((r) => r.checksum);
  if (served.every((c) => c === undefined || c === null)) return 'withheld';
  if (served.some((c) => c === storedRow.checksum)) return 'stored-cleartext';
  return 'keyed';
}

/** The refusal's ADR-0112 code, when the door refused. */
function refusalCode(status: number, payload: any): string | undefined {
  if (status < 400) return undefined;
  return payload?.error?.code ?? payload?.code ?? undefined;
}

function record(context: string, door: string, role: string, status: number, payload: unknown, note?: string) {
  const code = refusalCode(status, payload);
  const reading: Reading = {
    context,
    door,
    role,
    status,
    bodyForm: bodyFormOf(status, payload),
    hashForm: hashFormOf(status, payload),
    ...(code ? { code } : {}),
    ...(note ? { note } : {}),
  };
  READINGS.push(reading);
  return reading;
}

async function signIn(who: { email: string; password: string }): Promise<string> {
  const res = await req('/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(who),
  });
  if (!res.ok) throw new Error(`probe signIn failed: ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  return data.token;
}

async function signUpMember(): Promise<string> {
  // Default audience posture is invite_only: enter through a pending invitation,
  // the same lane `@objectstack/verify`'s signUp takes.
  const engine: any = await kernel.getServiceAsync('objectql');
  await engine.insert(
    'sys_invitation',
    {
      id: 'inv_probe_21454',
      email: MEMBER.email,
      status: 'pending',
      organization_id: 'org_probe_audience_gate',
      role: 'member',
      inviter_id: 'usr_probe_audience_gate',
      expires_at: new Date(Date.now() + 3_600_000),
    },
    { context: { isSystem: true } },
  );
  const res = await req('/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: MEMBER.email, password: MEMBER.password, name: 'probe member' }),
  });
  if (!res.ok) throw new Error(`probe signUp failed: ${res.status} ${await res.text()}`);
  const data: any = await res.json();
  return data.token;
}

async function waitFor(predicate: () => Promise<boolean>, ms = 15_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

beforeAll(async () => {
  prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development'; // the dev-admin seed, as `objectstack dev` / bootStack arm it

  kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
  await kernel.use(new HonoServerPlugin({ port: 0 }));
  await kernel.use(new AppPlugin(PROBE_APP));
  await kernel.use(new PlatformObjectsPlugin());
  await kernel.use(new AuthPlugin({ secret: 'reach-probe-21454-secret', autoDefaultOrganization: false }));
  await kernel.use(PROBE_HANDLER_PLUGIN);
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(PROBE_APP)));
  await kernel.use(new SharingServicePlugin());
  await kernel.use(createRestApiPlugin({}));
  await kernel.use(createDispatcherPlugin({}));
  await kernel.bootstrap();

  httpServer = await kernel.getServiceAsync('http-server');
  app = httpServer.getRawApp();

  adminToken = await signIn(ADMIN);
  memberToken = await signUpMember();

  // The stored credential, written by the production writer as the administrator.
  const save = await as(adminToken, 'PUT', `/meta/datasource/${DS_NAME}`, {
    name: DS_NAME,
    label: 'Probe datasource',
    driver: 'turso',
    config: { url: 'libsql://probe.example.invalid', encryptionKey: SENTINEL },
  });
  const saveBody = await readJson(save);
  if (save.status >= 300) throw new Error(`probe seed refused: ${save.status} ${JSON.stringify(saveBody)}`);

  // The STORED form, read in-process (not a door): the reference every reading is judged against.
  const engine: any = await kernel.getServiceAsync('objectql');
  const rows: any[] = await engine.find('sys_metadata', {
    where: { type: 'datasource', name: DS_NAME },
    context: { isSystem: true },
  });
  storedRow = rows[0];
  // The family's second table: does this save leave a stored body in history too?
  const history: any[] = await engine.find('sys_metadata_history', {
    where: { type: 'datasource', name: DS_NAME },
    context: { isSystem: true },
  });
  storedHistory = {
    rows: history.length,
    carriesCredential: history.some((h) => String(h.metadata ?? '').includes(SENTINEL)),
  };
}, BOOT_TIMEOUT);

afterAll(async () => {
  // Forms only — never the values.
  // eslint-disable-next-line no-console
  console.log(`[#21454 reach probe] stored history for the probe row: ${JSON.stringify(storedHistory)}`);
  // eslint-disable-next-line no-console
  console.log(`[#21454 reach probe] readings\n${JSON.stringify(READINGS, null, 2)}`);
  try { await httpServer?.close?.(); } catch { /* best-effort */ }
  try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
}, 60_000);

describe('[#21454] precondition — the fixture stores what the family protects', () => {
  it('the stored row carries the credential in its body and a content hash', () => {
    expect(storedRow, 'the datasource row exists in sys_metadata').toBeDefined();
    expect(String(storedRow.metadata)).toContain(SENTINEL);
    expect(typeof storedRow.checksum).toBe('string');
    expect(storedRow.checksum.length).toBeGreaterThan(0);
  });
});

describe('[#21454] CONTROL — the same row through a family door (generic data door)', () => {
  it('administrator, list: the body is projected and the hash keyed', async () => {
    const res = await as(adminToken, 'GET', `/data/sys_metadata?type=datasource&name=${DS_NAME}`);
    const payload = await readJson(res);
    const reading = record('control', 'data door list', 'administrator', res.status, payload);
    expect(reading.status).toBe(200);
    // The projection of THIS row: its non-credential config survives.
    expect(JSON.stringify(familyRowsIn(payload).map((r) => r.metadata))).toContain('probe.example.invalid');
    expect(reading.bodyForm).toBe('projected');
    expect(reading.hashForm).toBe('keyed');
  });

  it('administrator, get by id: the body is projected and the hash keyed', async () => {
    const res = await as(adminToken, 'GET', `/data/sys_metadata/${storedRow.id}`);
    const payload = await readJson(res);
    const reading = record('control', 'data door get', 'administrator', res.status, payload);
    expect(reading.status).toBe(200);
    expect(JSON.stringify(familyRowsIn(payload).map((r) => r.metadata))).toContain('probe.example.invalid');
    expect(reading.bodyForm).toBe('projected');
    expect(reading.hashForm).toBe('keyed');
  });

  it('member, list: refused (or no row served)', async () => {
    const res = await as(memberToken, 'GET', `/data/sys_metadata?type=datasource&name=${DS_NAME}`);
    const reading = record('control', 'data door list', 'member', res.status, await readJson(res));
    expect(['refused', 'no-row']).toContain(reading.bodyForm);
  });
});

describe('[#21454] ① a sandboxed body\'s object API (ctx.api.object)', () => {
  it('①a action body via /actions — administrator invoking', async () => {
    const res = await as(adminToken, 'POST', '/actions/probe_note/probe_body_reads_family', { params: {} });
    const reading = record('①a action body ctx.api', '/actions', 'administrator', res.status, await readJson(res));
    expect(reading.status).toBeLessThan(300);
  });

  it('①a action body via /actions — member invoking (the body runs elevated)', async () => {
    const res = await as(memberToken, 'POST', '/actions/probe_note/probe_body_reads_family', { params: {} });
    record('①a action body ctx.api', '/actions', 'member', res.status, await readJson(res));
  });

  it('①b hook body fired by a data-door insert — administrator writing', async () => {
    const res = await as(adminToken, 'POST', '/data/probe_note', { title: 'probe-hook' });
    const created = await readJson(res);
    const engine: any = await kernel.getServiceAsync('objectql');
    const rows: any[] = await engine.find('probe_note', { where: { title: 'probe-hook' }, context: { isSystem: true } });
    const observed = rows[0]?.observed ? JSON.parse(rows[0].observed) : undefined;
    record(
      '①b hook body ctx.api',
      'data door insert (hook beforeInsert)',
      'administrator',
      res.status,
      observed ?? created,
      observed ? 'judged on what the hook recorded on the row it wrote' : 'hook recorded nothing',
    );
  });

  it('①b hook body fired by a data-door insert — member writing', async () => {
    const res = await as(memberToken, 'POST', '/data/probe_note', { title: 'probe-hook' });
    const created = await readJson(res);
    const engine: any = await kernel.getServiceAsync('objectql');
    const rows: any[] = await engine.find('probe_note', { where: { title: 'probe-hook' }, context: { isSystem: true } });
    const mine = rows.find((r) => r.created_by && r.created_by !== rows[0]?.created_by) ?? (rows.length > 1 ? rows[1] : undefined);
    const observed = mine?.observed ? JSON.parse(mine.observed) : undefined;
    record(
      '①b hook body ctx.api',
      'data door insert (hook beforeInsert)',
      'member',
      res.status,
      observed ?? created,
      observed ? 'judged on what the hook recorded on the row it wrote' : `insert answered ${res.status}; hook recorded nothing`,
    );
  });

  it('①c action body AUTHORED AT RUNTIME through /meta, then invoked via /actions — administrator', async () => {
    const authored = await as(adminToken, 'PUT', '/meta/action/probe_authored_reads_family', {
      name: 'probe_authored_reads_family',
      label: 'Probe authored read',
      objectName: 'probe_note',
      type: 'script',
      body: actionBody,
    });
    const authoredBody = await readJson(authored);
    let res: Response | undefined;
    let payload: unknown = authoredBody;
    const bound = await waitFor(async () => {
      res = await as(adminToken, 'POST', '/actions/probe_note/probe_authored_reads_family', { params: {} });
      payload = await readJson(res);
      return res.status < 300;
    });
    record(
      '①c runtime-authored action body ctx.api',
      '/meta PUT then /actions',
      'administrator',
      res?.status ?? authored.status,
      payload,
      `/meta PUT answered ${authored.status}; bound=${bound}`,
    );
  }, 30_000);

  it('①c authoring the same body through /meta — member (who may author it?)', async () => {
    const authored = await as(memberToken, 'PUT', '/meta/action/probe_member_authored', {
      name: 'probe_member_authored',
      label: 'Probe member authored',
      objectName: 'probe_note',
      type: 'script',
      body: actionBody,
    });
    record('①c authoring door', '/meta PUT', 'member', authored.status, await readJson(authored));
  });
});

describe('[#21454] ② an action handler\'s engine handle (ctx.engine.find)', () => {
  it('② code handler via /actions — administrator invoking', async () => {
    const res = await as(adminToken, 'POST', '/actions/probe_note/probe_handler_reads_family', { params: {} });
    const reading = record('② action handler ctx.engine', '/actions', 'administrator', res.status, await readJson(res));
    expect(reading.status).toBeLessThan(300);
  });

  it('② code handler via /actions — member invoking', async () => {
    const res = await as(memberToken, 'POST', '/actions/probe_note/probe_handler_reads_family', { params: {} });
    record('② action handler ctx.engine', '/actions', 'member', res.status, await readJson(res));
  });
});
