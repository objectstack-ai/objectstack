// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The in-process reader contexts over the stored-metadata-body family
 * (`sys_metadata` / `sys_metadata_history`: the `metadata` body column and the
 * `checksum` content-hash column), each through the door a deployment exposes.
 *
 * [#21594] ① A sandboxed BODY may not read the family at all: for an
 * app-authored body the family is reached through the metadata API only. Every
 * read verb (`find`, `findOne`, `count`, `aggregate`), and every filter, sort,
 * grouping or search a read carries, answers the body boundary's
 * `403 PERMISSION_DENIED` with a prescription naming the metadata API's read
 * route, and carries no family content:
 *       an action body, dispatched by the REST `/actions` door, read plainly
 *       and inside `ctx.api.transaction`;
 *       a hook body fired by a data-door insert, which would COPY what it read
 *       into an ordinary record (the insert is refused and nothing lands);
 *       an action body authored at runtime through the `/meta` door.
 *
 * [#21454] ② / ③ An action HANDLER — host code registered with `registerAction`
 * — is still served the family the way the generic data door serves it: the
 * body as its type's read projection, the hash in keyed form, judged against
 * the SAME stored row read through the data door (no stored credential and no
 * stored hash anywhere in the answer, the row's non-credential configuration
 * present, and the served hash equal to the one the door serves for that row):
 *   ② its engine handle, `ctx.engine.find` (`buildActionEngineFacade`);
 *   ③ its `ctx.api` (`buildActionApi`).
 *
 * [#21594] Nor is a body HANDED a family row: an action whose subject record
 * the `/actions` door loads from a family table (declared there, through the
 * bundle or the `/meta` door, or object-less and addressed under it) is
 * refused with the same 403 before its body runs; a host handler's subject
 * record and an ordinary one are pinned unchanged.
 *
 * Platform readers are outside the boundary, pinned as controls: the generic
 * data door, the metadata API (the route the refusal prescribes) and the
 * engine's own in-process read of the stored form.
 *
 * The action contexts run elevated, so a member invoking one is answered what
 * an administrator is: both are pinned.
 *
 * Composition: an in-process `ObjectKernel` assembled from the plugins, in the
 * order, `@objectstack/verify`'s `bootStack` uses (it mirrors `objectstack dev`
 * / `serve`): engine, declared default datasource (sqlite-wasm), HTTP server,
 * the app, platform objects, auth, security, sharing, REST and the dispatcher,
 * with requests injected through the HTTP app, signed in as real users. Two of
 * `bootStack`'s plugins are absent because this package does not depend on
 * them: the settings service (the crypto provider, so the keyed hash runs on the
 * process-scoped ephemeral key the family declares for that case) and
 * analytics (on no path here). The boot is paid in `beforeAll`, never inside a
 * case.
 *
 * The credential is a synthetic sentinel, stored by the production writer
 * (`PUT /meta/datasource/:name`, as the administrator) in the one credential
 * slot the datasource write door still admits.
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
const MEMBER = { email: 'pin-member@example.invalid', password: 'Member-Pass-123' };

/** The synthetic credential, stored in the datasource body's still-writable credential slot. */
const SENTINEL = 'reader-seam-sentinel-6c1e9b';
const DS_NAME = 'pin_ds';
/** Non-credential configuration of the same body: present in a projection of THIS row. */
const DS_HOST = 'pin.example.invalid';

const readFamilySource = (object: string) =>
  `const rows = await ctx.api.object('${object}').find({ where: { type: 'datasource', name: '${DS_NAME}' } });`;

/** [#21594] A body that only returns the subject record the door handed it. */
const RETURN_RECORD = 'return { record: ctx.record };';

const actionBody = (source: string, capabilities: string[] = ['api.read']) => ({
  language: 'js',
  source,
  capabilities,
  timeoutMs: 5000,
});

const PIN_APP: any = {
  manifest: { id: 'com.pin.reader21454', name: 'Reader seam pins', version: '1.0.0' },
  objects: [
    {
      name: 'pin_note',
      label: 'Pin note',
      fields: {
        title: { type: 'text', label: 'Title' },
        observed: { type: 'textarea', label: 'Observed' },
      },
      actions: [
        // ① sandboxed action bodies.
        {
          name: 'body_reads_family',
          label: 'Body read',
          type: 'script',
          body: actionBody(`${readFamilySource('sys_metadata')}\nreturn { rows };`),
        },
        {
          name: 'body_reads_history',
          label: 'Body history read',
          type: 'script',
          body: actionBody(`${readFamilySource('sys_metadata_history')}\nreturn { rows };`),
        },
        {
          name: 'body_reads_family_one',
          label: 'Body reads one row',
          type: 'script',
          body: actionBody(`return { row: await ctx.api.object('sys_metadata').findOne({ where: { type: 'datasource', name: '${DS_NAME}' } }) };`),
        },
        {
          name: 'body_counts_family',
          label: 'Body counts rows',
          type: 'script',
          body: actionBody(`return { n: await ctx.api.object('sys_metadata').count({ where: { type: 'datasource' } }) };`),
        },
        {
          name: 'body_aggregates_family',
          label: 'Body aggregates rows',
          type: 'script',
          body: actionBody(`return { rows: await ctx.api.object('sys_metadata_history').aggregate({ groupBy: ['type'] }) };`),
        },
        {
          name: 'body_reads_family_in_transaction',
          label: 'Body transaction read',
          type: 'script',
          body: actionBody(
            `let rows;\nawait ctx.api.transaction(async () => {\n  rows = await ctx.api.object('sys_metadata').find({ where: { type: 'datasource', name: '${DS_NAME}' } });\n});\nreturn { rows };`,
            ['api.read', 'api.transaction'],
          ),
        },
        // ② / ③ declared here; their handlers are code registered by PIN_HANDLER_PLUGIN.
        { name: 'handler_engine_reads_family', label: 'Handler engine read', type: 'script' },
        { name: 'handler_engine_reads_history', label: 'Handler engine history read', type: 'script' },
        { name: 'handler_api_reads_family', label: 'Handler api read', type: 'script' },
        // EVALUATE shapes — each body attempts to evaluate the stored body or
        // hash. [#21594] A body's read is refused whatever it carries, so each
        // answers the body boundary's refusal, the same as a plain read. The
        // VALUE in every predicate is an immaterial constant: the query is
        // refused unrun, so nothing depends on what it is.
        {
          name: 'body_filters_body_column',
          label: 'Body filters the body column',
          type: 'script',
          body: actionBody(`return { rows: await ctx.api.object('sys_metadata').find({ where: { metadata: { $contains: 'z' } } }) };`),
        },
        {
          name: 'body_sorts_body_column',
          label: 'Body sorts by the body column',
          type: 'script',
          body: actionBody(`return { rows: await ctx.api.object('sys_metadata').find({ orderBy: [{ field: 'metadata', order: 'asc' }] }) };`),
        },
        {
          name: 'body_groups_body_column',
          label: 'Body groups by the body column',
          type: 'script',
          body: actionBody(`return { rows: await ctx.api.object('sys_metadata_history').aggregate({ groupBy: ['metadata'] }) };`),
        },
        {
          name: 'body_filters_hash_column',
          label: 'Body filters the hash column',
          type: 'script',
          body: actionBody(`return { rows: await ctx.api.object('sys_metadata').find({ where: { checksum: 'z' } }) };`),
        },
        {
          name: 'body_counts_body_column',
          label: 'Body counts by the body column',
          type: 'script',
          body: actionBody(`return { n: await ctx.api.object('sys_metadata').count({ where: { metadata: { $contains: 'z' } } }) };`),
        },
        {
          name: 'body_searches_body_column',
          label: 'Body searches an explicit body column',
          type: 'script',
          body: actionBody(`return { rows: await ctx.api.object('sys_metadata').find({ search: 'z', searchFields: ['metadata'] }) };`),
        },
        // [#21594] A DEFAULT search is refused too: a body searches no family table.
        {
          name: 'body_searches_default',
          label: 'Body default search',
          type: 'script',
          body: actionBody(`return { rows: await ctx.api.object('sys_metadata').find({ search: '${DS_NAME}' }) };`),
        },
        // The engine action verb is not on a served body's surface at all.
        {
          name: 'body_calls_execute',
          label: 'Body calls execute',
          type: 'script',
          body: actionBody(`return { typeofExecute: typeof ctx.api.object('sys_metadata').execute };`),
        },
        // ② the engine handle's evaluate shape — a handler whose ctx.engine.find
        // filters the body column is refused the same way.
        { name: 'handler_engine_filters_body', label: 'Handler engine filters body', type: 'script' },
        // [#21594] subject-record control: an ordinary row is handed to a body as before.
        { name: 'note_reads_record', label: 'Body reads its subject record', type: 'script', body: actionBody(RETURN_RECORD) },
      ],
    },
  ],
  // [#21594] ① the subject record — actions whose subject the `/actions` door
  // loads before dispatch. Declared on a family table, or object-less (a
  // caller may address it under any object), each body only returns
  // `ctx.record`; the host handler is code, registered by PIN_HANDLER_PLUGIN.
  actions: [
    { name: 'family_bound_reads_record', label: 'Family-bound body', objectName: 'sys_metadata', type: 'script', body: actionBody(RETURN_RECORD) },
    { name: 'object_less_reads_record', label: 'Object-less body', type: 'script', body: actionBody(RETURN_RECORD) },
    { name: 'host_object_less_reads_record', label: 'Object-less host handler', type: 'script' },
  ],
  hooks: [
    // ① a sandboxed hook body: it would COPY what it read onto the row being inserted.
    {
      name: 'hook_copies_family',
      object: 'pin_note',
      events: ['beforeInsert'],
      body: actionBody(
        `if (ctx.input.title !== 'pin-hook') return;\n${readFamilySource('sys_metadata')}\nctx.input.observed = JSON.stringify(rows);`,
      ),
    },
  ],
  permissions: [
    {
      name: 'pin_member_default',
      label: 'Pin member default',
      isDefault: true,
      objects: { pin_note: { allowRead: true, allowCreate: true } },
    },
  ],
};

/** ② / ③ — host code registering action handlers, the way a plugin does. */
const PIN_HANDLER_PLUGIN: Plugin = {
  name: 'pin.reader21454.handler',
  version: '0.0.0',
  init: async () => {},
  start: async (ctx: PluginContext) => {
    const ql = ctx.getService<ObjectQL>('objectql');
    const where = { type: 'datasource', name: DS_NAME };
    for (const [action, object] of [
      ['handler_engine_reads_family', 'sys_metadata'],
      ['handler_engine_reads_history', 'sys_metadata_history'],
    ] as const) {
      ql.registerAction(
        'pin_note',
        action,
        async (actionCtx: any) => ({ rows: await actionCtx.engine.find(object, { where }) }),
        'pin.reader21454.handler',
      );
    }
    ql.registerAction(
      'pin_note',
      'handler_api_reads_family',
      async (actionCtx: any) => ({ rows: await actionCtx.api.object('sys_metadata').find({ where }) }),
      'pin.reader21454.handler',
    );
    // [#21454] ② the engine handle's evaluate shape: a filter on the body column.
    ql.registerAction(
      'pin_note',
      'handler_engine_filters_body',
      async (actionCtx: any) => ({ rows: await actionCtx.engine.find('sys_metadata', { where: { metadata: { $contains: 'z' } } }) }),
      'pin.reader21454.handler',
    );
    // [#21594] the subject-record control: a host handler under the object-less key.
    ql.registerAction(
      'global',
      'host_object_less_reads_record',
      async (actionCtx: any) => ({ record: actionCtx.record }),
      'pin.reader21454.handler',
    );
  },
};

let kernel: any;
let httpServer: any;
let app: any;
let adminToken: string;
let memberToken: string;
let storedRow: Record<string, any>;
/** Every stored content hash of the pin row, both tables (`checksum`, `previous_checksum`). */
const storedHashes = new Set<string>();
/** The data door's served (keyed) `checksum`, by row id, both tables: the reference form. */
const doorServedChecksum = new Map<string, string>();
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

/** Every object anywhere in `value` that carries a `metadata` key: a family row as served. */
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

/**
 * The pin: `payload` serves the family the way the data door does. Stated per
 * property so a failure names the half that regressed.
 */
function expectServedLikeTheDoor(label: string, payload: unknown): void {
  const text = JSON.stringify(payload ?? null);
  expect(text.includes(SENTINEL), `${label}: the stored credential reached the answer`).toBe(false);
  const storedHashesServed = [...storedHashes].filter((h) => text.includes(h));
  expect(storedHashesServed, `${label}: a stored content hash reached the answer`).toEqual([]);
  const rows = familyRowsIn(payload);
  expect(rows.length, `${label}: no family row in the answer at all`).toBeGreaterThan(0);
  for (const row of rows) {
    expect(String(row.metadata), `${label}: the body is not the projection of this row`).toContain(DS_HOST);
    expect(typeof row.checksum, `${label}: the content hash was not served`).toBe('string');
    const reference = doorServedChecksum.get(row.id);
    expect(reference, `${label}: the door served no hash for this row to compare with`).toBeDefined();
    expect(row.checksum, `${label}: the hash is not the door's keyed form for this row`).toBe(reference);
  }
}

async function signIn(who: { email: string; password: string }): Promise<string> {
  const res = await req('/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(who),
  });
  if (!res.ok) throw new Error(`pin signIn failed: ${res.status} ${await res.text()}`);
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
      id: 'inv_pin_21454',
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
    body: JSON.stringify({ email: MEMBER.email, password: MEMBER.password, name: 'pin member' }),
  });
  if (!res.ok) throw new Error(`pin signUp failed: ${res.status} ${await res.text()}`);
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
  await kernel.use(new AppPlugin(PIN_APP));
  await kernel.use(new PlatformObjectsPlugin());
  await kernel.use(new AuthPlugin({ secret: 'reader-seam-21454-secret', autoDefaultOrganization: false }));
  await kernel.use(PIN_HANDLER_PLUGIN);
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(PIN_APP)));
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
    label: 'Pin datasource',
    driver: 'turso',
    config: { url: `libsql://${DS_HOST}`, encryptionKey: SENTINEL },
  });
  if (save.status >= 300) throw new Error(`pin seed refused: ${save.status} ${JSON.stringify(await readJson(save))}`);

  // The STORED form, read in-process (not a door): what no answer may carry.
  const engine: any = await kernel.getServiceAsync('objectql');
  const where = { type: 'datasource', name: DS_NAME };
  const rows: any[] = await engine.find('sys_metadata', { where, context: { isSystem: true } });
  const history: any[] = await engine.find('sys_metadata_history', { where, context: { isSystem: true } });
  storedRow = rows[0];
  for (const row of [...rows, ...history]) {
    for (const column of ['checksum', 'previous_checksum']) {
      if (typeof row?.[column] === 'string' && row[column].length > 0) storedHashes.add(row[column]);
    }
  }

  // The REFERENCE form: the same rows through the data door, as the administrator.
  for (const object of ['sys_metadata', 'sys_metadata_history']) {
    const res = await as(adminToken, 'GET', `/data/${object}?type=datasource&name=${DS_NAME}`);
    for (const row of familyRowsIn(await readJson(res))) {
      if (typeof row.id === 'string' && typeof row.checksum === 'string') doorServedChecksum.set(row.id, row.checksum);
    }
  }
}, BOOT_TIMEOUT);

