// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
/**
 * [#8009] The OIDC `clientSecret` must not be at rest in cleartext — and the
 * federated login it authenticates must still work.
 *
 * Both halves are asserted, deliberately. A test that only checked "no cleartext
 * at rest" would pass on a build where every SSO login is broken, because
 * deleting the secret satisfies it perfectly. So each case below pins one of:
 *
 *   ① after register, and after update-provider, the stored row carries NO
 *      plaintext in ANY column — and the secret column holds a `secret:` ref
 *      backed by a real `sys_secret` ciphertext row;
 *   ② better-auth reads the provider back through the adapter and gets the
 *      CORRECT plaintext, which is what `/sso/callback` hands the IdP.
 *
 * The write path under test is the real one: a real `betterAuth` with the real
 * `sso()` plugin over the real `createObjectQLAdapterFactory` on a real ObjectQL
 * engine and a real better-sqlite3 database, with a real signed-up admin and a
 * real session cookie. Only the IdP's discovery document is stubbed — that is
 * network, not storage.
 *
 * ⚠️ Registration is driven against `/sso/register` directly rather than through
 * the `register_sso_provider` UI action, because that bridge currently 400s on
 * an unrelated defect (#8193: it always sends `oidcConfig.mapping.id`, which
 * the installed `@better-auth/sso@1.7.1` rejects — `oidcMappingSchema` at
 * `dist/index.mjs:1852` is a `z.strictObject` whose members are
 * `{ email, emailVerified?, name, image?, extraFields? }`, with no `id`;
 * measured 2026-08-20). Same adapter,
 * same write door; #8193 is filed separately and is not this card's scope.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { Field } from '@objectstack/spec/data';
import type { ICryptoProvider, CryptoHandle, CryptoContext } from '@objectstack/spec/contracts';
import { betterAuth } from 'better-auth';
import { sso } from '@better-auth/sso';
import { createObjectQLAdapterFactory } from './objectql-adapter.js';
import {
  SSO_CLIENT_SECRET_FIELD,
  SSO_PROVIDER_OBJECT,
  liftClientSecretForWrite,
  migrateLegacySsoClientSecrets,
} from './sso-client-secret.js';
import {
  AUTH_USER_CONFIG,
  AUTH_SESSION_CONFIG,
  AUTH_ACCOUNT_CONFIG,
  AUTH_VERIFICATION_CONFIG,
} from './auth-schema-config.js';
import {
  SysUser,
  SysSession,
  SysAccount,
  SysVerification,
  SysSsoProvider,
  SysSecret,
} from '@objectstack/platform-objects';
import { authObjectExtensions } from './manifest.js';

/**
 * The secret under test. Chosen HERE, by the test, and fed in through the public
 * register endpoint — the implementation never supplies this value, so an
 * assertion against it cannot be satisfied by the code under test agreeing with
 * itself.
 */
const SECRET_UNDER_TEST = 'super-secret-oidc-client-secret-8009-impl';
const ROTATED_SECRET = 'rotated-oidc-client-secret-8009-impl';
const BASE = 'http://localhost:3000';
const IDP = 'https://idp.acme.com';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    const e = engines.pop();
    try { await (e as unknown as { destroy?(): Promise<void> })?.destroy?.(); } catch { /* noop */ }
  }
});

/**
 * A stand-in `ICryptoProvider`. The host injects the real one (`serve.ts` wires
 * `LocalCryptoProvider`, AES-256-GCM off `OS_SECRET_KEY`); objectql takes no
 * dependency on an implementation, so neither does this test. Base64 is enough
 * to tell ciphertext from plaintext, which is the only property asserted.
 */
