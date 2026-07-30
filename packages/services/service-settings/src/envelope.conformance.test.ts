// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Response-envelope conformance for `/api/settings/*` (#3843).
 *
 * The drift this closes: every body from this module was missing the `success`
 * flag `BaseResponseSchema` declares. The error half was otherwise correct — a
 * nested `{ code, message }`, the shape #3675 moved storage and i18n onto — so
 * this module was the *near miss* of the four in #3843: right about the hard
 * part, wrong about the one field a caller keys on.
 *
 * That mattered concretely. `ObjectStackClient.unwrapResponse` decides whether a
 * body is an envelope by looking for a boolean `success`; without it these
 * bodies were indistinguishable from already-unwrapped payloads, and
 * `BaseResponseSchema.safeParse` failed on all five of them.
 *
 * Two directions, the same pairing #3675 / #3689 established:
 *   1. every branch is DRIVEN and parsed against the real schemas imported from
 *      `packages/spec` — not restatements, so the assertions track the contract
 *      if the contract moves;
 * The STATIC half of this conformance — proving no route can bypass the
 * `sendOk` / `sendError` pair — is not here. It is
 * `scripts/check-route-envelope.mjs`, a repo-wide guard run by
 * `pnpm check:route-envelope` in CI. It sits outside any package on purpose: the
 * three predecessors of that scan were per-package, which structurally cannot
 * notice a route module nobody thought to convert, and two such modules turned up
 * the moment it went repo-wide: `share-link-routes.ts` (#3983) and the dev-only
 * `hmr-routes.ts`, neither of them in #3843's hand-written survey.
 *
 * What stays here is the half that has to live next to the routes it drives:
 * every branch driven, every body parsed against the real spec schemas.
 */

import { describe, expect, it, vi } from 'vitest';
import { BaseResponseSchema } from '@objectstack/spec/api';
import { SettingsNamespacePayloadSchema } from '@objectstack/spec/system';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsService } from './settings-service';
import { registerSettingsRoutes } from './settings-routes';
import { brandingSettingsManifest } from './manifests/branding.manifest';

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

interface Captured {
  status: number;
  body: any;
}

/** An authorized admin: verified, holding the branding manifest's capabilities. */
const admin = () => ({ enforced: true, permissions: ['setup.access', 'setup.write'] });
/** Anonymous + enforced — the module's secure default. */
const anon = () => ({ enforced: true });

function mount(contextFromRequest: any = admin, env: Record<string, string> = {}) {
  // `env: {}` so a real `OS_BRANDING_*` in the environment cannot lock a key
  // and turn a 200 case into a 409.
  const service = new SettingsService({ env });
  service.registerManifest(brandingSettingsManifest);
  // Two declared actions, one reporting each verdict — the 200/400 split this
  // module has always had, now with an envelope on both arms.
  service.registerAction('branding', 'ping', () => ({ ok: true, message: 'pong' }));
  service.registerAction('branding', 'flop', () => ({ ok: false, message: 'nope', severity: 'error' }));
  const http = new MockHttp();
  registerSettingsRoutes(http, service, { contextFromRequest });
  return { http, service };
}

async function drive(
  http: MockHttp,
  key: string,
  opts: { params?: Record<string, string>; body?: any } = {},
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
    query: {},
    body: opts.body,
    headers: {},
    method: 'GET',
    path: '/',
  };
  await handler(req, res);
  return captured;
}

describe('settings envelope (#3843) — success bodies', () => {
  const CASES: Array<{ name: string; dataKeys: string[]; run: () => Promise<Captured> }> = [
    {
      name: 'GET /api/settings',
      dataKeys: ['manifests'],
      run: async () => {
        const { http } = mount();
        return drive(http, 'GET /api/settings');
      },
    },
    {
      name: 'GET /api/settings/:namespace',
      dataKeys: ['manifest', 'values'],
      run: async () => {
        const { http } = mount();
        return drive(http, 'GET /api/settings/:namespace', { params: { namespace: 'branding' } });
      },
    },
    {
      name: 'POST /api/settings/:namespace/:actionId (action reports ok)',
      dataKeys: ['ok', 'message'],
      run: async () => {
        const { http } = mount();
        return drive(http, 'POST /api/settings/:namespace/:actionId', {
          params: { namespace: 'branding', actionId: 'ping' },
          body: null,
        });
      },
    },
    {
      name: 'PUT /api/settings/:namespace',
      dataKeys: ['values'],
      run: async () => {
        const { http } = mount();
        return drive(http, 'PUT /api/settings/:namespace', {
          params: { namespace: 'branding' },
          body: { workspace_name: 'Acme' },
        });
      },
    },
  ];

  for (const c of CASES) {
    it(`${c.name} answers { success: true, data }`, async () => {
      const { status, body } = await c.run();
      expect(status).toBe(200);

      // The contract itself, imported — not a restatement of it.
      const parsed = BaseResponseSchema.safeParse(body);
      expect(parsed.success, `body is not a BaseResponse: ${JSON.stringify(body)}`).toBe(true);
      expect(body.success).toBe(true);
      expect(body.error).toBeUndefined();

      for (const k of c.dataKeys) {
        expect(body.data?.[k], `data.${k} missing from ${c.name}`).toBeDefined();
      }
    });
  }

  it('the pre-#3843 shape is dead — no payload at the top level, flag always present', async () => {
    for (const c of CASES) {
      const { body } = await c.run();
      expect(typeof body.success, `${c.name} answers no success flag`).toBe('boolean');
      for (const k of c.dataKeys) {
        expect(body[k], `${c.name} still answers a top-level ${k}`).toBeUndefined();
      }
    }
  });

  it("GET /:namespace still satisfies the payload schema it declares — now as the envelope's `data`", async () => {
    const { http } = mount();
    const { body } = await drive(http, 'GET /api/settings/:namespace', {
      params: { namespace: 'branding' },
    });
    // `SettingsNamespacePayloadSchema` described the WHOLE body before #3843 and
    // describes `data` after it. Asserting it here is what makes the move a
    // relocation rather than a reshape.
    const declared = SettingsNamespacePayloadSchema.safeParse(body.data);
    expect(
      declared.success,
      `data does not match SettingsNamespacePayloadSchema: ${JSON.stringify(declared.error ?? body.data)}`,
    ).toBe(true);
  });
});