afterAll(async () => {
  try { await httpServer?.close?.(); } catch { /* best-effort */ }
  try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
}, 60_000);

describe('[#21454] precondition — the fixture stores what the family protects', () => {
  it('the stored rows carry the credential in the body and a content hash, in both tables', async () => {
    expect(storedRow, 'the datasource row exists in sys_metadata').toBeDefined();
    expect(String(storedRow.metadata)).toContain(SENTINEL);
    expect(typeof storedRow.checksum).toBe('string');
    const engine: any = await kernel.getServiceAsync('objectql');
    const history: any[] = await engine.find('sys_metadata_history', {
      where: { type: 'datasource', name: DS_NAME },
      context: { isSystem: true },
    });
    expect(history.some((h) => String(h.metadata ?? '').includes(SENTINEL))).toBe(true);
  });
});

describe('[#21454] CONTROL — the same rows through the generic data door (unchanged)', () => {
  it('administrator, list and history list: the body projected, the hash keyed', async () => {
    for (const object of ['sys_metadata', 'sys_metadata_history']) {
      const res = await as(adminToken, 'GET', `/data/${object}?type=datasource&name=${DS_NAME}`);
      expect(res.status).toBe(200);
      const payload = await readJson(res);
      // Keyed: present, and never a stored value (the shared check below compares it with itself).
      for (const row of familyRowsIn(payload)) expect(row.checksum).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
      expectServedLikeTheDoor(`data door ${object}`, payload);
    }
  });

  it('administrator, get by id: the body projected, the hash keyed', async () => {
    const res = await as(adminToken, 'GET', `/data/sys_metadata/${storedRow.id}`);
    expect(res.status).toBe(200);
    expectServedLikeTheDoor('data door get', await readJson(res));
  });

  it('member, list: refused', async () => {
    const res = await as(memberToken, 'GET', `/data/sys_metadata?type=datasource&name=${DS_NAME}`);
    const payload = await readJson(res);
    expect(res.status).toBe(403);
    expect(payload?.error?.code ?? payload?.code).toBe('PERMISSION_DENIED');
  });
});