function makeFakeCrypto(): ICryptoProvider {
  let n = 0;
  return {
    async encrypt(plain: string, _ctx: CryptoContext): Promise<CryptoHandle> {
      n += 1;
      return {
        id: `sec_${n}`, kmsKeyId: 'local', alg: 'test-b64', version: 1,
        ciphertext: Buffer.from(plain, 'utf8').toString('base64'),
      };
    },
    async decrypt(handle: CryptoHandle): Promise<string> {
      return Buffer.from(handle.ciphertext, 'base64').toString('utf8');
    },
    async rotateKey(handle: CryptoHandle): Promise<CryptoHandle> {
      return { ...handle, version: handle.version + 1 };
    },
    digest(plain: string): string { return `d:${plain.length}`; },
  };
}

/** The `oidc_client_secret` column, exactly as the plugin manifest declares it. */
function ssoProviderWithSecretColumn(): unknown {
  const ext = authObjectExtensions.find((e) => e.extend === SSO_PROVIDER_OBJECT);
  if (!ext) throw new Error('plugin-auth no longer declares the sys_sso_provider extension');
  return { ...(SysSsoProvider as object), fields: { ...(SysSsoProvider as { fields: object }).fields, ...ext.fields } };
}

async function bootEngine(opts: { withCrypto?: boolean; withSecretColumn?: boolean } = {}) {
  const engine = new ObjectQL();
  engines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  for (const o of [SysUser, SysSession, SysAccount, SysVerification, SysSecret]) {
    engine.registry.registerObject(o as never);
  }
  engine.registry.registerObject(
    (opts.withSecretColumn === false ? SysSsoProvider : ssoProviderWithSecretColumn()) as never,
  );
  await engine.syncSchemas();
  if (opts.withCrypto !== false) engine.setCryptoProvider(makeFakeCrypto());
  return engine;
}

/** Discovery document the register endpoint hydrates from (network, not storage). */
function stubDiscovery() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    if (url.includes('.well-known/openid-configuration')) {
      return new Response(JSON.stringify({
        issuer: IDP,
        authorization_endpoint: `${IDP}/authorize`,
        token_endpoint: `${IDP}/token`,
        userinfo_endpoint: `${IDP}/userinfo`,
        jwks_uri: `${IDP}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return (realFetch as (i: unknown, x?: unknown) => Promise<Response>)(input, init);
  }) as typeof globalThis.fetch;
  return () => { globalThis.fetch = realFetch; };
}

function makeAuth(engine: ObjectQL) {
  return betterAuth({
    secret: 'test-secret-at-least-32-chars-long-xxx',
    baseURL: BASE,
    basePath: '/api/v1/auth',
    trustedOrigins: [BASE, IDP],
    emailAndPassword: { enabled: true },
    user: { ...AUTH_USER_CONFIG },
    session: { ...AUTH_SESSION_CONFIG },
    account: { ...AUTH_ACCOUNT_CONFIG },
    verification: { ...AUTH_VERIFICATION_CONFIG },
    database: createObjectQLAdapterFactory(engine as never),
    plugins: [sso({ organizationProvisioning: { defaultRole: 'member' } })],
  });
}

async function signUpAdmin(auth: ReturnType<typeof makeAuth>): Promise<string> {
  const res = await auth.handler(new Request(`${BASE}/api/v1/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email: 'admin@acme.com', password: 'Password123!', name: 'Admin' }),
  }));
  expect(res.status).toBeLessThan(400);
  return (res.headers.get('set-cookie') ?? '')
    .split(',').map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
}

function registerBody(secret: string) {
  return {
    providerId: 'acme-okta',
    issuer: IDP,
    domain: 'acme.com',
    oidcConfig: {
      clientId: 'acme-client-id',
      clientSecret: secret,
      scopes: ['openid', 'email', 'profile'],
      mapping: { email: 'email', name: 'name' },
    },
  };
}

/** The stored row, read at DRIVER level — below every engine read mask. */
async function readRowAtRest(engine: ObjectQL): Promise<Record<string, unknown>> {
  const driver = (engine as unknown as { getDriver(o: string): { find(o: string, q: unknown): Promise<unknown> } })
    .getDriver(SSO_PROVIDER_OBJECT);
  const found = await driver.find(SSO_PROVIDER_OBJECT, { where: {} });
  const rows = Array.isArray(found) ? found : [found];
  return rows[0] as Record<string, unknown>;
}

