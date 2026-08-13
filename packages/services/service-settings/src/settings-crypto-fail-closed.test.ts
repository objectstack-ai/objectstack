// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8026 — **the settings write path fails CLOSED on a declared-encrypted key.**
 *
 * ## What was wrong
 *
 * `SettingsService` constructed with no `cryptoProvider` + `secretStore` fell
 * back to `NoopCryptoAdapter`, whose `encrypt()` is `'b64:' + base64(plain)`.
 * That is encoding, not encryption: trivially reversible, and it leaves
 * `sys_setting.value_enc` POPULATED — so the row reads as protected to the next
 * author and to the next audit while being plaintext with extra steps.
 *
 * The engine's `Field.secret()` path has always taken the opposite posture:
 * with no CryptoProvider registered it THROWS (`engine.ts` —
 * `encryptSecretFields`, "Refusing to store cleartext (fail-closed)"), which is
 * what makes a provider-less deployment safe to report on rather than silently
 * wrong. Two credential-encryption paths, opposite failure modes; this file
 * pins the settings side onto the engine's.
 *
 * ## Not a live-leak card
 *
 * The shipped plugin path wires a real `LocalCryptoProvider`
 * (`settings-service-plugin.ts`, at `kernel:ready` once an `objectql` engine
 * resolves). Nothing here closes a leak in a default deployment; it removes the
 * fail-OPEN direction from a path an engine-less deployment can still take.
 *
 * ## Why the harness is a real engine, and why that matters here
 *
 * The vacuity trap for a pin like this is a fixture that never reaches the
 * refused path at all: "no base64 value is persisted" is trivially green when
 * nothing was ever going to write one. So the cases below drive a GENUINELY
 * provider-less construction — a real `ObjectQL` over the real `SysSetting`
 * schema, `SettingsService` with no `crypto`, no `cryptoProvider` and no
 * `secretStore` — and assert the PERSISTED STATE off the driver, not just the
 * thrown error. On `origin/main` the same fixture writes a `sys_setting` row
 * whose `value_enc` is `b64:cmUtc2VjcmV0LTEyMw==`; that positive reading is what
 * makes the refusal assertion non-vacuous (see the PR body for the measurement).
 */

import { describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SysSetting } from '@objectstack/platform-objects/system';
import type { SettingsManifest } from '@objectstack/spec/system';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsService } from './settings-service.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { wrapEngineAsSettingsEngine } from './settings-service-plugin.js';
import { NoopCryptoAdapter, providesConfidentiality, type CryptoAdapter } from './crypto-adapter.js';
import { SettingsCryptoUnavailableError } from './settings-service.types.js';

const OWNER_PACKAGE = 'com.objectstack.test.settings-crypto-fail-closed';

const SECRET = 're-secret-123';
/** Exactly what `NoopCryptoAdapter.encrypt(SECRET)` produced on `origin/main`. */
const B64_OF_SECRET = 'b64:' + Buffer.from(SECRET, 'utf8').toString('base64');

/**
 * One encrypted key per flavour plus a plain control. Minimal on purpose: the
 * shipped manifests carry `visible` predicates and cross-field `required`
 * rules, and this file is about the crypto gate, not `validatePatch`.
 */
const manifest: SettingsManifest = {
  namespace: 'crypto_ns',
  version: 1,
  label: 'Crypto',
  scope: 'global',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [
    // Flavour A — implicitly encrypted because the TYPE is `password`. NB: this
    // is the settings manifest's `password`, meaning "encrypt this"; it is NOT
    // the objectql `Field` type and has nothing to do with ADR-0100.
    { type: 'password', key: 'api_key', label: 'API key', required: false },
    // Flavour B — an ordinary type carrying an explicit `encrypted: true`.
    { type: 'text', key: 'webhook_token', label: 'Webhook token', required: false, encrypted: true },
    // Control — never encrypted; must keep writing on a provider-less service.
    { type: 'text', key: 'from_email', label: 'From', required: false },
  ],
};

