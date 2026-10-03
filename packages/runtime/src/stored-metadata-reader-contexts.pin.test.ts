// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21454] The in-process reader contexts serve the stored-metadata-body family
 * (`sys_metadata` / `sys_metadata_history`: the `metadata` body column and the
 * `checksum` content-hash column) the way the generic data door serves it: the
 * body as its type's read projection, the hash in keyed form.
 *
 * Each context reads the SAME stored row the control reads through the data
 * door, and each answer is judged against that control, not against a fixed
 * shape: no stored credential and no stored hash anywhere in the answer, the
 * row's non-credential configuration present (the projection of THIS row, not
 * a withheld one), and the served hash equal to the one the door serves for the
 * same row (the door's keyed form, under the door's own key).
 *
 * Contexts, each through the door a deployment exposes:
 *   ① a sandboxed body's object API, `ctx.api.object(...)`
 *     (`sandbox/body-runner.ts`, `buildSandboxApi`):
 *       an action body, dispatched by the REST `/actions` door, read plainly
 *       and inside `ctx.api.transaction`;
 *       a hook body fired by a data-door insert, which COPIES what it read into
 *       an ordinary record (the copy exit: only projected content lands);
 *       an action body authored at runtime through the `/meta` door;
 *   ② an action handler's engine handle, `ctx.engine.find`
 *     (`buildActionEngineFacade`), host code registered with `registerAction`;
 *   ③ the same handler's `ctx.api` (`buildActionApi`), the scoped context an
 *     action body receives too.
 * The action contexts run elevated, so a member invoking one is served what an
 * administrator is: both are pinned.
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
        // [#21454] EVALUATE shapes — each body attempts to evaluate the stored
        // body or hash, and each must be refused before the query runs. The
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
        // A DEFAULT search is narrowed, not refused: a body may still search a
        // family table by its scalar columns, served like the door.
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
      ],
    },
  ],
  hooks: [
    // ① a sandboxed hook body: it COPIES what it read onto the row being inserted.
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

describe('[#21454] ① a sandboxed body\'s object API (ctx.api.object)', () => {
  for (const [role, token] of [['administrator', () => adminToken], ['member', () => memberToken]] as const) {
    it(`an action body via /actions, invoked by the ${role}: projected, keyed (both tables)`, async () => {
      for (const action of ['body_reads_family', 'body_reads_history']) {
        const res = await as(token(), 'POST', `/actions/pin_note/${action}`, { params: {} });
        expect(res.status, action).toBe(200);
        expectServedLikeTheDoor(`${action} (${role})`, await readJson(res));
      }
    });

    it(`an action body reading inside ctx.api.transaction, invoked by the ${role}: projected, keyed`, async () => {
      const res = await as(token(), 'POST', '/actions/pin_note/body_reads_family_in_transaction', { params: {} });
      expect(res.status).toBe(200);
      expectServedLikeTheDoor(`transaction read (${role})`, await readJson(res));
    });
  }

  it('a hook body fired by the administrator\'s data-door insert copies only projected content', async () => {
    const res = await as(adminToken, 'POST', '/data/pin_note', { title: 'pin-hook' });
    expect(res.status).toBeLessThan(300);
    const engine: any = await kernel.getServiceAsync('objectql');
    const rows: any[] = await engine.find('pin_note', { where: { title: 'pin-hook' }, context: { isSystem: true } });
    expect(rows).toHaveLength(1);
    // Judged on what landed in the ordinary record, read back as stored.
    expect(String(rows[0].observed)).not.toContain(SENTINEL);
    expectServedLikeTheDoor('hook copy (stored ordinary record)', JSON.parse(rows[0].observed));
  });

  it('a hook body fired by a member\'s data-door insert is refused the family read, and copies nothing', async () => {
    const res = await as(memberToken, 'POST', '/data/pin_note', { title: 'pin-hook' });
    const payload = await readJson(res);
    expect(res.status).toBe(403);
    expect(payload?.error?.code ?? payload?.code).toBe('PERMISSION_DENIED');
    const engine: any = await kernel.getServiceAsync('objectql');
    const rows: any[] = await engine.find('pin_note', { where: { title: 'pin-hook' }, context: { isSystem: true } });
    expect(rows).toHaveLength(1); // the administrator's row only
  });

  it('an action body authored at runtime through /meta: projected, keyed, for administrator and member', async () => {
    const authored = await as(adminToken, 'PUT', '/meta/action/authored_reads_family', {
      name: 'authored_reads_family',
      label: 'Authored read',
      objectName: 'pin_note',
      type: 'script',
      body: actionBody(`${readFamilySource('sys_metadata')}\nreturn { rows };`),
    });
    expect(authored.status).toBeLessThan(300);
    let res: Response | undefined;
    const bound = await waitFor(async () => {
      const attempt: Response = await as(adminToken, 'POST', '/actions/pin_note/authored_reads_family', { params: {} });
      res = attempt;
      return attempt.status < 300;
    });
    expect(bound, 'the runtime-authored action never bound').toBe(true);
    expectServedLikeTheDoor('runtime-authored body (administrator)', await readJson(res as Response));

    const member = await as(memberToken, 'POST', '/actions/pin_note/authored_reads_family', { params: {} });
    expect(member.status).toBe(200);
    expectServedLikeTheDoor('runtime-authored body (member)', await readJson(member));
  }, 30_000);
});

describe('[#21454] ② / ③ an action handler\'s engine handle and scoped API', () => {
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
  }
});

