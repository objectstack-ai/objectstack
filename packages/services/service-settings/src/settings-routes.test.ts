// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsService } from './settings-service.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { brandingSettingsManifest } from './manifests/branding.manifest.js';
import { localizationSettingsManifest } from './manifests/localization.manifest.js';
import { SETTINGS_SECRET_MASK } from './settings-secret-redaction.js';
// `InMemoryCryptoProvider` is a value-only alias (`export const … = LocalCryptoProvider`),
// so the class itself is the one that can also be spelled as a type.
import { LocalCryptoProvider } from './local-crypto-provider.js';
import type { SettingsManifest } from '@objectstack/spec/system';

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

function makeReqRes(opts: { params?: Record<string, string>; body?: any; headers?: Record<string, string> } = {}) {
  const req: IHttpRequest = {
    params: opts.params ?? {},
    query: {},
    body: opts.body,
    headers: opts.headers ?? {},
    method: 'GET',
    path: '/',
  };
  const state: { status: number; body?: any } = { status: 200 };
  const res: IHttpResponse = {
    json: vi.fn((data) => { state.body = data; }) as any,
    send: vi.fn() as any,
    status: vi.fn((code: number) => { state.status = code; return res; }) as any,
    header: vi.fn(() => res) as any,
  };
  return { req, res, state };
}

// [Finding-1] An authorized admin context (verified, holds the branding
// manifest's setup.access/setup.write capabilities). The production plugin
// derives this from the verified session/API-key; here we inject it directly.
const adminProvider = () => ({ enforced: true, permissions: ['setup.access', 'setup.write'] });