/**
 * [#21594] The body boundary's read refusal, as a door serves it: `403
 * PERMISSION_DENIED`, a message naming the metadata API's read route, and no
 * family content anywhere in the answer — neither the stored credential, nor a
 * stored hash, nor a family row in any form (a projection included).
 */
async function expectBodyReadRefused(label: string, res: Response): Promise<void> {
  const payload = await readJson(res);
  const text = JSON.stringify(payload ?? null);
  // Both wire shapes in use: the nested envelope (`error.code` / `error.message`)
  // and the data door's flat one (`code` beside a string `error`).
  const code = payload?.error?.code ?? payload?.code;
  const message = [payload?.error?.message, payload?.error, payload?.message].find((m) => typeof m === 'string') ?? '';
  expect(res.status, `${label}: ${text}`).toBe(403);
  expect(code, `${label}: the body boundary's code: ${text}`).toBe('PERMISSION_DENIED');
  expect(message, `${label}: the refusal names the metadata API: ${text}`).toContain('GET /api/v1/meta/:type/:name');
  expect(text.includes(SENTINEL), `${label}: the stored credential reached the answer`).toBe(false);
  for (const h of storedHashes) expect(text.includes(h), `${label}: a stored hash reached the answer`).toBe(false);
  expect(familyRowsIn(payload), `${label}: a family row reached the answer`).toEqual([]);
}

