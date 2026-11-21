// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A record-less action's `params._selectedIds` is read in the CALLER's own
 * scope before anything runs, as the per-record door reads its `recordId`.
 *
 * ## The rule
 *
 * A call that names records by id names rows the caller must be able to read.
 * The per-record door has always held that for `recordId` (the subject load,
 * `404 RECORD_NOT_FOUND` on a miss). A call that carries a selection instead
 * holds it now too: every id in `_selectedIds` is read once, batched, under the
 * caller's own execution context, and one id that read does not deliver
 * refuses the WHOLE call with the same `404 RECORD_NOT_FOUND` — nothing is
 * dropped, nothing runs, nothing is written.
 *
 * ## What is pinned, on one booted kernel under the walled `isolated` posture
 *
 * Doors: REST `POST /actions/:object/:action` and the runtime's MCP bridge
 * (`runAction`, the member the MCP `run_action` tool calls).
 *
 *  1. a row the caller's sharing scope hides (same organization) → `404`, and
 *     the row is left as it was;
 *  2. a row of another organization, asked by a caller WITH an active
 *     organization → `404`, row untouched;
 *  3. a row of another organization, asked by a signed-in caller with NO
 *     active organization → `404`, row untouched;
 *  4. the readable control: the caller's own rows are written, `200`;
 *  5. the selection's shape: not a list of ids, or more than the cap → `400`;
 *  6. a near-miss spelling of a built-in on a param-less action → `400`.
 *
 * The boot follows `declarative-update-refusal-order.pin.test.ts` (it mirrors
 * `objectstack dev` / `serve`), with the posture set the way a walled
 * deployment sets it: `OS_TENANCY_POSTURE=isolated`, its platform owner, and an
 * `org-scoping` slot so the posture is enforced rather than degraded. The boot is paid in `beforeAll`, never inside a case.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/rest';
