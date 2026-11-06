// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30848] A declarative update action answers the write's refusal in the data
 * door's order: the object-level update refusal before the record lookup.
 *
 * ## What was wrong
 *
 * A caller who may read an object but holds no edit grant on it, writing a row
 * its scope hides or an id that names nothing, was answered
 * `404 RECORD_NOT_FOUND` by an `operation: 'update'` action (REST `/actions`,
 * MCP `run_action`) and `403 PERMISSION_DENIED` by the data door on the same
 * row (`PATCH /data`, MCP `update_record`). The action door refused on the
 * subject load's verdict before the write was asked. `http-protocol.mdx`:
 * "Refusals come before the record lookup"; `actions.mdx`: a declarative
 * update fires "exactly as for a user edit".
 *
 * ## What is pinned, on one booted kernel
 *
 * {reader (read, no edit), editor (read + edit)} × {a row the caller sees, a
 * row its private-OWD scope hides, an id that names nothing} × four doors:
 * the data door and the action door, each over REST and over the runtime's MCP
 * bridge (the `update_record` and `run_action` members the MCP tools call).
 *
 *   1. ⭐ every door answers each (caller, row) cell with the same status and
 *      code: the reader `403 PERMISSION_DENIED` on all three rows, the editor
 *      `200` on its row and `404 RECORD_NOT_FOUND` on the other two;
 *   2. ⭐ no existence oracle: within each door, for each caller, the hidden
 *      row and the missing id get the same answer, body included, once the
 *      id the caller sent is written out; and the reader's refusal on the row
 *      it can see is that same answer too;
 *   3. a refused write leaves the row untouched.
 *
 * The MCP leg drives the runtime's bridge (`buildMcpBridge`, served at `/mcp`)
 * through a stand-in `mcp` service that calls the two bridge members and
 * reports the thrown `status` and `code`, which is what the MCP tools read.
 * The tools' own envelope rendering is `@objectstack/mcp`'s and is not under
 * test here.
 *
 * Composition: the plugin set `unresolved-object-name.actions-door.pin.test.ts`
 * boots (it mirrors `objectstack dev` / `serve`); the boot is paid in
 * `beforeAll`, never inside a case.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, securityCatalogReaderOf } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
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
const ORG = 'org_pin_30848';
const READER = { email: 'pin-30848-reader@example.invalid', password: 'Reader-Pass-123' };
const EDITOR = { email: 'pin-30848-editor@example.invalid', password: 'Editor-Pass-123' };
const OBJECT = 'pin_step';
const ACTION = 'decide';
const EDITOR_SET = 'pin_30848_editor';
const MISSING = 'pin_30848_no_such_row';
const PATCH = { decision: 'approved' };

const PIN_APP: any = {
  manifest: { id: 'com.pin.declarativeUpdateOrder30848', name: 'Declarative update refusal order pins', version: '1.0.0' },
  objects: [
    {
      name: OBJECT,
      label: 'Pin step',
      // Owner-only rows: each member's scope hides the other's row.
      sharingModel: 'private',
      fields: {
        name: { type: 'text', label: 'Name' },
        decision: { type: 'text', label: 'Decision' },
      },
      actions: [
        {
          name: ACTION,
          label: 'Decide',
          operation: 'update',
          patch: PATCH,
          ai: { exposed: true, description: 'Approve this approval step on behalf of its approver.' },
        },
      ],
    },
  ],
  permissions: [
    {
      name: 'pin_30848_reader_default',
      label: 'Pin reader default',
      isDefault: true,
      objects: { [OBJECT]: { allowRead: true, allowCreate: true } },
    },
    {
      name: EDITOR_SET,
      label: 'Pin editor',
      objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true } },
    },
  ],
};

/**
 * The `mcp` slot the `/mcp` route hands the runtime's bridge to. It calls the
 * one bridge member the JSON-RPC-ish body names and answers what it threw:
 * the `status` and `code` the MCP tools read, and the message.
 */
function bridgeProbeMcpPlugin(): Plugin {
  return {
    name: 'com.objectstack.test.pin-30848-bridge-probe',
    version: '1.0.0',
    init: async (ctx: PluginContext) => {
      ctx.registerService('mcp', {
        handleHttpRequest: async (_req: Request, opts: { bridge: any; parsedBody: any }) => {
          const { member, recordId } = opts.parsedBody ?? {};
          let answer: Record<string, unknown>;
          try {
            if (member === 'update_record') await opts.bridge.update(OBJECT, recordId, PATCH);
            else await opts.bridge.runAction(ACTION, { objectName: OBJECT, recordId });
            answer = { status: 200 };
          } catch (err: any) {
            answer = { status: err?.status ?? err?.statusCode, code: err?.code, message: err?.message };
          }
          return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
        },
        renderSkill: () => '# skill',
      });
    },
  };
}