describe('[#21594] ① a sandboxed body may not read the family: every read is refused', () => {
  for (const [role, token] of [['administrator', () => adminToken], ['member', () => memberToken]] as const) {
    it(`an action body via /actions, invoked by the ${role}: find, findOne, count and aggregate on both tables`, async () => {
      for (const action of ['body_reads_family', 'body_reads_history', 'body_reads_family_one', 'body_counts_family', 'body_aggregates_family']) {
        await expectBodyReadRefused(`${action} (${role})`, await as(token(), 'POST', `/actions/pin_note/${action}`, { params: {} }));
      }
    });

    it(`an action body reading inside ctx.api.transaction, invoked by the ${role}`, async () => {
      await expectBodyReadRefused(
        `transaction read (${role})`,
        await as(token(), 'POST', '/actions/pin_note/body_reads_family_in_transaction', { params: {} }),
      );
    });

    it(`every evaluate and search shape a body's read carries, invoked by the ${role}: the same refusal, never the door's`, async () => {
      for (const action of [
        'body_filters_body_column',
        'body_sorts_body_column',
        'body_groups_body_column',
        'body_filters_hash_column',
        'body_counts_body_column',
        'body_searches_body_column',
        'body_searches_default',
      ]) {
        await expectBodyReadRefused(`${action} (${role})`, await as(token(), 'POST', `/actions/pin_note/${action}`, { params: {} }));
      }
    });
  }

  it('a hook body fired by a data-door insert is refused the family read, for administrator and member, and copies nothing', async () => {
    for (const [role, token] of [['administrator', adminToken], ['member', memberToken]] as const) {
      await expectBodyReadRefused(`hook read (${role})`, await as(token, 'POST', '/data/pin_note', { title: 'pin-hook' }));
    }
    const engine: any = await kernel.getServiceAsync('objectql');
    const rows: any[] = await engine.find('pin_note', { where: { title: 'pin-hook' }, context: { isSystem: true } });
    expect(rows, 'a refused hook let its insert land').toEqual([]);
  });

  it('an action body authored at runtime through /meta: refused, for administrator and member', async () => {
    const authored = await as(adminToken, 'PUT', '/meta/action/authored_reads_family', {
      name: 'authored_reads_family',
      label: 'Authored read',
      objectName: 'pin_note',
      type: 'script',
      body: actionBody(`${readFamilySource('sys_metadata')}\nreturn { rows };`),
    });
    expect(authored.status).toBeLessThan(300);
    let res: Response | undefined;
    // Bound once the door stops answering "not found": the refusal is the bound body's answer.
    const bound = await waitFor(async () => {
      const attempt: Response = await as(adminToken, 'POST', '/actions/pin_note/authored_reads_family', { params: {} });
      res = attempt;
      return attempt.status !== 404;
    });
    expect(bound, 'the runtime-authored action never bound').toBe(true);
    await expectBodyReadRefused('runtime-authored body (administrator)', res as Response);
    await expectBodyReadRefused(
      'runtime-authored body (member)',
      await as(memberToken, 'POST', '/actions/pin_note/authored_reads_family', { params: {} }),
    );
  }, 30_000);
});