import { AuthManager, AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
// Paid at collection: the source under test loads it on first use (`check:test-source-alias`).
import '@objectstack/metadata';
import { AppPlugin } from './app-plugin.js';
import { DefaultDatasourcePlugin } from './default-datasource-plugin.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';

const BOOT_TIMEOUT = 180_000;
const ORIGIN = 'http://localhost:3000';
const API = '/api/v1';
const OBJECT = 'pin_ticket';
const ACTION = 'pin_close_selected';
const ORG_A = 'org_pin_sel_a';
const ORG_B = 'org_pin_sel_b';

type Caller = 'alice' | 'bob' | 'dave';
const CALLERS: Record<Caller, { email: string; password: string }> = {
  alice: { email: 'pin-sel-alice@example.invalid', password: 'Alice-Pass-123' },
  bob: { email: 'pin-sel-bob@example.invalid', password: 'Bobby-Pass-123' },
  dave: { email: 'pin-sel-dave@example.invalid', password: 'Davey-Pass-123' },
};

const PIN_APP: any = {
  manifest: { id: 'com.pin.actionSelectionCallerScope', name: 'Action selection caller-scope pins', version: '1.0.0' },
  objects: [
    {
      name: OBJECT,
      label: 'Pin ticket',
      // Owner-only rows: within one organization each member's scope hides the other's rows.
      sharingModel: 'private',
      fields: {
        name: { type: 'text', label: 'Name' },
        status: { type: 'text', label: 'Status' },
      },
      actions: [
        {
          name: ACTION,
          label: 'Close selected',
          type: 'script',
          target: ACTION,
          locations: ['list_toolbar'],
          execution: 'aggregate',
          ai: { exposed: true, description: 'Close every selected ticket in one call.' },
        },
      ],
    },
  ],
  permissions: [
    {
      name: 'pin_sel_member_default',
      label: 'Pin member default',
      isDefault: true,
      objects: { [OBJECT]: { allowRead: true, allowCreate: true, allowEdit: true } },
    },
  ],
};

/**
 * The multi-organization runtime's `org-scoping` slot, held so the requested
 * `isolated` posture is ENFORCED rather than degraded to `single` (plugin-auth's
 * tenancy service probes it). The wall itself is the security plugin's Layer 0;
 * rows are seeded with their organization explicitly, so no auto-stamp is needed.
 */
function orgScopingSlotPlugin(): Plugin {
  return {
    name: 'com.objectstack.test.pin-sel-org-scoping',
    version: '1.0.0',
    init: async (ctx: PluginContext) => {
      ctx.registerService('org-scoping', { supportedPostures: ['isolated'] });
    },
  };
}

/**
 * The `mcp` slot the `/mcp` route hands the runtime's bridge to. It calls the
 * bridge's `runAction` with the body's params and answers what it threw: the
 * `status` and `code` the MCP tools read.
 */
function bridgeProbeMcpPlugin(): Plugin {
  return {
    name: 'com.objectstack.test.pin-sel-bridge-probe',
    version: '1.0.0',
    init: async (ctx: PluginContext) => {
      ctx.registerService('mcp', {
        handleHttpRequest: async (_req: Request, opts: { bridge: any; parsedBody: any }) => {
          const { params } = opts.parsedBody ?? {};
          let answer: Record<string, unknown>;
          try {
            await opts.bridge.runAction(ACTION, { objectName: OBJECT, params });
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
let prevNodeEnv: string | undefined;
const tokens: Record<Caller, string> = { alice: '', bob: '', dave: '' };
const userIds: Record<Caller, string> = { alice: '', bob: '', dave: '' };
/** Every id the handler was handed, per call, in order. */
const handed: unknown[][] = [];

const row = { aliceA: 'tkt_pin_sel_alice_a', bobA: 'tkt_pin_sel_bob_a', bobA2: 'tkt_pin_sel_bob_a2', otherB: 'tkt_pin_sel_other_b' } as const;

type Door = 'REST' | 'MCP';
const DOORS: readonly Door[] = ['REST', 'MCP'];

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

const codeOf = (payload: any): unknown => payload?.error?.code ?? payload?.code;

/** Knock on `door` once as `caller` with this params bag. */
async function knock(door: Door, caller: Caller, params: Record<string, unknown>): Promise<Answer> {
  const token = tokens[caller];
  if (door === 'REST') {
    const res = await as(token, 'POST', `/actions/${OBJECT}/${ACTION}`, { params });
    const body = await readJson(res);
    return { status: res.status, ...(res.status >= 400 ? { code: codeOf(body) } : {}), body };
  }
  const res = await as(token, 'POST', '/mcp', { params });
  const body = await readJson(res);
  expect(res.status, `the /mcp route itself answered ${res.status}: ${JSON.stringify(body)}`).toBe(200);
  return { status: body.status, ...(body.status >= 400 ? { code: body.code } : {}), body };
}

const statusOf = async (id: string): Promise<unknown> =>
  (await engine.findOne(OBJECT, { where: { id }, context: { isSystem: true } }))?.status;

async function resetRows(): Promise<void> {
  for (const id of Object.values(row)) {
    await engine.update(OBJECT, { status: 'open' }, { where: { id }, context: { isSystem: true } });
  }
}

async function signUpMember(who: { email: string; password: string }, n: number): Promise<string> {
  const auth: any = await kernel.getServiceAsync('auth');
  const ticket = auth.stageOperatorProvisioning(who.email);
  let res: Response;
  try {
    res = await req('/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: who.email, password: who.password, name: `pin member ${n}`, [AuthManager.OPERATOR_PROVISIONING_TICKET_FIELD]: ticket }),
    });
  } finally {
    auth.clearOperatorProvisioning(who.email);
  }
  if (!res.ok) throw new Error(`pin signUp failed: ${res.status} ${await res.text()}`);
  return (await res.json() as any).token;
}

const sys = { context: { isSystem: true } };

beforeAll(async () => {
  prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  vi.stubEnv('OS_TENANCY_POSTURE', 'isolated');
  // A walled posture boots only with its declared platform owner (plugin-auth).
  vi.stubEnv('OS_PLATFORM_OWNER_EMAIL', 'pin-sel-owner@example.invalid');

  kernel = new ObjectKernel();
  await kernel.use(orgScopingSlotPlugin());
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
  await kernel.use(new HonoServerPlugin({ port: 0 }));
  await kernel.use(new AppPlugin(PIN_APP));
  await kernel.use(new PlatformObjectsPlugin());
  await kernel.use(new AuthPlugin({ secret: 'action-selection-caller-scope-secret', autoDefaultOrganization: false }));
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(PIN_APP)));
  await kernel.use(new SharingServicePlugin());
  await kernel.use(bridgeProbeMcpPlugin());
  await kernel.use(createRestApiPlugin({}));
  await kernel.use(createDispatcherPlugin({}));
  await kernel.bootstrap();

  httpServer = await kernel.getServiceAsync('http-server');
  app = httpServer.getRawApp();
  engine = await kernel.getServiceAsync('objectql');

  engine.registerAction(OBJECT, ACTION, async (ctx: any) => {
    const ids = Array.isArray(ctx.params?._selectedIds) ? ctx.params._selectedIds : [];
    handed.push([...ids]);
    for (const id of ids) await ctx.engine.update(OBJECT, String(id), { status: 'closed' });
    return { closed: ids.length };
  });

  for (const org of [ORG_A, ORG_B]) await engine.insert('sys_organization', { id: org, name: org, slug: org }, sys);

  let n = 0;
  for (const caller of ['alice', 'bob', 'dave'] as const) {
    tokens[caller] = await signUpMember(CALLERS[caller], ++n);
    const user = await engine.findOne('sys_user', { where: { email: CALLERS[caller].email }, ...sys });
    if (!user?.id) throw new Error(`pin precondition: ${caller} was not provisioned`);
    userIds[caller] = String(user.id);
    await engine.insert('sys_member', { organization_id: ORG_A, user_id: user.id, role: 'member' }, sys);
    // alice and bob hold ORG_A active; dave is signed in with no active organization.
    const active = caller === 'dave' ? null : ORG_A;
    const sessions = await engine.find('sys_session', { where: { user_id: user.id }, ...sys });
    for (const s of sessions ?? []) {
      await engine.update('sys_session', { active_organization_id: active }, { where: { id: s.id }, ...sys });
    }
  }

  const seed = [
    { id: row.aliceA, name: 'alice in A', owner_id: userIds.alice, organization_id: ORG_A },
    { id: row.bobA, name: 'bob in A', owner_id: userIds.bob, organization_id: ORG_A },
    { id: row.bobA2, name: 'bob in A, second', owner_id: userIds.bob, organization_id: ORG_A },
    { id: row.otherB, name: 'someone in B', owner_id: userIds.alice, organization_id: ORG_B },
  ];
  for (const r of seed) await engine.insert(OBJECT, { ...r, status: 'open' }, sys);
}, BOOT_TIMEOUT);

afterAll(async () => {
  try { await httpServer?.close?.(); } catch { /* best-effort */ }
  try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
  vi.unstubAllEnvs();
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
}, 60_000);

describe('preconditions: the read door draws the three walls this file relies on', () => {
  it('bob reads his own row, and neither alice\'s row nor the other organization\'s', async () => {
    expect((await as(tokens.bob, 'GET', `/data/${OBJECT}/${row.bobA}`)).status).toBe(200);
    for (const id of [row.aliceA, row.otherB]) {
      const res = await as(tokens.bob, 'GET', `/data/${OBJECT}/${id}`);
      expect({ status: res.status, code: codeOf(await readJson(res)) }, id).toEqual({ status: 404, code: 'RECORD_NOT_FOUND' });
    }
  });

  it('dave, signed in with no active organization, reads none of the rows', async () => {
    for (const id of Object.values(row)) {
      const res = await as(tokens.dave, 'GET', `/data/${OBJECT}/${id}`);
      expect(res.status, id).toBe(404);
    }
  });
});

const NOT_FOUND = { status: 404, code: 'RECORD_NOT_FOUND' } as const;

describe('a selection is read in the caller\'s scope before the action runs', () => {
  const refusals: ReadonlyArray<{ title: string; caller: Caller; ids: string[]; untouched: string[] }> = [
    { title: 'a row the caller\'s sharing scope hides', caller: 'bob', ids: [row.aliceA], untouched: [row.aliceA] },
    { title: 'a hidden row beside the caller\'s own: the whole call, never a partial one', caller: 'bob', ids: [row.bobA, row.aliceA], untouched: [row.bobA, row.aliceA] },
    { title: 'a row of another organization', caller: 'bob', ids: [row.otherB], untouched: [row.otherB] },
    { title: 'a row of another organization, asked with no active organization', caller: 'dave', ids: [row.otherB], untouched: [row.otherB] },
    { title: 'a row of the caller\'s organization, asked with no active organization', caller: 'dave', ids: [row.bobA], untouched: [row.bobA] },
    { title: 'an id that names nothing', caller: 'bob', ids: ['tkt_pin_sel_no_such_row'], untouched: [] },
  ];
  for (const door of DOORS) {
    for (const c of refusals) {
      it(`${door}: ${c.title} → 404 RECORD_NOT_FOUND, nothing runs`, async () => {
        await resetRows();
        const before = handed.length;
        const a = await knock(door, c.caller, { _selectedIds: c.ids });
        const after = Object.fromEntries(await Promise.all(c.untouched.map(async (id) => [id, await statusOf(id)])));
        expect({ status: a.status, code: a.code }, JSON.stringify(a.body)).toEqual(NOT_FOUND);
        expect(after).toEqual(Object.fromEntries(c.untouched.map((id) => [id, 'open'])));
        expect(handed.length, 'the handler was never entered').toBe(before);
      });
    }

    it(`${door}: the caller's own rows are written — the readable control`, async () => {
      await resetRows();
      const a = await knock(door, 'bob', { _selectedIds: [row.bobA, row.bobA2] });
      expect(a.status, JSON.stringify(a.body)).toBe(200);
      expect(await statusOf(row.bobA)).toBe('closed');
      expect(await statusOf(row.bobA2)).toBe('closed');
      expect(handed.at(-1)).toEqual([row.bobA, row.bobA2]);
    });

    it(`${door}: a repeated id is read once and handed on as sent`, async () => {
      await resetRows();
      const a = await knock(door, 'bob', { _selectedIds: [row.bobA, row.bobA] });
      expect(a.status, JSON.stringify(a.body)).toBe(200);
      expect(handed.at(-1)).toEqual([row.bobA, row.bobA]);
    });
  }
});

describe('the selection\'s shape', () => {
  const shapes: ReadonlyArray<{ title: string; value: unknown }> = [
    { title: 'one id, not a list', value: row.bobA },
    { title: 'a list carrying a non-id', value: [row.bobA, { id: row.aliceA }] },
    { title: 'more ids than the cap', value: Array.from({ length: 5001 }, (_, i) => `tkt_pin_sel_${i}`) },
  ];
  for (const door of DOORS) {
    for (const s of shapes) {
      it(`${door}: ${s.title} → 400 VALIDATION_FAILED, nothing runs`, async () => {
        await resetRows();
        const before = handed.length;
        const a = await knock(door, 'bob', { _selectedIds: s.value });
        expect({ status: a.status, code: a.code }, JSON.stringify(a.body).slice(0, 400)).toEqual({ status: 400, code: 'VALIDATION_FAILED' });
        expect(handed.length).toBe(before);
        expect(await statusOf(row.bobA)).toBe('open');
      });
    }

    it(`${door}: exactly the cap is read, not refused for its size`, async () => {
      const a = await knock(door, 'bob', { _selectedIds: [...Array.from({ length: 4999 }, (_, i) => `tkt_pin_sel_${i}`), row.bobA] });
      // Every id but one names nothing, so the call is refused for that, not for its size.
      expect({ status: a.status, code: a.code }).toEqual(NOT_FOUND);
    });
  }
});

describe('a near-miss spelling of a built-in on a param-less action', () => {
  for (const door of DOORS) {
    for (const key of ['selectedIds', '_recordId', '_objectName']) {
      it(`${door}: \`${key}\` → 400, nothing runs`, async () => {
        await resetRows();
        const before = handed.length;
        const a = await knock(door, 'bob', { [key]: [row.aliceA] });
        // The param contract's own refusal, as a declared-param action answers an unknown key.
        expect({ status: a.status, code: a.code }, JSON.stringify(a.body)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
        expect(handed.length).toBe(before);
        expect(await statusOf(row.aliceA)).toBe('open');
      });
    }

    it(`${door}: any other custom key still passes to the handler (ADR-0104 D2)`, async () => {
      const a = await knock(door, 'bob', { note: 'kept' });
      expect(a.status, JSON.stringify(a.body)).toBe(200);
    });
  }
});