describe('[#8009] sys_sso_provider OIDC clientSecret at rest', () => {
  it('① register: no plaintext in ANY column, and the column holds a real ciphertext ref', async () => {
    const restore = stubDiscovery();
    try {
      const engine = await bootEngine();
      const auth = makeAuth(engine);
      const cookie = await signUpAdmin(auth);

      const res = await auth.handler(new Request(`${BASE}/api/v1/auth/sso/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE, cookie },
        body: JSON.stringify(registerBody(SECRET_UNDER_TEST)),
      }));
      expect(res.status).toBe(200);

      const row = await readRowAtRest(engine);
      // Whole-row scan, not just oidc_config: moving the secret into some other
      // cleartext column would satisfy a column-scoped check and change nothing.
      expect(JSON.stringify(row)).not.toContain(SECRET_UNDER_TEST);
      expect(String(row.oidc_config)).not.toContain(SECRET_UNDER_TEST);
      expect(String(row.oidc_config)).not.toContain('clientSecret');
      // …and the rest of the config is still readable, which is the whole reason
      // only `clientSecret` was split out rather than the blob as a whole.
      const blob = JSON.parse(String(row.oidc_config)) as Record<string, unknown>;
      expect(blob.clientId).toBe('acme-client-id');
      expect(blob.tokenEndpoint).toBe(`${IDP}/token`);

      // The column holds a ref, and the ciphertext behind it is not the plaintext.
      expect(String(row[SSO_CLIENT_SECRET_FIELD])).toMatch(/^secret:/);
      const secrets = await engine.find('sys_secret', {} as never) as Record<string, unknown>[];
      expect(secrets.length).toBe(1);
      expect(String(secrets[0].ciphertext)).not.toContain(SECRET_UNDER_TEST);
      expect(secrets[0].namespace).toBe(SSO_PROVIDER_OBJECT);
      expect(secrets[0].key).toBe(SSO_CLIENT_SECRET_FIELD);

      // The generic data API (apiMethods get/list) returns the mask, never the value.
      const viaApi = await engine.find(SSO_PROVIDER_OBJECT, {} as never) as Record<string, unknown>[];
      expect(String(viaApi[0][SSO_CLIENT_SECRET_FIELD])).not.toContain(SECRET_UNDER_TEST);
    } finally { restore(); }
  }, 60_000);

  it('② callback path: better-auth reads the provider back with the CORRECT plaintext', async () => {
    const restore = stubDiscovery();
    try {
      const engine = await bootEngine();
      const auth = makeAuth(engine);
      const cookie = await signUpAdmin(auth);
      const res = await auth.handler(new Request(`${BASE}/api/v1/auth/sso/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE, cookie },
        body: JSON.stringify(registerBody(SECRET_UNDER_TEST)),
      }));
      expect(res.status).toBe(200);

      // Read the provider exactly the way `/sso/callback` does — through
      // better-auth's OWN adapter, by provider id. This is the read that feeds
      // the IdP token exchange; if it does not yield the plaintext, every
      // federated login is broken.
      const adapter = (auth as unknown as {
        $context: Promise<{ adapter: { findOne(a: unknown): Promise<Record<string, unknown> | null> } }>;
      }).$context;
      const ctx = await adapter;
      const provider = await ctx.adapter.findOne({
        model: 'ssoProvider',
        where: [{ field: 'providerId', value: 'acme-okta', operator: 'eq', connector: 'AND' }],
      });
      expect(provider).toBeTruthy();

      const recovered = JSON.parse(String(provider!.oidcConfig)) as Record<string, unknown>;
      // Compared against the TEST's literal — never against anything the seam
      // produced, which would be an assertion that cannot fail.
      expect(recovered.clientSecret).toBe(SECRET_UNDER_TEST);
      // …and the rest of the config survived the round trip intact.
      expect(recovered.clientId).toBe('acme-client-id');
      expect(recovered.tokenEndpoint).toBe(`${IDP}/token`);
      // better-auth must never be handed the internal column or its mask.
      expect(provider!.oidcClientSecret).toBeUndefined();
      expect(JSON.stringify(provider)).not.toContain('••');
    } finally { restore(); }
  }, 60_000);

  it('③ update-provider: the second write door does not put cleartext back', async () => {
    const restore = stubDiscovery();
    try {
      const engine = await bootEngine();
      const auth = makeAuth(engine);
      const cookie = await signUpAdmin(auth);
      await auth.handler(new Request(`${BASE}/api/v1/auth/sso/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE, cookie },
        body: JSON.stringify(registerBody(SECRET_UNDER_TEST)),
      }));

      // Drive better-auth's own update door with a rotated secret.
      const upd = await auth.handler(new Request(`${BASE}/api/v1/auth/sso/update-provider`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE, cookie },
        body: JSON.stringify({
          providerId: 'acme-okta',
          oidcConfig: {
            clientId: 'acme-client-id',
            clientSecret: ROTATED_SECRET,
            scopes: ['openid', 'email', 'profile'],
            mapping: { email: 'email', name: 'name' },
          },
        }),
      }));

      const row = await readRowAtRest(engine);
      const serialized = JSON.stringify(row);
      // Whichever way the endpoint resolved, NEITHER secret may be at rest.
      expect(serialized).not.toContain(ROTATED_SECRET);
      expect(serialized).not.toContain(SECRET_UNDER_TEST);
      expect(String(row[SSO_CLIENT_SECRET_FIELD])).toMatch(/^secret:/);

      // If the update landed, the new secret must be what reads back.
      if (upd.status === 200) {
        const ctx = await (auth as unknown as {
          $context: Promise<{ adapter: { findOne(a: unknown): Promise<Record<string, unknown> | null> } }>;
        }).$context;
        const provider = await ctx.adapter.findOne({
          model: 'ssoProvider',
          where: [{ field: 'providerId', value: 'acme-okta', operator: 'eq', connector: 'AND' }],
        });
        const recovered = JSON.parse(String(provider!.oidcConfig)) as Record<string, unknown>;
        expect(recovered.clientSecret).toBe(ROTATED_SECRET);
      }
    } finally { restore(); }
  }, 60_000);

  it('④ fail-closed: with no CryptoProvider the write is REFUSED, never stored cleartext', async () => {
    const restore = stubDiscovery();
    try {
      const engine = await bootEngine({ withCrypto: false });
      const auth = makeAuth(engine);
      const cookie = await signUpAdmin(auth);

      const res = await auth.handler(new Request(`${BASE}/api/v1/auth/sso/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: BASE, cookie },
        body: JSON.stringify(registerBody(SECRET_UNDER_TEST)),
      }));
      // The engine refuses rather than falling back to cleartext, so the
      // registration fails loudly. What must NOT happen is a 200 with the
      // secret on disk.
      expect(res.status).not.toBe(200);
      const rows = await engine.find(SSO_PROVIDER_OBJECT, {} as never) as Record<string, unknown>[];
      expect(JSON.stringify(rows)).not.toContain(SECRET_UNDER_TEST);
    } finally { restore(); }
  }, 60_000);

  it('⑤ legacy rows: a pre-existing cleartext row still logs in, and migrates forward', async () => {
    const engine = await bootEngine();
    // A row exactly as the shipped code wrote it: secret inside the blob,
    // encrypted column empty. Written through the DRIVER so the engine's own
    // secret handling cannot pre-empt the very state under test.
    const driver = (engine as unknown as {
      getDriver(o: string): { create(o: string, r: unknown, x?: unknown): Promise<unknown> };
    }).getDriver(SSO_PROVIDER_OBJECT);
    await driver.create(SSO_PROVIDER_OBJECT, {
      id: 'legacy-1',
      provider_id: 'legacy-okta',
      issuer: IDP,
      domain: 'legacy.com',
      oidc_config: JSON.stringify({ clientId: 'legacy-id', clientSecret: SECRET_UNDER_TEST, tokenEndpoint: `${IDP}/token` }),
    });

    // Before migration: it is cleartext, and the read half must still hand
    // better-auth a WORKING secret (case 2) — otherwise the upgrade breaks
    // every existing federated login.
    const auth = makeAuth(engine);
    const ctx = await (auth as unknown as {
      $context: Promise<{ adapter: { findOne(a: unknown): Promise<Record<string, unknown> | null> } }>;
    }).$context;
    const before = await ctx.adapter.findOne({
      model: 'ssoProvider',
      where: [{ field: 'providerId', value: 'legacy-okta', operator: 'eq', connector: 'AND' }],
    });
    expect(JSON.parse(String(before!.oidcConfig)).clientSecret).toBe(SECRET_UNDER_TEST);

    // The migration moves it into the encrypted channel.
    const result = await migrateLegacySsoClientSecrets(engine as never);
    expect(result.found).toBe(1);
    expect(result.migrated).toBe(1);
    expect(result.failures).toEqual([]);

    const row = await readRowAtRest(engine);
    expect(JSON.stringify(row)).not.toContain(SECRET_UNDER_TEST);
    expect(String(row[SSO_CLIENT_SECRET_FIELD])).toMatch(/^secret:/);

    // …and it still reads back correctly afterwards.
    const after = await ctx.adapter.findOne({
      model: 'ssoProvider',
      where: [{ field: 'providerId', value: 'legacy-okta', operator: 'eq', connector: 'AND' }],
    });
    expect(JSON.parse(String(after!.oidcConfig)).clientSecret).toBe(SECRET_UNDER_TEST);

    // Idempotent: a second sweep finds nothing left to do.
    const again = await migrateLegacySsoClientSecrets(engine as never);
    expect(again.found).toBe(0);
  }, 60_000);
});