describe('[#21454] the EVALUATE shapes are refused end to end, the door\'s own refusal', () => {
  /**
   * Each shape answers the data door's refusal (`INVALID_FIELD` / 400), names
   * the offending column, and carries no family content. The envelope's precise
   * `param` / `field` are pinned directly on the door's predicate in the unit
   * test; across the sandbox boundary only `code`, `status` and the MESSAGE are
   * guaranteed (`SANDBOX_ERROR_PASSTHROUGH`), so the column is read from the
   * message, which both the sandboxed-body and the host-handler paths carry.
   */
  async function expectRefusedAction(action: string, token: string, column: string): Promise<void> {
    const res = await as(token, 'POST', `/actions/pin_note/${action}`, { params: {} });
    const payload = await readJson(res);
    const err = payload?.error ?? payload;
    const text = JSON.stringify(payload ?? null);
    expect(res.status, `${action}: refused with 400`).toBe(400);
    expect(err?.code, `${action}: the data door's INVALID_FIELD`).toBe('INVALID_FIELD');
    const named = (Array.isArray(err?.fields) && err.fields.includes(column))
      || String(err?.message ?? '').includes(`'${column}'`);
    expect(named, `${action}: the refusal names '${column}'`).toBe(true);
    expect(text.includes(SENTINEL), `${action}: the stored credential reached the answer`).toBe(false);
    for (const h of storedHashes) expect(text.includes(h), `${action}: a stored hash reached the answer`).toBe(false);
  }

  for (const [role, token] of [['administrator', () => adminToken], ['member', () => memberToken]] as const) {
    it(`a body's filter / sort / grouping on the body column, invoked by the ${role}`, async () => {
      await expectRefusedAction('body_filters_body_column', token(), 'metadata');
      await expectRefusedAction('body_sorts_body_column', token(), 'metadata');
      await expectRefusedAction('body_groups_body_column', token(), 'metadata');
    });

    it(`a body's filter on a hash column, and count as an oracle, invoked by the ${role}`, async () => {
      await expectRefusedAction('body_filters_hash_column', token(), 'checksum');
      await expectRefusedAction('body_counts_body_column', token(), 'metadata');
    });

    it(`a body's explicit search of the body column, invoked by the ${role}`, async () => {
      await expectRefusedAction('body_searches_body_column', token(), 'metadata');
    });

    it(`the engine handle's filter on the body column, invoked by the ${role}`, async () => {
      await expectRefusedAction('handler_engine_filters_body', token(), 'metadata');
    });
  }
});

describe('[#21454] a DEFAULT search is narrowed to the door\'s served set, not refused', () => {
  for (const [role, token] of [['administrator', () => adminToken], ['member', () => memberToken]] as const) {
    it(`a body's default search runs and is served like the door, invoked by the ${role}`, async () => {
      const res = await as(token(), 'POST', '/actions/pin_note/body_searches_default', { params: {} });
      expect(res.status).toBe(200);
      // It ran (not refused) and answered the family served, never the stored
      // body or hash — the body and hash columns were removed from the scan.
      expectServedLikeTheDoor(`default search (${role})`, await readJson(res));
    });
  }
});

describe('[#21454] the engine action verb is unreachable from a served body', () => {
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