describe('[#21454] ② / ③ an action handler\'s engine handle and scoped API (host code: still served)', () => {
  for (const [role, token] of [['administrator', () => adminToken], ['member', () => memberToken]] as const) {
    it(`ctx.engine.find, invoked by the ${role}: projected, keyed (both tables)`, async () => {
      for (const action of ['handler_engine_reads_family', 'handler_engine_reads_history']) {
        const res = await as(token(), 'POST', `/actions/pin_note/${action}`, { params: {} });
        expect(res.status, action).toBe(200);
        expectServedLikeTheDoor(`${action} (${role})`, await readJson(res));
      }
    });

    it(`ctx.api.object(...).find, invoked by the ${role}: projected, keyed`, async () => {
      const res = await as(token(), 'POST', '/actions/pin_note/handler_api_reads_family', { params: {} });
      expect(res.status).toBe(200);
      expectServedLikeTheDoor(`handler ctx.api (${role})`, await readJson(res));
    });

    it(`the engine handle's filter on the body column, invoked by the ${role}: the data door's own refusal`, async () => {
      // The handler path keeps the door's evaluate refusal (`INVALID_FIELD` /
      // 400), naming the offending column. Across the handler boundary only
      // `code`, `status` and the MESSAGE are guaranteed, so the column is read
      // from the message.
      const res = await as(token(), 'POST', '/actions/pin_note/handler_engine_filters_body', { params: {} });
      const payload = await readJson(res);
      const err = payload?.error ?? payload;
      const text = JSON.stringify(payload ?? null);
      expect(res.status).toBe(400);
      expect(err?.code).toBe('INVALID_FIELD');
      const named = (Array.isArray(err?.fields) && err.fields.includes('metadata'))
        || String(err?.message ?? '').includes("'metadata'");
      expect(named, 'the refusal names the body column').toBe(true);
      expect(text.includes(SENTINEL)).toBe(false);
      for (const h of storedHashes) expect(text.includes(h)).toBe(false);
    });
  }
});