describe('settings-routes', () => {
  it('GET /api/settings → manifests', async () => {
    const http = new MockHttp();
    const svc = new SettingsService();
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('GET /api/settings')!;
    const { req, res, state } = makeReqRes();
    await h(req, res);
    expect(state.body.data.manifests.length).toBe(1);
  });

  it('GET /api/settings/:ns → payload', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('GET /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'branding' } });
    await h(req, res);
    expect(state.body.data.manifest.namespace).toBe('branding');
    expect(state.body.data.values.workspace_name.source).toBe('default');
  });

  it('PUT returns 409 for env-locked', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: { OS_BRANDING_WORKSPACE_NAME: 'X' } });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'branding' }, body: { workspace_name: 'Y' } });
    await h(req, res);
    expect(state.status).toBe(409);
    expect(state.body.error.code).toBe('SETTINGS_LOCKED');
  });

  it('PUT 404 for unknown namespace', async () => {
    const http = new MockHttp();
    const svc = new SettingsService();
    registerSettingsRoutes(http, svc);
    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'nope' }, body: { a: 1 } });
    await h(req, res);
    expect(state.status).toBe(404);
  });

  it('PUT accepts the {values:{...}} envelope (flat inner) symmetrically with GET', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'branding' }, body: { values: { workspace_name: 'My Co' } } });
    await h(req, res);
    expect(state.body.error).toBeUndefined();
    expect(state.body.data.values.workspace_name.value).toBe('My Co');
    expect(state.body.data.values.workspace_name.source).toBe('tenant');
  });

  it('PUT accepts the read-shape envelope echoed back from GET', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    // Exactly what GET returns: { values: { key: { value, source, ... } } }
    const { req, res, state } = makeReqRes({
      params: { namespace: 'branding' },
      body: { values: { workspace_name: { value: 'Echoed', source: 'tenant', locked: false } } },
    });
    await h(req, res);
    expect(state.body.error).toBeUndefined();
    expect(state.body.data.values.workspace_name.value).toBe('Echoed');
  });

  it('POST action invokes service.runAction', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    svc.registerAction('branding', 'ping', () => ({ ok: true, message: 'pong' }));
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('POST /api/settings/:namespace/:actionId')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'branding', actionId: 'ping' }, body: null });
    await h(req, res);
    expect(state.status).toBe(200);
    expect(state.body.data.ok).toBe(true);
  });

  // ── [Finding-1] the DEFAULT (no verified provider) is SECURE ──────────────
  // Header-trusted identity is gone; an unauthenticated request can neither
  // enumerate protected namespaces nor write them.
  it('anonymous GET /api/settings hides manifests that require a read capability', async () => {
    const http = new MockHttp();
    const svc = new SettingsService();
    svc.registerManifest(brandingSettingsManifest); // requires setup.access
    registerSettingsRoutes(http, svc); // secure default → anonymous + enforced

    const h = http.routes.get('GET /api/settings')!;
    const { req, res, state } = makeReqRes();
    await h(req, res);
    expect(state.body.data.manifests.length).toBe(0);
  });

  it('anonymous GET /api/settings/:ns is DENIED (403), not served', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc);

    const h = http.routes.get('GET /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'branding' } });
    await h(req, res);
    expect(state.status).toBe(403);
    expect(state.body.error.code).toBe('SETTINGS_FORBIDDEN');
  });

  it('anonymous PUT /api/settings/:ns is DENIED (403) — the unauthenticated write hole is closed', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc);

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'branding' }, body: { workspace_name: 'pwn' } });
    await h(req, res);
    expect(state.status).toBe(403);
    expect(state.body.error.code).toBe('SETTINGS_FORBIDDEN');
  });

  it('a spoofed x-user-id / x-permissions header grants NOTHING (default ignores identity headers)', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc);

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({
      params: { namespace: 'branding' },
      body: { workspace_name: 'pwn' },
      headers: { 'x-user-id': 'attacker', 'x-permissions': 'setup.write,setup.access' },
    });
    await h(req, res);
    expect(state.status).toBe(403);
  });

  it('a caller holding only read (setup.access) may read but NOT write', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(brandingSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: () => ({ enforced: true, permissions: ['setup.access'] }) });

    const read = http.routes.get('GET /api/settings/:namespace')!;
    const r1 = makeReqRes({ params: { namespace: 'branding' } });
    await read(r1.req, r1.res);
    expect(r1.state.body.data.manifest.namespace).toBe('branding');

    const write = http.routes.get('PUT /api/settings/:namespace')!;
    const r2 = makeReqRes({ params: { namespace: 'branding' }, body: { workspace_name: 'X' } });
    await write(r2.req, r2.res);
    expect(r2.state.status).toBe(403); // has setup.access, lacks setup.write
  });

  // ── #5712 — the declared valueDomain, as it lands on the HTTP surface ─────
  // The card's repros, asserted with the full envelope: status AND code, per
  // the rejection-test contract — a bare "it threw" carries one bit where the
  // defect has two.

  it('PUT /api/settings/localization accepts Europe/Zurich + CHF (the #5712 repro)', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(localizationSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({
      params: { namespace: 'localization' },
      body: { timezone: 'Europe/Zurich', currency: 'CHF' },
    });
    await h(req, res);
    expect(state.status).toBe(200);
    expect(state.body.error).toBeUndefined();
    expect(state.body.data.values.timezone.value).toBe('Europe/Zurich');
    expect(state.body.data.values.currency.value).toBe('CHF');
  });

  it('PUT /api/settings/localization rejects garbage with 400 + SETTINGS_VALIDATION + invalid_value', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest(localizationSettingsManifest);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({
      params: { namespace: 'localization' },
      body: { timezone: 'Mars/Olympus' },
    });
    await h(req, res);
    expect(state.status).toBe(400);
    expect(state.body.error.code).toBe('SETTINGS_VALIDATION');
    expect(state.body.error.details.fields).toEqual([
      expect.objectContaining({
        field: 'timezone',
        code: 'invalid_value',
        constraint: { valueDomain: 'iana_time_zone' },
        value: 'Mars/Olympus',
      }),
    ]);
  });

  /**
   * #7169 — the STATUS half of the fail-closed refusal.
   *
   * `SettingsValidationError` carries `code` and the service suite pins that; a
   * rejection case's other required assertion is the HTTP `status`, and this
   * surface mints it here rather than on the error (ADR-0112 envelope, same
   * 400 + `SETTINGS_VALIDATION` mapping every other save-time refusal takes).
   * Restore `catch { continue }` in `validatePatch` and this case answers 200.
   */
  it('PUT rejects an unparseable `visible` predicate with 400 + SETTINGS_VALIDATION + invalid_value', async () => {
    const http = new MockHttp();
    const svc = new SettingsService({ env: {} });
    svc.registerManifest({
      namespace: 'celns',
      label: 'CEL namespace',
      specifiers: [
        { type: 'text', key: 'note', label: 'Note' },
        // CEL the spec's `ExpressionInputSchema` declares legal and this
        // service's evaluator cannot parse.
        { type: 'text', key: 'api_key', label: 'API key', required: true,
          visible: "${data.note in ['x']}" },
      ],
    } as any);
    registerSettingsRoutes(http, svc, { contextFromRequest: adminProvider });

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({
      params: { namespace: 'celns' },
      body: { note: 'anything' },
    });
    await h(req, res);
    expect(state.status).toBe(400);
    expect(state.body.error.code).toBe('SETTINGS_VALIDATION');
    expect(state.body.error.details.fields).toEqual([
      expect.objectContaining({
        field: 'api_key',
        code: 'invalid_value',
        constraint: { visible: "data.note in ['x']" },
      }),
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #7522 — encrypted settings are REDACTED at the REST read boundary.
//
// The service decrypts on purpose and keeps doing so; these cases pin the
// boundary in both directions: nothing ciphertext-backed leaves over HTTP, and
// an in-process consumer still receives the real plaintext. Both specifier
// flavours are covered — `type: 'password'` (implicitly encrypted) and an
// explicit `encrypted: true` on a non-password type — because `registerManifest`
// folds them into one set and a fix that only saw one of them would still leak.
// ─────────────────────────────────────────────────────────────────────────────

const SMTP_PLAINTEXT = 'smtp-pa55word-plaintext';
const TOKEN_PLAINTEXT = 'webhook-token-plaintext';
const GLOBAL_PLAINTEXT = 'global-scope-plaintext';

/** Two secret flavours + one plain control key, resolved down the full cascade. */
const secretsManifest: SettingsManifest = {
  namespace: 'secretsns',
  version: 1,
  label: 'Secrets',
  // `user` so the cascade walks global → tenant → user and `cascadeChain`
  // carries more than one entry to leak through.
  scope: 'user',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [
    // Flavour A — implicitly encrypted because the TYPE is `password`.
    { type: 'password', key: 'smtp_password', label: 'SMTP password', required: false },
    // Flavour B — an ordinary type carrying an explicit `encrypted: true`.
    { type: 'text', key: 'webhook_token', label: 'Webhook token', required: false, encrypted: true },
    // Control — never encrypted, must survive the redaction untouched.
    { type: 'text', key: 'smtp_host', label: 'Host', required: false, default: 'smtp.example.com' },
  ],
};

const secretAdmin = () => ({
  enforced: true,
  permissions: ['setup.access', 'setup.write'],
  userId: 'usr_1',
});

function makeSecretStack() {
  const secretRows = new Map<string, any>();
  const cryptoProvider = new LocalCryptoProvider();
  const svc = new SettingsService({
    env: {},
    cryptoProvider,
    secretStore: {
      async insert(row) { secretRows.set(row.id, row); return { id: row.id }; },
      async get(id) { return secretRows.get(id) ?? null; },
      async update(id, patch) { secretRows.set(id, { ...secretRows.get(id), ...patch }); },
    },
  });
  svc.registerManifest(secretsManifest);
  const http = new MockHttp();
  registerSettingsRoutes(http, svc, { contextFromRequest: secretAdmin });
  return { svc, http, secretRows, cryptoProvider };
}

/**
 * Seed an upper-scope (`global`) encrypted row directly, exactly as `setMany`
 * would write it — ciphertext in the secret store, only the `sec_` handle on the
 * setting row. The public write path resolves one scope per key, so this is the
 * only way to give `cascadeChain` a second ciphertext-backed entry.
 */
async function seedGlobalSecret(
  svc: SettingsService,
  secretRows: Map<string, any>,
  cryptoProvider: LocalCryptoProvider,
  key: string,
  plaintext: string,
) {
  const handle = await cryptoProvider.encrypt(plaintext, { namespace: 'secretsns', key });
  secretRows.set(handle.id, {
    id: handle.id,
    namespace: 'secretsns',
    key,
    kms_key_id: handle.kmsKeyId,
    alg: handle.alg,
    version: handle.version,
    ciphertext: handle.ciphertext,
  });
  await (svc as any).upsertRow({
    namespace: 'secretsns',
    key,
    scope: 'global',
    user_id: null,
    value: null,
    value_enc: handle.id,
    encrypted: true,
  });
  return handle.id;
}

describe('settings-routes — #7522 encrypted values are redacted at the REST boundary', () => {
  it('GET /:ns leaks no ciphertext-backed cleartext — both flavours, value AND cascadeChain', async () => {
    const { svc, http, secretRows, cryptoProvider } = makeSecretStack();

    // Written through the trusted in-process path, the way a seed/bootstrap or
    // a plugin would.
    await svc.set('secretsns', 'smtp_password', SMTP_PLAINTEXT, { userId: 'usr_1' });
    await svc.set('secretsns', 'webhook_token', TOKEN_PLAINTEXT, { userId: 'usr_1' });
    await seedGlobalSecret(svc, secretRows, cryptoProvider, 'smtp_password', GLOBAL_PLAINTEXT);

    const h = http.routes.get('GET /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'secretsns' } });
    await h(req, res);

    expect(state.status).toBe(200);

    // The whole-body assertion is the one that cannot be satisfied by masking
    // only the places we happened to think of.
    const wire = JSON.stringify(state.body);
    expect(wire).not.toContain(SMTP_PLAINTEXT);
    expect(wire).not.toContain(TOKEN_PLAINTEXT);
    expect(wire).not.toContain(GLOBAL_PLAINTEXT);

    // …and the specific places the issue names, so a future regression says
    // WHICH surface broke rather than just "a string appeared".
    const values = state.body.data.values;
    expect(values.smtp_password.value).toBe(SETTINGS_SECRET_MASK);
    expect(values.webhook_token.value).toBe(SETTINGS_SECRET_MASK);
    for (const key of ['smtp_password', 'webhook_token']) {
      const chain = values[key].cascadeChain as Array<{ scope: string; value: unknown }>;
      expect(chain.length).toBeGreaterThan(0);
      for (const entry of chain) {
        expect([SETTINGS_SECRET_MASK, null]).toContain(entry.value);
      }
    }
    // The global entry is present and masked — a second ciphertext-backed
    // scope, not an artefact of the user row being the only one.
    expect(values.smtp_password.cascadeChain).toEqual(
      expect.arrayContaining([expect.objectContaining({ scope: 'global', value: SETTINGS_SECRET_MASK })]),
    );

    // The non-encrypted control key is untouched.
    expect(values.smtp_host.value).toBe('smtp.example.com');
  });

  it('redaction is presence-preserving: an UNSET secret stays null, not a mask', async () => {
    const { svc, http } = makeSecretStack();
    await svc.set('secretsns', 'smtp_password', SMTP_PLAINTEXT, { userId: 'usr_1' });

    const h = http.routes.get('GET /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'secretsns' } });
    await h(req, res);

    // Set vs unset stays observable — the console renders "configured" from it.
    expect(state.body.data.values.smtp_password.value).toBe(SETTINGS_SECRET_MASK);
    expect(state.body.data.values.webhook_token.value).toBeNull();
  });

  it('`source` and `locked` survive the redaction unchanged', async () => {
    const { svc, http } = makeSecretStack();
    await svc.set('secretsns', 'webhook_token', TOKEN_PLAINTEXT, { userId: 'usr_1' });

    const h = http.routes.get('GET /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({ params: { namespace: 'secretsns' } });
    await h(req, res);

    expect(state.body.data.values.webhook_token.source).toBe('user');
    expect(state.body.data.values.webhook_token.locked).toBe(false);
    expect(state.body.data.values.smtp_host.source).toBe('default');
  });

  it('an env-locked secret is masked while `source: env` / `locked` / 409 SETTINGS_LOCKED are unchanged', async () => {
    // The env override is itself a secret value; it must not ride out on the
    // read path either, and the lock affordances must keep working.
    const svc = new SettingsService({ env: { OS_SECRETSNS_SMTP_PASSWORD: 'env-supplied-secret' } });
    svc.registerManifest(secretsManifest);
    const http = new MockHttp();
    registerSettingsRoutes(http, svc, { contextFromRequest: secretAdmin });

    const read = http.routes.get('GET /api/settings/:namespace')!;
    const r1 = makeReqRes({ params: { namespace: 'secretsns' } });
    await read(r1.req, r1.res);
    expect(JSON.stringify(r1.state.body)).not.toContain('env-supplied-secret');
    expect(r1.state.body.data.values.smtp_password.value).toBe(SETTINGS_SECRET_MASK);
    expect(r1.state.body.data.values.smtp_password.source).toBe('env');
    expect(r1.state.body.data.values.smtp_password.locked).toBe(true);
    expect(r1.state.body.data.values.smtp_password.lockedReason).toContain('OS_SECRETSNS_SMTP_PASSWORD');
    expect(r1.state.body.data.values.smtp_password.cascadeChain).toEqual([
      expect.objectContaining({ scope: 'env', value: SETTINGS_SECRET_MASK, locked: true }),
    ]);

    const write = http.routes.get('PUT /api/settings/:namespace')!;
    const r2 = makeReqRes({ params: { namespace: 'secretsns' }, body: { smtp_password: 'new' } });
    await write(r2.req, r2.res);
    expect(r2.state.status).toBe(409);
    expect(r2.state.body.error.code).toBe('SETTINGS_LOCKED');
  });

  // ── the echoed-mask write, i.e. the second bug a redaction fix introduces ──

  it('PUTting the echoed mask back is a NO-OP — the stored secret is not overwritten', async () => {
    const { svc, http, secretRows } = makeSecretStack();
    await svc.set('secretsns', 'smtp_password', SMTP_PLAINTEXT, { userId: 'usr_1' });
    const handlesBefore = [...secretRows.keys()];

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({
      params: { namespace: 'secretsns' },
      body: { smtp_password: SETTINGS_SECRET_MASK },
    });
    await h(req, res);

    expect(state.status).toBe(200);
    expect(state.body.error).toBeUndefined();
    // No new ciphertext row: the mask was never encrypted and stored.
    expect([...secretRows.keys()]).toEqual(handlesBefore);
    // And the in-process read still yields the ORIGINAL plaintext — not the
    // mask's literal text, which is what an unguarded write would have stored
    // (and which would decrypt back to itself, so nothing would look wrong
    // until the SMTP login failed).
    const resolved = await svc.get<string>('secretsns', 'smtp_password', { userId: 'usr_1' });
    expect(resolved.value).toBe(SMTP_PLAINTEXT);
    expect(resolved.value).not.toBe(SETTINGS_SECRET_MASK);
  });

  it('the echoed mask inside the read-shape {values:{k:{value}}} envelope is a no-op too', async () => {
    const { svc, http } = makeSecretStack();
    await svc.set('secretsns', 'webhook_token', TOKEN_PLAINTEXT, { userId: 'usr_1' });

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    // Exactly what GET now returns, echoed back wholesale by a form save.
    const { req, res, state } = makeReqRes({
      params: { namespace: 'secretsns' },
      body: {
        values: {
          webhook_token: { value: SETTINGS_SECRET_MASK, source: 'user', locked: false },
        },
      },
    });
    await h(req, res);

    expect(state.status).toBe(200);
    expect((await svc.get<string>('secretsns', 'webhook_token', { userId: 'usr_1' })).value)
      .toBe(TOKEN_PLAINTEXT);
  });

  it('a REAL new secret still writes, and the write RESPONSE is redacted too', async () => {
    const { svc, http } = makeSecretStack();
    await svc.set('secretsns', 'smtp_password', SMTP_PLAINTEXT, { userId: 'usr_1' });

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({
      params: { namespace: 'secretsns' },
      body: { smtp_password: 'a-genuinely-new-secret' },
    });
    await h(req, res);

    expect(state.status).toBe(200);
    // The write took effect in the store…
    expect((await svc.get<string>('secretsns', 'smtp_password', { userId: 'usr_1' })).value)
      .toBe('a-genuinely-new-secret');
    // …but the response body does not echo it back over the wire.
    expect(JSON.stringify(state.body)).not.toContain('a-genuinely-new-secret');
    expect(state.body.data.values.smtp_password.value).toBe(SETTINGS_SECRET_MASK);
  });

  it('a non-encrypted key whose value genuinely IS the mask is written verbatim', async () => {
    // The drop is scoped to secret keys — it must not swallow a legal write.
    const { svc, http } = makeSecretStack();

    const h = http.routes.get('PUT /api/settings/:namespace')!;
    const { req, res, state } = makeReqRes({
      params: { namespace: 'secretsns' },
      body: { smtp_host: SETTINGS_SECRET_MASK },
    });
    await h(req, res);

    expect(state.status).toBe(200);
    expect((await svc.get<string>('secretsns', 'smtp_host', { userId: 'usr_1' })).value)
      .toBe(SETTINGS_SECRET_MASK);
  });

  // ── the other half of the boundary: the service layer is NOT redacted ──────

  it('in-process consumers still receive REAL plaintext (createClient / snapshotOf)', async () => {
    // This is the guard against someone later "fixing" #7522 in the service
    // layer: the mail/sms/storage/auth plugins read their credentials through
    // exactly this path, and a mask here would break every one of them.
    const { svc } = makeSecretStack();
    await svc.set('secretsns', 'smtp_password', SMTP_PLAINTEXT, { userId: 'usr_1' });
    await svc.set('secretsns', 'webhook_token', TOKEN_PLAINTEXT, { userId: 'usr_1' });

    const client = await svc.createClient('secretsns', { ctx: { userId: 'usr_1' } });
    expect(client.current.smtp_password).toBe(SMTP_PLAINTEXT);
    expect(client.get('webhook_token')).toBe(TOKEN_PLAINTEXT);

    // …and so does the raw service read the routes wrap.
    const payload = await svc.getNamespace('secretsns', { userId: 'usr_1' });
    expect(payload.values.smtp_password.value).toBe(SMTP_PLAINTEXT);
    expect(payload.values.webhook_token.value).toBe(TOKEN_PLAINTEXT);
    client.dispose();
  });

  it('secretKeysOf reports both flavours and refuses an unknown namespace', async () => {
    const { svc } = makeSecretStack();
    expect([...svc.secretKeysOf('secretsns')].sort()).toEqual(['smtp_password', 'webhook_token']);
    // Fail-closed: "unknown namespace" must never answer "nothing is secret".
    expect(() => svc.secretKeysOf('nope')).toThrow(
      expect.objectContaining({ code: 'SETTINGS_UNKNOWN_NAMESPACE' }),
    );
  });
});
