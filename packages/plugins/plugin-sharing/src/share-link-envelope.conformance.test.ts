// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Response-envelope conformance for `/api/v1/share-links/*` (#3983).
 *
 * This module was the fifth drifting one, and the only one found by
 * `scripts/check-route-envelope.mjs` rather than by #3843's hand survey — the
 * case for a repo-wide scan over a per-package one. It was also the worst of the
 * five, in a way "missing the `success` flag" undersells:
 *
 * Three of these routes are `disposition: 'sdk'` in `runtime/src/route-ledger.ts`
 * (`shareLinks.create` / `.list` / `.revoke`), and `unwrapResponse` decides a body
 * is an envelope by finding a boolean `success`. With no flag it returned the body
 * verbatim, so `shareLinks.create()` — documented "Returns the link row (incl.
 * `token`)" — handed back `{ link: … }` and `.token` was `undefined`, while
 * `shareLinks.list()`, typed `Promise<any[]>`, handed back `{ links: [] }` and any
 * `.map()` on it threw. `packages/client/src/admin-surfaces.test.ts` mocks all
 * three as `{ success: true, data: <payload> }`: the SDK was written and tested
 * against the DISPATCHER's shape, and only worked there.
 *
 * So the target shape was not a design decision. `runtime/src/domains/share-links.ts`
 * serves these same five paths (for cloud's per-environment kernels it is the
 * designed PRIMARY surface), and has always answered `data: link`, `data: links`,
 * `data: { ok: true }`, `data: { record, link, redactFields }`, `data: rows`. This
 * module converged onto that. The `sameShapeAsDispatcher` suite at the bottom is
 * what keeps the two from drifting apart again — the failure mode #3833 hit one
 * domain over, where each surface held its own copy of a mapping.
 *
 * As with the four modules in #3843, the STATIC half — proving no route can bypass
 * the `sendOk` / `sendError` pair — is not here. It is the repo-wide guard, which
 * counts response write sites per module and now pins this one at the conformant
 * `2 / 1 / 1`. What lives here is the half that has to sit next to the routes:
 * every branch driven, every body parsed against the real spec schemas.
 */

import { describe, expect, it, vi } from 'vitest';
import { BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { registerShareLinkRoutes } from './share-link-routes';
import type { ShareLinkService } from './share-link-service';
import type { SharingEngine } from './sharing-service';

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

interface Captured { status: number; body: any }

const LINK_ROW = {
  id: 'sl_1',
  token: 'tok_abcdefgh',
  object_name: 'crm_account',
  record_id: 'acc_1',
  permission: 'view',
  audience: 'anyone',
  expires_at: null,
  label: 'For the auditor',
  created_at: '2026-01-01T00:00:00.000Z',
};

/**
 * The route layer is what is under test, so the service and engine are stubs.
 * `overrides` lets one case make a single method throw or answer null without
 * restating the rest.
 */
function mount(overrides: {
  service?: Partial<Record<keyof ShareLinkService, any>>;
  engine?: Partial<SharingEngine>;
  userId?: string | undefined;
} = {}) {
  const service = {
    createLink: vi.fn(async () => ({ ...LINK_ROW })),
    listLinks: vi.fn(async () => [{ ...LINK_ROW }]),
    revokeLink: vi.fn(async () => undefined),
    resolveToken: vi.fn(async () => ({ link: { ...LINK_ROW }, redactFields: ['ssn'] })),
    ...(overrides.service ?? {}),
  } as unknown as ShareLinkService;

  const engine = {
    find: vi.fn(async () => [{ id: 'acc_1', name: 'Acme', ssn: '123-45-6789' }]),
    insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
    ...(overrides.engine ?? {}),
  } as unknown as SharingEngine;

  const http = new MockHttp();
  const userId = 'userId' in overrides ? overrides.userId : 'u_1';
  registerShareLinkRoutes(http, service, engine, {
    contextFromRequest: () => (userId ? { userId, tenantId: 't_1' } : {}),
  });
  return { http, service, engine };
}

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
    headers: opts.headers ?? {},
    method: 'GET',
    path: '/',
  };
  await handler(req, res);
  return captured;
}

const B = '/api/v1/share-links';

// ── Success bodies ────────────────────────────────────────────────────────────