describe('[#21594] platform readers are outside the boundary (controls)', () => {
  it('the metadata API — the route the refusal prescribes — answers the same item, projected', async () => {
    const res = await as(adminToken, 'GET', `/meta/datasource/${DS_NAME}`);
    const text = await res.text();
    expect(res.status, text).toBe(200);
    expect(text).toContain(DS_HOST);
    expect(text.includes(SENTINEL), 'the metadata API served the stored credential').toBe(false);
  });

  it('the engine\'s own in-process read still answers the stored form: the refusal is not in the engine', async () => {
    const engine: any = await kernel.getServiceAsync('objectql');
    for (const object of ['sys_metadata', 'sys_metadata_history']) {
      const rows: any[] = await engine.find(object, { where: { type: 'datasource', name: DS_NAME }, context: { isSystem: true } });
      expect(rows.length, object).toBeGreaterThan(0);
      expect(rows.some((r) => String(r.metadata ?? '').includes(SENTINEL)), object).toBe(true);
    }
  });
});

/**
 * [#21594] The subject record. The `/actions` door loads an action's subject
 * row through the generic data door before it dispatches. A BODY is handed no
 * family row that way: an action declared on a family table, an object-less
 * action addressed under one, and an action declared there through the `/meta`
 * door are each refused with the body boundary's 403 before the body runs. A
 * caller who cannot read the row is stopped earlier by the door's own subject
 * load. A host handler's subject record and an ordinary one are unchanged.
 */
