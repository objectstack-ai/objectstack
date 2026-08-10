// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6206 / #6430 ruling A] What the share-link routes hand to ENFORCEMENT.
 *
 * ## The defect
 *
 * `SharingServicePlugin` resolved the caller through `resolveAuthzContext` —
 * the one shared authorization resolver — and then rebuilt a FOUR-FIELD object
 * out of the result (`userId` / `tenantId` / `positions` / `permissions`).
 * That object was not a route-local identity: it went straight into
 * `ShareLinkService.createLink`, which reads the target record under it
 * ([Finding-2] "you may only link-share a record you can see"). So
 * `accessible_org_ids`, `org_user_ids`, `systemPermissions`, `posture` and
 * `tabPermissions` were dropped ON THE WAY INTO the data engine. Under the
 * `group` tenancy posture `accessible_org_ids` IS the Layer 0 wall (ADR-0105
 * D2) and an absent set denies, so the visibility read found nothing and link
 * creation answered 403 for records the caller reads fine elsewhere. The
 * behavioural half of that proof — the wall itself, before and after — lives in
 * `plugin-security`'s `share-link-tenant-wall.test.ts`, which is the package
 * that owns `computeTenantLayer0Filter`; this file pins the seam that feeds it.
 *
 * ## Why the pin is written against the SEAM rather than a key list
 *
 * A hand-written list of "the fields enforcement needs" is the same artefact
 * that broke here: it was correct when written and silently wrong the moment
 * the envelope grew a dimension. So the assertion compares the enforcement
 * context against a context the REAL resolver produced for the same principal
 * (`bootRequestContext`, the #5859 seam kit) — every key the resolver emits
 * must be present. A new authorization dimension is then covered on the day it
 * is added, by both sides at once, and re-trimming this seam fails by NAMING
 * the keys it dropped.
 *
 * The five keys the card names are additionally asserted by name, because a
 * reader of this file should be able to see the issue's own vocabulary in it.
 */

import { describe, it, expect, vi } from 'vitest';
// The producers' OWN dispatch predicates: a double that opens its write verbs
// with these cannot accept a call the real engine refuses
// (`check:engine-double-contract`).
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/objectql';
import type {
  IHttpServer,
  IHttpRequest,
  IHttpResponse,
  RouteHandler,
} from '@objectstack/spec/contracts';
import { SharingServicePlugin } from './sharing-plugin.js';
import { bootRequestContext } from './exec-context-seam.testkit.js';

const BASE = '/api/v1/share-links';
const USER = 'u_sharer';
const EMAIL = 'sharer@example.com';
const ORG = 'org_plant_a';
const OBJECT = 'crm_account';
const RECORD = 'acc_1';

// ── Test doubles ─────────────────────────────────────────────────────────────

class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) {
    this.routes.set(`${method} ${path}`, handler);
  }
  get(path: string, h: RouteHandler) { this.add('GET', path, h); return this as any; }
  post(path: string, h: RouteHandler) { this.add('POST', path, h); return this as any; }
  put(path: string, h: RouteHandler) { this.add('PUT', path, h); return this as any; }
  delete(path: string, h: RouteHandler) { this.add('DELETE', path, h); return this as any; }
  patch(path: string, h: RouteHandler) { this.add('PATCH', path, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

/** `where` matching good enough for both the identity reads and the record read. */
function matches(row: any, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in v) return (v as any).$in.includes(row[k]);
    return row[k] === v;
  });
}

interface FindCall { object: string; context: any }

/**
 * An engine that answers the identity tables `resolveAuthzContext` reads AND
 * the business object under test, recording the context of every read so the
 * assertions can look at what enforcement was actually handed.
 */
