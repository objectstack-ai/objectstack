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
import { ApiErrorSchema, BaseResponseSchema, FieldErrorSchema, envelopeViolations } from '@objectstack/spec/api';
import { SettingsNamespacePayloadSchema } from '@objectstack/spec/system';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsService } from './settings-service.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { brandingSettingsManifest } from './manifests/branding.manifest.js';

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
      // The declared envelope in full — `safeParse` alone passes a body with no
      // `data`, or a payload duplicated into a stray top-level key (#4049).
      expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);

      expect(body.success).toBe(false);
      expect(body.error.code).toBe(c.code);
      expect(typeof body.error.message).toBe('string');
      expect(body.error.message.length).toBeGreaterThan(0);

      // `error` was already nested here before #3843 — pinned so a revert to the
      // bare-string dialect the sibling modules carried cannot land quietly.
      expect(typeof body.error).not.toBe('string');
      expect(body.code).toBeUndefined();

      // [#4224] No key inside `error` that `ApiErrorSchema` does not declare.
      //
      // This is the assertion neither gate above can make. `safeParse` STRIPS
      // unknown keys (`ApiErrorSchema` is a plain `z.object`), so it passed
      // `error.namespace` / `.key` / `.reason` / `.fields` for as long as this
      // module emitted them; `envelopeViolations` deliberately inspects only the
      // body's top level. Between them a body could carry four undeclared keys
      // and read as fully conformant — conformant *by stripping*, which is not
      // the same claim as conformant by declaration.
      //
      // Derived from `ApiErrorSchema.shape` rather than a hand-written list, so
      // a field added to the contract is allowed here the moment it is declared,
      // and one removed stops being allowed — the failure mode of a restated
      // list is that it silently keeps blessing a retired key.
      expect(
        Object.keys(body.error).filter((k) => !(k in (ApiErrorSchema as any).shape)),
        `error carries keys ApiErrorSchema does not declare: ${JSON.stringify(body.error)}`,
      ).toEqual([]);
    });
  }
});

describe('settings envelope (#4224) — the four ad-hoc keys travel in the declared slot', () => {
  /**
   * Each of these branches used to spread its context as SIBLINGS of `code` and
   * `message`. They now use `error.details`, the slot `ApiErrorSchema` declares
   * for exactly this and the one `SETTINGS_ACTION_FAILED` was already using one
   * branch over — so the module speaks one dialect rather than two.
   *
   * Both directions are asserted per case: the value is under `details`, AND the
   * old top-level spelling is gone. Asserting only the first would pass a body
   * that emitted both, which is how a "migration" quietly becomes a permanent
   * dual-write.
   */
  const CASES: Array<{
    name: string;
    status: number;
    code: string;
    details: Record<string, unknown>;
    gone: string[];
    run: () => Promise<Captured>;
  }> = [
    {
      name: 'SETTINGS_FORBIDDEN carries its namespace',
      status: 403,
      code: 'SETTINGS_FORBIDDEN',
      details: { namespace: 'branding' },
      gone: ['namespace'],
      run: async () => {
        const { http } = mount(anon);
        return drive(http, 'GET /api/settings/:namespace', { params: { namespace: 'branding' } });
      },
    },
    {
      name: 'UNKNOWN_KEY carries its namespace and key',
      status: 400,
      code: 'UNKNOWN_KEY',
      details: { namespace: 'branding', key: 'not_a_key' },
      gone: ['namespace', 'key'],
      run: async () => {
        const { http } = mount();
        return drive(http, 'PUT /api/settings/:namespace', {
          params: { namespace: 'branding' },
          body: { not_a_key: 1 },
        });
      },
    },
    {
      name: 'SETTINGS_LOCKED carries its namespace, key and reason',
      status: 409,
      code: 'SETTINGS_LOCKED',
      details: { namespace: 'branding', key: 'workspace_name', reason: 'locked-by-env' },
      gone: ['namespace', 'key', 'reason'],
      run: async () => {
        // An `OS_BRANDING_WORKSPACE_NAME` in the environment locks the key, so a
        // write to it is refused — the one branch that needs a locked namespace.
        const { http } = mount(admin, { OS_BRANDING_WORKSPACE_NAME: 'Locked Co' });
        return drive(http, 'PUT /api/settings/:namespace', {
          params: { namespace: 'branding' },
          body: { workspace_name: 'Acme' },
        });
      },
    },
  ];

  for (const c of CASES) {
    it(`${c.name} under error.details, not beside code/message`, async () => {
      const { status, body } = await c.run();
      expect(status).toBe(c.status);
      expect(body.error.code).toBe(c.code);
      expect(body.error.details).toMatchObject(c.details);
      for (const k of c.gone) {
        expect(body.error[k], `error.${k} is still a sibling of code/message`).toBeUndefined();
      }
    });
  }
});