describe('settings envelope (#3843) — error bodies', () => {
  const CASES: Array<{ name: string; status: number; code: string; run: () => Promise<Captured> }> = [
    {
      name: 'anonymous read of a capability-gated namespace',
      status: 403,
      code: 'SETTINGS_FORBIDDEN',
      run: async () => {
        const { http } = mount(anon);
        return drive(http, 'GET /api/settings/:namespace', { params: { namespace: 'branding' } });
      },
    },
    {
      name: 'reading a namespace that was never registered',
      status: 404,
      code: 'UNKNOWN_NAMESPACE',
      run: async () => {
        const { http } = mount();
        return drive(http, 'GET /api/settings/:namespace', { params: { namespace: 'nope' } });
      },
    },
    {
      name: 'writing a key the manifest does not declare',
      status: 400,
      code: 'UNKNOWN_KEY',
      run: async () => {
        const { http } = mount();
        return drive(http, 'PUT /api/settings/:namespace', {
          params: { namespace: 'branding' },
          body: { not_a_key: 1 },
        });
      },
    },
    {
      name: 'anonymous write',
      status: 403,
      code: 'SETTINGS_FORBIDDEN',
      run: async () => {
        const { http } = mount(anon);
        return drive(http, 'PUT /api/settings/:namespace', {
          params: { namespace: 'branding' },
          body: { workspace_name: 'Acme' },
        });
      },
    },
    {
      // The action RAN and reported failure. The pre-existing 400 is preserved;
      // the whole SettingsActionResult survives under `error.details`, so a
      // renderer keeps its message / severity / details.
      name: 'an action that reports ok: false',
      status: 400,
      code: 'SETTINGS_ACTION_FAILED',
      run: async () => {
        const { http } = mount();
        return drive(http, 'POST /api/settings/:namespace/:actionId', {
          params: { namespace: 'branding', actionId: 'flop' },
          body: null,
        });
      },
    },
    {
      name: 'invoking an action on an unknown namespace',
      status: 404,
      code: 'UNKNOWN_NAMESPACE',
      run: async () => {
        const { http } = mount();
        return drive(http, 'POST /api/settings/:namespace/:actionId', {
          params: { namespace: 'nope', actionId: 'test' },
        });
      },
    },
  ];

  for (const c of CASES) {
    it(`${c.name} → ${c.status} ${c.code}, in the declared envelope`, async () => {
      const { status, body } = await c.run();
      expect(status).toBe(c.status);

      const parsed = BaseResponseSchema.safeParse(body);
      expect(parsed.success, `body is not a BaseResponse: ${JSON.stringify(body)}`).toBe(true);

      expect(body.success).toBe(false);
      expect(body.error.code).toBe(c.code);
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);

      // `error` was already nested here before #3843 — pinned so a revert to the
      // bare-string dialect the sibling modules carried cannot land quietly.
      expect(typeof body.error).not.toBe('string');
      expect(body.code).toBeUndefined();
    });
  }
});

describe('settings envelope (#3843) — a reported action failure keeps its detail', () => {
  it('carries the whole SettingsActionResult under error.details', async () => {
    const { http } = mount();
    const { status, body } = await drive(http, 'POST /api/settings/:namespace/:actionId', {
      params: { namespace: 'branding', actionId: 'flop' },
      body: null,
    });
    expect(status).toBe(400);
    expect(body.error.details).toMatchObject({ ok: false, message: 'nope', severity: 'error' });
  });
});