function makeEngine(tables: Record<string, any[]>) {
  const finds: FindCall[] = [];
  return {
    finds,
    async find(object: string, opts: any) {
      finds.push({ object, context: opts?.context });
      return (tables[object] ?? []).filter((r) => matches(r, opts?.where ?? {}));
    },
    async insert(object: string, row: any) {
      (tables[object] ??= []).push(row);
      return row;
    },
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const rows = tables[object] ?? [];
      if (dispatch.kind === 'by-id') {
        const i = rows.findIndex((r) => r.id === dispatch.id);
        if (i >= 0) rows[i] = { ...rows[i], ...data };
        return data;
      }
      const matched = rows.filter((r) => matches(r, options?.where ?? {}));
      for (const r of matched) Object.assign(r, data);
      return matched.length;
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const rows = tables[object] ?? [];
      if (dispatch.kind === 'by-id') {
        const before = rows.length;
        tables[object] = rows.filter((r) => r.id !== dispatch.id);
        return tables[object].length < before;
      }
      const matched = rows.filter((r) => matches(r, options?.where ?? {}));
      tables[object] = rows.filter((r) => !matched.includes(r));
      return matched.length;
    },
    getSchema(object: string) {
      return object === OBJECT
        ? {
            name: OBJECT,
            publicSharing: {
              enabled: true,
              allowedAudiences: ['link_only'],
              allowedPermissions: ['view'],
            },
          }
        : { name: object };
    },
  };
}

/**
 * Boot the REAL plugin: the assembly under test is a closure inside its
 * `kernel:ready` handler, so nothing short of starting the plugin exercises the
 * production wiring. `enforce: false` keeps this to the share-link surface —
 * the sharing middleware and the rule subsystem are a different card's code and
 * would only add noise here (the share-link service is registered in that
 * posture too, by design).
 */
async function bootPlugin(opts: { session: () => any; tables: Record<string, any[]> }) {
  const engine = makeEngine(opts.tables);
  const http = new MockHttp();
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const ctx: any = {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    hook: (event: string, handler: () => Promise<void> | void) => {
      (hooks[event] ??= []).push(handler);
    },
    getService: (name: string) => {
      if (name === 'objectql') return engine;
      if (name === 'http-server') return http;
      if (name === 'auth') return { api: { getSession: async () => opts.session() } };
      throw new Error(`service not registered: ${name}`);
    },
    registerService: vi.fn(),
  };

  const plugin = new SharingServicePlugin({ enforce: false });
  await plugin.start(ctx);
  for (const handler of hooks['kernel:ready'] ?? []) await handler();

  return { engine, http };
}

interface Captured { status: number; body: any }

async function drive(
  http: MockHttp,
  key: string,
  opts: { params?: Record<string, string>; body?: any; query?: any; headers?: any } = {},
): Promise<Captured> {
  const handler = http.routes.get(key);
  if (!handler) throw new Error(`no handler for ${key}`);
  const captured: Captured = { status: 200, body: undefined };
  const res: IHttpResponse = {
    json: vi.fn((data: any) => { captured.body = data; }) as any,
    send: vi.fn() as any,
    status: vi.fn((code: number) => { captured.status = code; return res; }) as any,
    header: vi.fn(() => res) as any,
  };
  const req: IHttpRequest = {
    params: opts.params ?? {},
    query: opts.query ?? {},
    body: opts.body,
    headers: opts.headers ?? { cookie: 'better-auth.session_token=t' },
    method: 'POST',
    path: BASE,
  };
  await handler(req, res);
  return captured;
}

/** The identity + business rows a real deployment holds for this principal. */
function fixtureTables(): Record<string, any[]> {
  return {
    sys_user: [{ id: USER, email: EMAIL }],
    sys_member: [{ id: 'mem_1', user_id: USER, organization_id: ORG, role: 'member' }],
    sys_user_position: [],
    sys_user_permission_set: [],
    sys_permission_set: [],
    [OBJECT]: [{ id: RECORD, name: 'Acme', organization_id: ORG }],
    sys_share_link: [],
  };
}

/** A better-auth session exactly as `AuthManager` hands it to the resolver. */
const signedIn = () => ({
  user: { id: USER, email: EMAIL },
  session: { userId: USER, activeOrganizationId: ORG },
});