let kernel: any;
let httpServer: any;
let app: any;
let engine: any;
let adminToken: string;
let prevNodeEnv: string | undefined;
const tokens: Record<Caller, string> = { reader: '', editor: '' };
const ownRow: Record<Caller, string> = { reader: '', editor: '' };

type Caller = 'reader' | 'editor';
type Row = 'visible' | 'hidden' | 'missing';
type Door = 'data REST' | 'data MCP' | 'action REST' | 'action MCP';
const DOORS: readonly Door[] = ['data REST', 'data MCP', 'action REST', 'action MCP'];

interface Answer { status: number; code?: unknown; body: unknown }

const req = (path: string, init?: RequestInit) => app.request(`${ORIGIN}${API}${path}`, init);
const as = (token: string, method: string, path: string, payload?: unknown) =>
  req(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
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

/** The id `row` names for `caller`: its own row, the other caller's row, or no row. */
const idOf = (caller: Caller, row: Row): string =>
  row === 'visible' ? ownRow[caller] : row === 'hidden' ? ownRow[caller === 'reader' ? 'editor' : 'reader'] : MISSING;

/** Knock on `door` once as `caller` for `id`, and read the answer. */
async function knock(door: Door, caller: Caller, id: string): Promise<Answer> {
  const token = tokens[caller];
  if (door === 'data REST' || door === 'action REST') {
    const res = door === 'data REST'
      ? await as(token, 'PATCH', `/data/${OBJECT}/${id}`, PATCH)
      : await as(token, 'POST', `/actions/${OBJECT}/${ACTION}/${id}`, { params: {} });
    const body = await readJson(res);
    return { status: res.status, ...(res.status >= 400 ? { code: codeOf(body) } : {}), body };
  }
  const res = await as(token, 'POST', '/mcp', { member: door === 'data MCP' ? 'update_record' : 'run_action', recordId: id });
  const body = await readJson(res);
  expect(res.status, `the /mcp route itself answered ${res.status}: ${JSON.stringify(body)}`).toBe(200);
  return { status: body.status, ...(body.status >= 400 ? { code: body.code } : {}), body };
}

/** `a` with the id the caller sent written out, so the answers for two ids compare. */
const withoutId = (a: Answer, id: string): Answer => JSON.parse(JSON.stringify(a).split(id).join('ID')) as Answer;

const decisionOf = async (id: string): Promise<unknown> =>
  (await engine.findOne(OBJECT, { where: { id }, context: { isSystem: true } }))?.decision;

async function signIn(who: { email: string; password: string }): Promise<string> {
  const res = await req('/auth/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(who),
  });
  if (!res.ok) throw new Error(`pin signIn failed: ${res.status} ${await res.text()}`);
  return (await res.json() as any).token;
}

async function signUpMember(who: { email: string; password: string }, n: number): Promise<string> {
  // Default audience posture is invite_only: enter through a pending invitation.
  await engine.insert(
    'sys_invitation',
    {
      id: `inv_pin_30848_${n}`,
      email: who.email,
      status: 'pending',
      organization_id: ORG,
      role: 'member',
      inviter_id: 'usr_pin_30848',
      expires_at: new Date(Date.now() + 3_600_000),
    },
    { context: { isSystem: true } },
  );
  const res = await req('/auth/sign-up/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: who.email, password: who.password, name: `pin member ${n}` }),
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
  await kernel.use(new AuthPlugin({ secret: 'declarative-update-order-30848-secret', autoDefaultOrganization: false }));
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(PIN_APP)));
  await kernel.use(new SharingServicePlugin());
  await kernel.use(bridgeProbeMcpPlugin());
  await kernel.use(createRestApiPlugin({}));
  await kernel.use(createDispatcherPlugin({}));
  await kernel.bootstrap();

  httpServer = await kernel.getServiceAsync('http-server');
  app = httpServer.getRawApp();
  engine = await kernel.getServiceAsync('objectql');

  adminToken = await signIn(ADMIN);
  tokens.reader = await signUpMember(READER, 1);
  tokens.editor = await signUpMember(EDITOR, 2);

  const editorSet = await securityCatalogReaderOf(engine)?.resolve('permission', EDITOR_SET);
  if (!editorSet?.definition?.name) throw new Error(`pin precondition: the catalog serves no '${EDITOR_SET}'`);
  const editorId = (await engine.findOne('sys_user', { where: { email: EDITOR.email }, context: { isSystem: true } }))?.id;
  if (!editorId) throw new Error('pin precondition: the editor was not provisioned');
  await engine.insert(
    'sys_user_permission_set',
    { user_id: editorId, permission_set: editorSet.definition.name },
    { context: { isSystem: true } },
  );

  for (const caller of ['reader', 'editor'] as const) {
    const res = await as(tokens[caller], 'POST', `/data/${OBJECT}`, { name: `${caller} step`, decision: 'pending' });
    const body = await readJson(res);
    if (res.status >= 300) throw new Error(`pin seed refused for the ${caller}: ${res.status} ${JSON.stringify(body)}`);
    ownRow[caller] = String(body?.id ?? body?.record?.id ?? body?.data?.id ?? '');
    if (!ownRow[caller]) throw new Error(`pin seed for the ${caller} carried no id: ${JSON.stringify(body)}`);
  }
}, BOOT_TIMEOUT);