describe('[#8009] the write seam in isolation', () => {
  it('leaves a partial update alone rather than blanking the stored secret', () => {
    // `/sso/update-provider` may send a config with no clientSecret. Blanking
    // the credential on such a write would break every later login.
    const patch: Record<string, unknown> = {
      oidc_config: JSON.stringify({ clientId: 'acme-client-id', scopes: ['openid'] }),
    };
    expect(liftClientSecretForWrite(SSO_PROVIDER_OBJECT, patch)).toBe(false);
    expect(patch[SSO_CLIENT_SECRET_FIELD]).toBeUndefined();
    expect(JSON.parse(String(patch.oidc_config)).clientId).toBe('acme-client-id');
  });

  it('does not touch rows of other objects', () => {
    const row: Record<string, unknown> = {
      oidc_config: JSON.stringify({ clientSecret: SECRET_UNDER_TEST }),
    };
    expect(liftClientSecretForWrite('sys_user', row)).toBe(false);
    expect(String(row.oidc_config)).toContain(SECRET_UNDER_TEST);
  });

  it('leaves a malformed blob untouched rather than rewriting it', () => {
    const row: Record<string, unknown> = { oidc_config: 'not json at all' };
    expect(liftClientSecretForWrite(SSO_PROVIDER_OBJECT, row)).toBe(false);
    expect(row.oidc_config).toBe('not json at all');
    expect(row[SSO_CLIENT_SECRET_FIELD]).toBeUndefined();
  });

  it('declares the column as type secret — the encrypted channel, not a plain column', () => {
    const ext = authObjectExtensions.find((e) => e.extend === SSO_PROVIDER_OBJECT);
    expect((ext!.fields as Record<string, { type?: string }>)[SSO_CLIENT_SECRET_FIELD].type).toBe('secret');
  });
});