describe('share-link envelope (#3983) — success bodies', () => {
  const CASES: Array<{
    name: string;
    status: number;
    /** What `data` must BE, asserted against the value rather than by key. */
    expectData: (data: any) => void;
    /** Keys the PRE-#3983 body carried at the top level, which must now be gone. */
    deadTopLevel: string[];
    run: () => Promise<Captured>;
  }> = [
    {
      name: 'POST /share-links',
      status: 201,
      // `data` IS the link row — not `{ link }`. This is the assertion that makes
      // `client.shareLinks.create().token` work through `unwrapResponse`.
      expectData: (d) => expect(d).toMatchObject({ id: 'sl_1', token: 'tok_abcdefgh' }),
      deadTopLevel: ['link'],
      run: async () => drive(mount().http, `POST ${B}`, { body: { object: 'crm_account', recordId: 'acc_1' } }),
    },
    {
      name: 'GET /share-links',
      status: 200,
      // `data` IS the array — not `{ links }`. `shareLinks.list()` is typed
      // `Promise<any[]>`, and this is what makes that type true here.
      expectData: (d) => {
        expect(Array.isArray(d)).toBe(true);
        expect(d[0]).toMatchObject({ id: 'sl_1' });
      },
      deadTopLevel: ['links'],
      run: async () => drive(mount().http, `GET ${B}`),
    },
    {
      name: 'DELETE /share-links/:idOrToken',
      status: 200,
      // `{ ok: true }` survives, but as the PAYLOAD rather than as the body. At the
      // top level it was a second word for `success` (#3689 retired that from
      // storage); under `data` it is what the dispatcher twin already returns.
      expectData: (d) => expect(d).toEqual({ ok: true }),
      deadTopLevel: ['ok'],
      run: async () => drive(mount().http, `DELETE ${B}/:idOrToken`, { params: { idOrToken: 'sl_1' } }),
    },
    {
      name: 'GET /share-links/:token/resolve',
      status: 200,
      expectData: (d) => {
        expect(d.record).toMatchObject({ id: 'acc_1', name: 'Acme' });
        expect(d.link).toMatchObject({ token: 'tok_abcdefgh' });
        expect(d.redactFields).toEqual(['ssn']);
      },
      deadTopLevel: ['record', 'link', 'redactFields'],
      run: async () => drive(mount().http, `GET ${B}/:token/resolve`, { params: { token: 'tok_abcdefgh' } }),
    },
    {
      name: 'GET /share-links/:token/messages',
      status: 200,
      // The only route that already had a `data` key — but no flag, so
      // `unwrapResponse` returned the WRAPPER `{ data: rows }` instead of `rows`.
      expectData: (d) => {
        expect(Array.isArray(d)).toBe(true);
        expect(d[0]).toMatchObject({ id: 'm_1' });
      },
      deadTopLevel: [],
      run: async () => {
        const { http } = mount({
          service: {
            resolveToken: vi.fn(async () => ({
              link: { ...LINK_ROW, object_name: 'ai_conversations' },
              redactFields: [],
            })),
          },
          engine: { find: vi.fn(async () => [{ id: 'm_1', role: 'user', content: 'hi' }]) },
        });
        return drive(http, `GET ${B}/:token/messages`, { params: { token: 'tok_abcdefgh' } });
      },
    },
  ];

  for (const c of CASES) {
    it(`${c.name} answers ${c.status} { success: true, data }`, async () => {
      const { status, body } = await c.run();
      expect(status).toBe(c.status);

      // The envelope SKELETON, imported. It is not the whole contract: it declares
      // no `data` and strips unknown keys, so on its own it passes `{ success: true }`
      // and passes a payload duplicated into a stray top-level key. What it DOES
      // catch is the missing `success` flag — the drift this line was added for.
      const parsed = BaseResponseSchema.safeParse(body);
      expect(parsed.success, `body is not a BaseResponse: ${JSON.stringify(body)}`).toBe(true);
      // The declared envelope in full — `safeParse` alone passes a body with no
      // `data`, or a payload duplicated into a stray top-level key (#4049).
      expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);
      expect(body.success).toBe(true);
      expect(body.error).toBeUndefined();
      c.expectData(body.data);
    });
  }

  it('the pre-#3983 shape is dead — flag always present, payload no longer at the top', async () => {
    for (const c of CASES) {
      const { body } = await c.run();
      expect(typeof body.success, `${c.name} answers no success flag`).toBe('boolean');
      for (const k of c.deadTopLevel) {
        expect(body[k], `${c.name} still answers a top-level ${k}`).toBeUndefined();
      }
    }
  });

  it('no success body carries `ok` beside `success` — one word for one thing (#3689)', async () => {
    for (const c of CASES) {
      const { body } = await c.run();
      expect(body.ok, `${c.name} answers a top-level ok beside success`).toBeUndefined();
    }
  });
});

// ── unwrapResponse, the reason the flag matters ───────────────────────────────