describe('settings envelope (#4224) — SETTINGS_VALIDATION speaks the field-level vocabulary', () => {
  /**
   * The decision #4224 asked for: `fields` was a `Record<key, message>` hung
   * beside `code`, and `fields` is the name ADR-0114 (#3977) closed for
   * `FieldError[]`. Keeping the map under that name would have left one spelling
   * meaning two shapes — so it became the declared array, in the declared slot.
   */
  const lockedPattern = () => {
    const { http, service } = mount();
    service.registerManifest({
      namespace: 'validated',
      label: 'Validated',
      writePermission: 'setup.write',
      readPermission: 'setup.access',
      specifiers: [
        { key: 'model', type: 'text', label: 'Model', pattern: '^[a-z]+/[a-z]+$', description: 'Use provider/model.' },
        { key: 'token', type: 'text', label: 'API token', required: true },
      ],
    } as any);
    return http;
  };

  it('every entry parses as the declared FieldError', async () => {
    const http = lockedPattern();
    const { status, body } = await drive(http, 'PUT /api/settings/:namespace', {
      params: { namespace: 'validated' },
      body: { model: 'gpt-4o', token: '' },
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('SETTINGS_VALIDATION');

    const fields = body.error.details?.fields;
    expect(Array.isArray(fields), `details.fields is not an array: ${JSON.stringify(body.error)}`).toBe(true);
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) {
      const parsed = FieldErrorSchema.safeParse(f);
      expect(parsed.success, `not a FieldError: ${JSON.stringify(parsed.error ?? f)}`).toBe(true);
    }
    // The codes come from the closed ADR-0114 catalog, so a consumer can branch
    // on the constraint instead of substring-matching the message.
    expect(fields.map((f: any) => f.code).sort()).toEqual(['invalid_format', 'required']);
  });

  it('an out-of-table select reaches the client as a parseable invalid_option (#5131)', async () => {
    const { http, service } = mount();
    service.registerManifest({
      namespace: 'enumerated',
      label: 'Enumerated',
      writePermission: 'setup.write',
      readPermission: 'setup.access',
      specifiers: [
        { key: 'provider', type: 'select', label: 'Provider',
          options: [{ value: 'smtp', label: 'SMTP' }, { value: 'log', label: 'Log' }] },
      ],
    } as any);
    const { status, body } = await drive(http, 'PUT /api/settings/:namespace', {
      params: { namespace: 'enumerated' },
      body: { provider: 'sendgrid' },
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('SETTINGS_VALIDATION');

    const [field] = body.error.details.fields;
    expect(FieldErrorSchema.safeParse(field).success).toBe(true);
    // The constraint kind is stamped where the check failed, so the route
    // never has to infer it back out of the prose (ADR-0114).
    expect(field.code).toBe('invalid_option');
    expect(field.constraint).toEqual({ allowed: 'smtp, log' });
  });

  it('an off-grid number reaches the client as a parseable invalid_value (#6199)', async () => {
    // The grid breach's whole ADR-0112 envelope, driven through the real route:
    // the HTTP status AND the code, which is what makes this a refusal test
    // rather than a "something threw" test. The service-level suite pins the
    // `FieldError`; only here is the 400 observable, because
    // `SettingsValidationError` carries no status of its own — the route maps
    // it, and that mapping is the thing a client actually keys on.
    const { http, service } = mount();
    service.registerManifest({
      namespace: 'stepped',
      label: 'Stepped',
      writePermission: 'setup.write',
      readPermission: 'setup.access',
      specifiers: [
        { key: 'temperature', type: 'slider', label: 'Temperature', min: 0, max: 2, step: 0.1 },
      ],
    } as any);
    const { status, body } = await drive(http, 'PUT /api/settings/:namespace', {
      params: { namespace: 'stepped' },
      body: { temperature: 0.15 },
    });
    expect(status).toBe(400);
    expect(body.error.code).toBe('SETTINGS_VALIDATION');

    const [field] = body.error.details.fields;
    expect(FieldErrorSchema.safeParse(field).success).toBe(true);
    // `invalid_value` is the catalog's slot for "rejected for a reason no other
    // member names" — no `FieldErrorCode` member names a grid, and the catalog
    // is closed on purpose (ADR-0114), so a service does not get to invent one.
    expect(field.code).toBe('invalid_value');
    // The spacing and its anchor both travel, so a client can rebuild the grid.
    expect(field.constraint).toEqual({ step: 0.1, min: 0 });
  });

  it('the pre-#4224 map is gone from both of its old spellings', async () => {
    const http = lockedPattern();
    const { body } = await drive(http, 'PUT /api/settings/:namespace', {
      params: { namespace: 'validated' },
      body: { token: '' },
    });
    // Not a sibling of code/message any more …
    expect(body.error.fields).toBeUndefined();
    expect(body.error.namespace).toBeUndefined();
    // … and not the `key → message` object under its new home either.
    expect(Array.isArray(body.error.details.fields)).toBe(true);
  });
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