type Store = Map<string, Map<string, Record<string, unknown>>>;

/** A driver over plain Maps — enough of `IDataDriver` for the settings write path. */
function makeMemoryDriver() {
  const store: Store = new Map();
  let nextId = 0;
  const copy = (r: Record<string, unknown>) => ({ ...r });
  const rowsOf = (object: string) => {
    let s = store.get(object);
    if (!s) { s = new Map(); store.set(object, s); }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => (row[k] ?? null) === (v ?? null));
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      return [...rowsOf(object).values()].filter((r) => matches(r, ast?.where)).map(copy);
    },
    async findOne(object: string, ast: any) {
      for (const r of rowsOf(object).values()) if (matches(r, ast?.where)) return copy(r);
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `row_${nextId}`;
      const row = { ...data, id };
      rowsOf(object).set(id, row);
      return copy(row);
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = rowsOf(object);
      const cur = s.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      s.set(id, next);
      return copy(next);
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && rowsOf(object).has(id) ? this.update(object, id, data) : this.create(object, data);
    },
    async delete(object: string, id: string) { return rowsOf(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(object, ast);
      const s = rowsOf(object);
      for (const r of rows) s.set(r.id as string, { ...s.get(r.id as string), ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(object: string, ast: any) {
      const rows = await this.find(object, ast);
      for (const r of rows) rowsOf(object).delete(r.id as string);
      return rows.length;
    },
    async syncSchema() {}, async dropTable() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rowsOf };
}

/**
 * A real engine, the real adapter, and a service wired with NOTHING that can
 * encrypt — the engine-less-deployment shape the card is about, except that the
 * engine IS here so the persisted rows are inspectable. `opts.crypto` is left
 * undefined, so the constructor takes the `NoopCryptoAdapter` default: this is
 * the fallback under test, reached the way production would reach it.
 */
async function bootProviderless(opts: { crypto?: CryptoAdapter } = {}) {
  const engine = new ObjectQL();
  const { driver, rowsOf } = makeMemoryDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject(SysSetting as any, OWNER_PACKAGE);

  const logged: string[] = [];
  const svc = new SettingsService({
    env: {},
    engine: wrapEngineAsSettingsEngine(engine as any),
    ...(opts.crypto ? { crypto: opts.crypto } : {}),
    logger: { error: (m) => { logged.push(m); } },
  });
  svc.registerManifest(manifest);

  const settingRows = () => [...rowsOf('sys_setting').values()];
  const rowFor = (key: string) => settingRows().find((r) => r.key === key);
  return { svc, settingRows, rowFor, logged };
}

// ---------------------------------------------------------------------------
// 1. The refusal, and the state it leaves behind
// ---------------------------------------------------------------------------

describe('#8026 — a declared-encrypted write is refused when nothing can encrypt it', () => {
  it('rejects with SETTINGS_CRYPTO_UNAVAILABLE and persists NO row at all', async () => {
    const { svc, settingRows, rowFor } = await bootProviderless();

    const err = await svc
      .setMany('crypto_ns', { api_key: SECRET })
      .then(() => null, (e) => e);

    expect(err).toBeInstanceOf(SettingsCryptoUnavailableError);
    expect(err.code).toBe('SETTINGS_CRYPTO_UNAVAILABLE');
    expect(err.namespace).toBe('crypto_ns');
    expect(err.key).toBe('api_key');

    // The half that cannot be faked by a thrown error: nothing reached storage.
    // On `origin/main` this same fixture leaves one row whose `value_enc` is
    // exactly B64_OF_SECRET — which is why this assertion is not vacuous.
    expect(rowFor('api_key')).toBeUndefined();
    expect(JSON.stringify(settingRows())).not.toContain(B64_OF_SECRET);
    expect(JSON.stringify(settingRows())).not.toContain(SECRET);

    // And the read side agrees the value was never configured.
    const read = await svc.get('crypto_ns', 'api_key');
    expect(read.value ?? null).toBeNull();
  });

  it('refuses flavour B too — `encrypted: true` on an ordinary type', async () => {
    const { svc, rowFor } = await bootProviderless();
    await expect(svc.set('crypto_ns', 'webhook_token', 'whsec_live')).rejects.toBeInstanceOf(
      SettingsCryptoUnavailableError,
    );
    expect(rowFor('webhook_token')).toBeUndefined();
  });

  it('an explicitly injected NoopCryptoAdapter is refused just the same', async () => {
    // Provenance-independent on purpose: the fail-open path must not be
    // reachable by one line of caller code. The escape hatch is an adapter that
    // DECLARES confidentiality, not one that arrives by a different route.
    const { svc, rowFor } = await bootProviderless({ crypto: new NoopCryptoAdapter() });
    await expect(svc.set('crypto_ns', 'api_key', SECRET)).rejects.toBeInstanceOf(
      SettingsCryptoUnavailableError,
    );
    expect(rowFor('api_key')).toBeUndefined();
  });

  it('reports one operator-actionable line through the deployment logger', async () => {
    // The throw reaches the caller; the LOG is what reaches the operator when
    // the caller swallows it. Deduped per key, like the #5204 env reporter.
    const { svc, logged } = await bootProviderless();
    await svc.set('crypto_ns', 'api_key', SECRET).catch(() => {});
    await svc.set('crypto_ns', 'api_key', SECRET).catch(() => {});

    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("Cannot persist encrypted setting 'crypto_ns.api_key'");
    expect(logged[0]).toContain('fail-closed');
    // Never echo the secret itself into the log pipeline.
    expect(logged[0]).not.toContain(SECRET);
  });

  it('rejects the WHOLE batch — a plain sibling key is not half-written', async () => {
    // The pre-flight arm. Without it the write loop would persist `from_email`
    // and then throw on `api_key`, leaving the namespace half-applied.
    const { svc, rowFor } = await bootProviderless();
    await expect(
      svc.setMany('crypto_ns', { from_email: 'ops@example.com', api_key: SECRET }),
    ).rejects.toBeInstanceOf(SettingsCryptoUnavailableError);
    expect(rowFor('from_email')).toBeUndefined();
    expect(rowFor('api_key')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. What the refusal must NOT break
// ---------------------------------------------------------------------------

describe('#8026 — the refusal is scoped to secrets that would be stored unprotected', () => {
  it('non-encrypted keys still write on a provider-less service', async () => {
    const { svc, rowFor } = await bootProviderless();
    await svc.set('crypto_ns', 'from_email', 'ops@example.com');
    expect(rowFor('from_email')?.value).toBe('ops@example.com');
    expect((await svc.get('crypto_ns', 'from_email')).value).toBe('ops@example.com');
  });

  it('CLEARING an encrypted key is still allowed — there is no plaintext to protect', async () => {
    // A fail-closed path that also refuses `null` would trap an operator on a
    // provider-less deployment: unable to store a secret AND unable to remove
    // one already stored.
    const { svc, rowFor } = await bootProviderless();
    await svc.set('crypto_ns', 'api_key', null);
    expect(rowFor('api_key')?.value_enc ?? null).toBeNull();
    expect((await svc.get('crypto_ns', 'api_key')).value ?? null).toBeNull();
  });

  it('an adapter that DECLARES confidentiality still persists', async () => {
    // The injected-adapter seam (`SettingsServicePluginOptions.crypto`) is
    // untouched: a KMS-backed adapter is trusted on its declaration.
    const kms: CryptoAdapter = {
      confidential: true,
      encrypt: async (p) => 'kms:' + Buffer.from(p, 'utf8').toString('base64'),
      decrypt: async (c) => Buffer.from(c.replace(/^kms:/, ''), 'base64').toString('utf8'),
      digest: () => 'fnv32:deadbeef',
    };
    const { svc, rowFor } = await bootProviderless({ crypto: kms });
    await svc.set('crypto_ns', 'api_key', SECRET);
    expect(String(rowFor('api_key')?.value_enc)).toMatch(/^kms:/);
    expect((await svc.get('crypto_ns', 'api_key')).value).toBe(SECRET);
  });

  it('legacy `b64:` rows stay READABLE — the refusal is write-only', async () => {
    // The Noop adapter keeps decoding. A deployment that already wrote such
    // rows must still be able to read, report and migrate them; refusing the
    // read too would strand precisely the data this card wants surfaced.
    const noop: CryptoAdapter = new NoopCryptoAdapter();
    expect(await noop.decrypt(B64_OF_SECRET, { namespace: 'crypto_ns', key: 'api_key' })).toBe(SECRET);

    const { svc } = await bootProviderless();
    // Seed the row the OLD code would have written, straight past the gate.
    await (svc as any).upsertRow({
      namespace: 'crypto_ns',
      key: 'api_key',
      scope: 'global',
      user_id: null,
      value: null,
      value_enc: B64_OF_SECRET,
      encrypted: true,
    });
    expect((await svc.get('crypto_ns', 'api_key')).value).toBe(SECRET);
  });
});

// ---------------------------------------------------------------------------
// 3. The declaration the gate reads
// ---------------------------------------------------------------------------

describe('#8026 — providesConfidentiality', () => {
  it('NoopCryptoAdapter declares false; an undeclared adapter is assumed real', () => {
    expect(providesConfidentiality(new NoopCryptoAdapter())).toBe(false);
    const legacy = {
      encrypt: async (p: string) => p,
      decrypt: async (c: string) => c,
      digest: () => 'fnv32:00000000',
    } satisfies CryptoAdapter;
    // Silence must not start refusing adapters written before the flag existed;
    // they are deliberately-injected real ones. Opting IN is one line.
    expect(providesConfidentiality(legacy)).toBe(true);
  });

  it('the declaration wins over the class — a real subclass opts back in', () => {
    class RealSubclass extends NoopCryptoAdapter {
      override readonly confidential = true;
      override async encrypt(plaintext: string): Promise<string> {
        return 'kms:' + plaintext;
      }
    }
    expect(providesConfidentiality(new RealSubclass())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. The wire
// ---------------------------------------------------------------------------

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

describe('#8026 — the refusal on the REST boundary', () => {
  it('PUT answers the declared envelope: status 500, code INTERNAL_ERROR, actionable message', async () => {
    // There is no dedicated wire code yet — `SETTINGS_CRYPTO_UNAVAILABLE` would
    // have to be registered in `ERROR_CODE_LEDGER` (`packages/spec`) first, and
    // that is out of this card's scope. So the refusal takes the same
    // `500 INTERNAL_ERROR` arm every unmapped service error takes; what this
    // case pins is that it does so INSIDE the envelope, carrying the operator's
    // fix, and that the request wrote nothing.
    const { svc, rowFor } = await bootProviderless();
    const http = new MockHttp();
    registerSettingsRoutes(http, svc, {
      contextFromRequest: () => ({ enforced: true, permissions: ['setup.access', 'setup.write'] }),
    });

    const state: { status: number; body?: any } = { status: 200 };
    const req = {
      params: { namespace: 'crypto_ns' },
      query: {},
      body: { api_key: SECRET },
      headers: {},
      method: 'PUT',
      path: '/api/settings/crypto_ns',
    } as unknown as IHttpRequest;
    const res = {
      json: (data: any) => { state.body = data; },
      send: () => {},
      status: (code: number) => { state.status = code; return res; },
      header: () => res,
    } as unknown as IHttpResponse;

    await http.routes.get('PUT /api/settings/:namespace')!(req, res);

    expect(state.status).toBe(500);
    expect(state.body.success).toBe(false);
    expect(state.body.error.code).toBe('INTERNAL_ERROR');
    expect(state.body.error.message).toContain('fail-closed');
    expect(state.body.error.message).toContain('cryptoProvider');
    // Nothing leaked the submitted secret back over the wire, and nothing landed.
    expect(JSON.stringify(state.body)).not.toContain(SECRET);
    expect(rowFor('api_key')).toBeUndefined();
  });
});