// ── The pin ──────────────────────────────────────────────────────────────────

describe('[#6206] share-link routes hand ENFORCEMENT the whole authz envelope', () => {
  it('the visibility read of createLink runs on every key the resolver produced', async () => {
    const tables = fixtureTables();
    const { engine, http } = await bootPlugin({ session: signedIn, tables });

    const res = await drive(http, `POST ${BASE}`, { body: { object: OBJECT, recordId: RECORD } });
    expect(res.status).toBe(201);

    // The [Finding-2] visibility read — the call this card is about.
    const probe = engine.finds.find((f) => f.object === OBJECT);
    expect(probe, 'createLink must re-read the record under the caller context').toBeDefined();
    const enforcementCtx: any = probe!.context;

    // The reference envelope: the SAME resolver, the same principal, produced
    // through the #5859 seam kit rather than hand-written here.
    const seam: any = await bootRequestContext({
      userId: USER,
      email: EMAIL,
      activeOrganizationId: ORG,
    });
    const dropped = Object.keys(seam).filter((k) => !(k in enforcementCtx));
    expect(dropped, 'keys the route dropped on the way into enforcement').toEqual([]);

    // The four wall/authorization inputs the card names by hand, with the
    // values a `group`-posture deployment depends on. (`tabPermissions` is the
    // fifth; it is emitted only when the principal holds tab overrides, so it
    // is covered by the seam comparison above rather than by a value here.)
    expect(enforcementCtx.accessible_org_ids).toEqual([ORG]);
    expect(enforcementCtx.org_user_ids).toContain(USER);
    expect(Array.isArray(enforcementCtx.systemPermissions)).toBe(true);
    // [ADR-0095 D2] Resolved ONCE, upstream, and carried — this assertion is
    // that it arrives, not that anything here re-derives it.
    expect(enforcementCtx.posture).toBe('MEMBER');

    // The four fields the old assembly did carry are unchanged.
    expect(enforcementCtx.userId).toBe(USER);
    expect(enforcementCtx.tenantId).toBe(ORG);
    expect(enforcementCtx.positions).toEqual(seam.positions);
    expect(enforcementCtx.permissions).toEqual(seam.permissions);

    // [ADR-0118 D2] Absence is never system — the route says so explicitly, and
    // must never say the opposite (that would bypass the read entirely).
    expect(enforcementCtx.isSystem).toBe(false);
  });

  it('listLinks reads under the same whole envelope', async () => {
    const tables = fixtureTables();
    const { engine, http } = await bootPlugin({ session: signedIn, tables });

    const res = await drive(http, `GET ${BASE}`, { query: {} });
    expect(res.status).toBe(200);

    const listRead = engine.finds.filter((f) => f.object === 'sys_share_link').pop();
    expect(listRead).toBeDefined();
    expect(listRead!.context.accessible_org_ids).toEqual([ORG]);
    expect(listRead!.context.posture).toBe('MEMBER');
  });

  it('an unresolvable request is still anonymous → 401, and nothing is enforced', async () => {
    const tables = fixtureTables();
    const { engine, http } = await bootPlugin({ session: () => undefined, tables });

    const res = await drive(http, `POST ${BASE}`, { body: { object: OBJECT, recordId: RECORD } });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: { code: 'UNAUTHENTICATED' } });
    // The 401 is decided before any enforcement runs: no read of the record.
    expect(engine.finds.some((f) => f.object === OBJECT)).toBe(false);
  });

  it('a record the caller cannot see is still refused (the [Finding-2] guarantee)', async () => {
    // Widening the envelope must not widen WHO may mint a link: an engine that
    // reports the row as invisible still yields 403.
    const tables = fixtureTables();
    tables[OBJECT] = [];
    const { http } = await bootPlugin({ session: signedIn, tables });

    const res = await drive(http, `POST ${BASE}`, { body: { object: OBJECT, recordId: RECORD } });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
  });
});