describe('[#21594] ① an action body is not handed a family row as its subject record', () => {
  async function historyRowId(): Promise<string> {
    const engine: any = await kernel.getServiceAsync('objectql');
    const rows: any[] = await engine.find('sys_metadata_history', { where: { type: 'datasource', name: DS_NAME }, context: { isSystem: true } });
    expect(rows.length, 'the fixture stored no history row').toBeGreaterThan(0);
    return rows[0].id;
  }

  it('administrator: an action declared on a family table, and an object-less action under either table, are refused', async () => {
    await expectBodyReadRefused(
      'family-bound action',
      await as(adminToken, 'POST', `/actions/sys_metadata/family_bound_reads_record/${storedRow.id}`, { params: {} }),
    );
    await expectBodyReadRefused(
      'object-less action under sys_metadata',
      await as(adminToken, 'POST', `/actions/sys_metadata/object_less_reads_record/${storedRow.id}`, { params: {} }),
    );
    await expectBodyReadRefused(
      'object-less action under sys_metadata_history',
      await as(adminToken, 'POST', `/actions/sys_metadata_history/object_less_reads_record/${await historyRowId()}`, { params: {} }),
    );
  });

  it('an action declared on a family table through the /meta door is refused once bound', async () => {
    const authored = await as(adminToken, 'PUT', '/meta/action/authored_family_bound_reads_record', {
      name: 'authored_family_bound_reads_record',
      label: 'Authored family-bound body',
      objectName: 'sys_metadata',
      type: 'script',
      body: actionBody(RETURN_RECORD),
    });
    expect(authored.status).toBeLessThan(300);
    let res: Response | undefined;
    const bound = await waitFor(async () => {
      const attempt: Response = await as(adminToken, 'POST', `/actions/sys_metadata/authored_family_bound_reads_record/${storedRow.id}`, { params: {} });
      res = attempt;
      return attempt.status !== 404;
    });
    expect(bound, 'the runtime-authored action never bound').toBe(true);
    await expectBodyReadRefused('runtime-authored family-bound action', res as Response);
  }, 30_000);

  it('member: the door\'s own subject load stops it first (the row is not readable), and the body never runs', async () => {
    for (const action of ['family_bound_reads_record', 'object_less_reads_record']) {
      const res = await as(memberToken, 'POST', `/actions/sys_metadata/${action}/${storedRow.id}`, { params: {} });
      const payload = await readJson(res);
      expect(res.status, action).toBe(404);
      expect(payload?.error?.code ?? payload?.code, action).toBe('RECORD_NOT_FOUND');
      expect(familyRowsIn(payload), `${action}: a family row reached the answer`).toEqual([]);
    }
  });

  it('control: a host handler addressed under a family table is still handed the row the data door serves', async () => {
    const res = await as(adminToken, 'POST', `/actions/sys_metadata/host_object_less_reads_record/${storedRow.id}`, { params: {} });
    expect(res.status).toBe(200);
    expectServedLikeTheDoor('host handler subject record', await readJson(res));
  });

  it('control: an ordinary subject record is handed to a body as before', async () => {
    const engine: any = await kernel.getServiceAsync('objectql');
    const note: any = await engine.insert('pin_note', { title: 'subject-control' }, { context: { isSystem: true } });
    const res = await as(adminToken, 'POST', `/actions/pin_note/note_reads_record/${note.id}`, { params: {} });
    const payload = await readJson(res);
    expect(res.status, JSON.stringify(payload)).toBe(200);
    expect(payload?.data?.record?.title).toBe('subject-control');
  });

  it('control: a family-routed call that carries no record hands the body nothing, and runs', async () => {
    const res = await as(adminToken, 'POST', '/actions/sys_metadata/family_bound_reads_record', { params: {} });
    const payload = await readJson(res);
    expect(res.status, JSON.stringify(payload)).toBe(200);
    expect(familyRowsIn(payload)).toEqual([]);
  });
});

describe('[#21454] the engine action verb is unreachable from a body', () => {
  it('a sandboxed body sees no `execute` on ctx.api.object(...)', async () => {
    const res = await as(adminToken, 'POST', '/actions/pin_note/body_calls_execute', { params: {} });
    expect(res.status).toBe(200);
    const text = JSON.stringify(await readJson(res) ?? null);
    // The VM bridge installs only find/findOne/count/aggregate and the writes;
    // `execute` is not a function the body can call, so no raw scoped context
    // is ever handed to a nested action through a served body. (Read from the
    // response text, envelope-agnostic.)
    expect(text).toContain('"typeofExecute":"undefined"');
  });
});