describe('share-link envelope (#3983) — what the SDK now gets', () => {
  /**
   * `ObjectStackClient.unwrapResponse` in one line: a boolean `success` means the
   * body is an envelope, so hand back `data`; otherwise hand back the body. Stated
   * here rather than imported because `@objectstack/client` is not a dependency of
   * this package — the point is the DECISION it makes on these bodies.
   */
  const unwrap = (body: any) => (typeof body?.success === 'boolean' ? body.data : body);

  it('create yields the link row itself, so `.token` is defined', async () => {
    const { body } = await drive(mount().http, `POST ${B}`, {
      body: { object: 'crm_account', recordId: 'acc_1' },
    });
    // Pre-#3983 this was `{ link: {...} }` and `.token` was undefined — the
    // documented return value of `client.shareLinks.create` did not exist.
    expect(unwrap(body).token).toBe('tok_abcdefgh');
  });

  it('list yields the array itself, so `.map` does not throw', async () => {
    const { body } = await drive(mount().http, `GET ${B}`);
    const links = unwrap(body);
    expect(Array.isArray(links)).toBe(true);
    // Pre-#3983 `unwrap` returned `{ links: [...] }` and this line threw.
    expect(links.map((l: any) => l.id)).toEqual(['sl_1']);
  });

  it('messages yields the rows, not the { data } wrapper', async () => {
    const { http } = mount({
      service: {
        resolveToken: vi.fn(async () => ({
          link: { ...LINK_ROW, object_name: 'ai_conversations' },
          redactFields: [],
        })),
      },
      engine: { find: vi.fn(async () => [{ id: 'm_1' }]) },
    });
    const { body } = await drive(http, `GET ${B}/:token/messages`, { params: { token: 'tok_abcdefgh' } });
    expect(unwrap(body)).toEqual([{ id: 'm_1' }]);
  });
});

// ── Error bodies ──────────────────────────────────────────────────────────────

describe('share-link envelope (#3983) — error bodies', () => {
  const CASES: Array<{ name: string; status: number; code: string; run: () => Promise<Captured> }> = [
    {
      name: 'anonymous create',
      status: 401,
      code: 'UNAUTHENTICATED',
      run: async () => drive(mount({ userId: undefined }).http, `POST ${B}`, { body: { object: 'a', recordId: 'b' } }),
    },
    {
      name: 'anonymous list',
      status: 401,
      code: 'UNAUTHENTICATED',
      run: async () => drive(mount({ userId: undefined }).http, `GET ${B}`),
    },
    {
      name: 'anonymous revoke',
      status: 401,
      code: 'UNAUTHENTICATED',
      run: async () => drive(mount({ userId: undefined }).http, `DELETE ${B}/:idOrToken`, {
        params: { idOrToken: 'sl_1' },
      }),
    },
    {
      name: 'create without object / recordId',
      status: 400,
      code: 'VALIDATION_FAILED',
      run: async () => drive(mount().http, `POST ${B}`, { body: {} }),
    },
    {
      name: 'create where the service throws',
      status: 500,
      code: 'INTERNAL',
      run: async () => drive(
        mount({ service: { createLink: vi.fn(async () => { throw new Error('boom'); }) } }).http,
        `POST ${B}`,
        { body: { object: 'a', recordId: 'b' } },
      ),
    },
    {
      name: 'resolve of a password-gated link with no password',
      status: 401,
      code: 'NEEDS_PASSWORD',
      run: async () => drive(
        mount({
          service: { resolveToken: vi.fn(async () => null) },
          engine: { find: vi.fn(async () => [{ token: 'tok_abcdefgh', password_hash: 'h', revoked_at: null, expires_at: null }]) },
        }).http,
        `GET ${B}/:token/resolve`,
        { params: { token: 'tok_abcdefgh' } },
      ),
    },
    {
      name: 'resolve of a password-gated link with the WRONG password',
      status: 401,
      code: 'WRONG_PASSWORD',
      run: async () => drive(
        mount({
          service: { resolveToken: vi.fn(async () => null) },
          engine: { find: vi.fn(async () => [{ token: 'tok_abcdefgh', password_hash: 'h', revoked_at: null, expires_at: null }]) },
        }).http,
        `GET ${B}/:token/resolve`,
        { params: { token: 'tok_abcdefgh' }, query: { password: 'nope' } },
      ),
    },
    {
      name: 'resolve of an audience=signed_in link while anonymous',
      status: 401,
      code: 'SIGN_IN_REQUIRED',
      run: async () => drive(
        mount({
          userId: undefined,
          service: { resolveToken: vi.fn(async () => null) },
          engine: { find: vi.fn(async () => [{ token: 'tok_abcdefgh', audience: 'signed_in', revoked_at: null, expires_at: null }]) },
        }).http,
        `GET ${B}/:token/resolve`,
        { params: { token: 'tok_abcdefgh' } },
      ),
    },
    {
      name: 'resolve of a revoked link',
      status: 410,
      code: 'EXPIRED_OR_REVOKED',
      run: async () => drive(
        mount({
          service: { resolveToken: vi.fn(async () => null) },
          engine: { find: vi.fn(async () => [{ token: 'tok_abcdefgh', revoked_at: '2026-01-02T00:00:00.000Z' }]) },
        }).http,
        `GET ${B}/:token/resolve`,
        { params: { token: 'tok_abcdefgh' } },
      ),
    },
    {
      name: 'resolve of a token that does not exist',
      status: 404,
      code: 'INVALID_OR_EXPIRED',
      run: async () => drive(
        mount({ service: { resolveToken: vi.fn(async () => null) }, engine: { find: vi.fn(async () => []) } }).http,
        `GET ${B}/:token/resolve`,
        { params: { token: 'tok_abcdefgh' } },
      ),
    },
    {
      name: 'resolve where the underlying record is gone',
      status: 410,
      code: 'RECORD_GONE',
      run: async () => drive(
        mount({ engine: { find: vi.fn(async () => []) } }).http,
        `GET ${B}/:token/resolve`,
        { params: { token: 'tok_abcdefgh' } },
      ),
    },
    {
      name: 'messages for an unresolvable token',
      status: 404,
      code: 'NOT_FOUND',
      run: async () => drive(
        mount({ service: { resolveToken: vi.fn(async () => null) } }).http,
        `GET ${B}/:token/messages`,
        { params: { token: 'tok_abcdefgh' } },
      ),
    },
    {
      // The link resolves, but it shares a `crm_account` — messages are an
      // `ai_conversations`-only affordance.
      name: 'messages for a link that is not an ai_conversations',
      status: 400,
      code: 'UNSUPPORTED',
      run: async () => drive(mount().http, `GET ${B}/:token/messages`, { params: { token: 'tok_abcdefgh' } }),
    },
  ];

  for (const c of CASES) {
    it(`${c.name} → ${c.status} ${c.code}, in the declared envelope`, async () => {
      const { status, body } = await c.run();
      expect(status).toBe(c.status);

      const parsed = BaseResponseSchema.safeParse(body);
      expect(parsed.success, `body is not a BaseResponse: ${JSON.stringify(body)}`).toBe(true);
      // The declared envelope in full — `safeParse` alone passes a body with no
      // `data`, or a payload duplicated into a stray top-level key (#4049).
      expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);

      expect(body.success).toBe(false);
      expect(body.error.code).toBe(c.code);
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);

      // `error` was already nested here before #3983 — #3675's changeset cited
      // this module as the good example of that. Pinned so a revert to the
      // bare-string dialect the sibling modules carried cannot land quietly.
      expect(typeof body.error).not.toBe('string');
      expect(body.code).toBeUndefined();
    });
  }

  it('every code is SCREAMING_SNAKE, per ADR-0112', async () => {
    for (const c of CASES) {
      const { body } = await c.run();
      expect(body.error.code, `${c.name} answers a non-conforming code`).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });
});