afterAll(async () => {
  try { await httpServer?.close?.(); } catch { /* best-effort */ }
  try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
}, 60_000);

describe('[#30848] preconditions', () => {
  it('each caller reads its own row and not the other one', async () => {
    for (const caller of ['reader', 'editor'] as const) {
      const own = await as(tokens[caller], 'GET', `/data/${OBJECT}/${idOf(caller, 'visible')}`);
      expect(own.status, `${caller} reads its own row`).toBe(200);
      const hidden = await as(tokens[caller], 'GET', `/data/${OBJECT}/${idOf(caller, 'hidden')}`);
      const body = await readJson(hidden);
      expect({ status: hidden.status, code: codeOf(body) }, `${caller} does not read the other row`)
        .toEqual({ status: 404, code: 'RECORD_NOT_FOUND' });
    }
  });

  it('the administrator reads both rows (the hidden row exists)', async () => {
    for (const caller of ['reader', 'editor'] as const) {
      const res = await as(adminToken, 'GET', `/data/${OBJECT}/${ownRow[caller]}`);
      expect(res.status).toBe(200);
    }
  });
});

const REFUSED_403 = { status: 403, code: 'PERMISSION_DENIED' } as const;
const NOT_FOUND = { status: 404, code: 'RECORD_NOT_FOUND' } as const;

const EXPECTED: Record<Caller, Record<Row, { status: number; code?: string }>> = {
  reader: { visible: REFUSED_403, hidden: REFUSED_403, missing: REFUSED_403 },
  editor: { visible: { status: 200 }, hidden: NOT_FOUND, missing: NOT_FOUND },
};

describe('[#30848] one answer per (caller, row), whatever the door', () => {
  for (const caller of ['reader', 'editor'] as const) {
    for (const row of ['hidden', 'missing', 'visible'] as const) {
      it(`${caller} × ${row} row: every door answers ${EXPECTED[caller][row].status}`, async () => {
        const id = idOf(caller, row);
        const before = row === 'missing' ? undefined : await decisionOf(id);
        const answers: Record<string, unknown> = {};
        for (const door of DOORS) {
          const a = await knock(door, caller, id);
          answers[door] = { status: a.status, ...(a.code !== undefined ? { code: a.code } : {}) };
        }
        expect(answers).toEqual(Object.fromEntries(DOORS.map((d) => [d, EXPECTED[caller][row]])));
        if (EXPECTED[caller][row].status >= 400 && row !== 'missing') {
          expect(await decisionOf(id), 'a refused write leaves the row untouched').toBe(before);
        }
      });
    }
  }
});

describe('[#30848] no existence oracle: a hidden row and a missing id answer alike within each door', () => {
  for (const caller of ['reader', 'editor'] as const) {
    for (const door of DOORS) {
      it(`${caller} through ${door}`, async () => {
        const hiddenId = idOf(caller, 'hidden');
        const hidden = withoutId(await knock(door, caller, hiddenId), hiddenId);
        const missing = withoutId(await knock(door, caller, MISSING), MISSING);
        expect(hidden.status).toBeGreaterThanOrEqual(400);
        expect(hidden).toEqual(missing);
      });
    }
  }

  // The reader's refusal is the write's, whatever the row: the row it can see
  // gets the same answer, sentence included, as the two it cannot.
  for (const door of DOORS) {
    it(`reader through ${door}: the visible row's refusal is the same answer`, async () => {
      const visibleId = idOf('reader', 'visible');
      const visible = withoutId(await knock(door, 'reader', visibleId), visibleId);
      const missing = withoutId(await knock(door, 'reader', MISSING), MISSING);
      expect(visible).toEqual(missing);
    });
  }
});