// ── The two surfaces must not drift apart again ───────────────────────────────

describe('share-link envelope (#3983) — same shape as the dispatcher twin', () => {
  /**
   * `runtime/src/domains/share-links.ts` serves these same five paths and is the
   * designed primary surface for cloud's per-environment kernels. Restated here as
   * the shape of `data` per route, because the runtime is not a dependency of this
   * package — importing it would invert the dependency direction for a test.
   *
   * The dispatcher additionally emits a legacy `link` / `links` key ALONGSIDE
   * `data` on create and list. That is a producer-side transition shim for readers
   * predating the envelope; it is deliberately NOT copied here, and deleting it
   * there is tracked separately (it needs a cloud-side sweep).
   */
  it('data is the payload directly on every route, matching the dispatcher', async () => {
    const create = await drive(mount().http, `POST ${B}`, { body: { object: 'a', recordId: 'b' } });
    expect(create.body.data).toMatchObject({ token: 'tok_abcdefgh' });   // dispatcher: data: link

    const list = await drive(mount().http, `GET ${B}`);
    expect(Array.isArray(list.body.data)).toBe(true);                      // dispatcher: data: links

    const revoke = await drive(mount().http, `DELETE ${B}/:idOrToken`, { params: { idOrToken: 'sl_1' } });
    expect(revoke.body.data).toEqual({ ok: true });                        // dispatcher: data: { ok: true }

    const resolve = await drive(mount().http, `GET ${B}/:token/resolve`, { params: { token: 'tok_abcdefgh' } });
    expect(Object.keys(resolve.body.data).sort())                          // dispatcher: data: { record, link, redactFields }
      .toEqual(['link', 'record', 'redactFields']);
  });

  it('redaction still happens, and `redactFields` names what was stripped', async () => {
    const { body } = await drive(mount().http, `GET ${B}/:token/resolve`, { params: { token: 'tok_abcdefgh' } });
    // The stub record carries `ssn`; the stub link redacts it.
    expect(body.data.record.ssn).toBeUndefined();
    expect(body.data.record.name).toBe('Acme');
    expect(body.data.redactFields).toEqual(['ssn']);
  });
});
