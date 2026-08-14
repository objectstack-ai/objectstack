// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// End-to-end regression tests for #3585 — the JWT plugin's EdDSA keygen broke
// login on hosts without Ed25519 (StackBlitz/WebContainer).
//
// These run the REAL better-auth pipeline (like
// auth-manager.optional-plugin-isolation.test.ts, and unlike auth-manager.test.ts
// which mocks better-auth itself), against a WebCrypto that has had Ed25519
// removed exactly the way WebContainer's has: `crypto.subtle.generateKey` /
// `importKey` reject `{ name: 'Ed25519' }` with an OperationError, and every
// other algorithm keeps working. Nothing about the plugin wiring is stubbed —
// if the fallback did not reach jose, these tests would 500 like the bug report.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
import { AuthManager } from './auth-manager';

const createMemoryEngine = () => {
  const tables = new Map<string, any[]>();
  const rows = (name: string) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  };
  const eq = (a: any, b: any) =>
    a instanceof Date || b instanceof Date
      ? new Date(a as any).getTime() === new Date(b as any).getTime()
      : a === b;
  const matches = (row: any, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      const actual = row[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        if ('$ne' in v) return !eq(actual, v.$ne);
        if ('$in' in v) return (v.$in as any[]).some((x) => eq(actual, x));
        if ('$gt' in v) return actual > v.$gt;
        if ('$gte' in v) return actual >= v.$gte;
        if ('$lt' in v) return actual < v.$lt;
        if ('$lte' in v) return actual <= v.$lte;
        if ('$regex' in v) return new RegExp(String(v.$regex)).test(String(actual ?? ''));
      }
      return eq(actual, v);
    });
  let seq = 0;
  return {
    tables,
    async insert(name: string, data: any) {
      const row = { id: data.id ?? `row_${++seq}`, ...data };
      rows(name).push(row);
      return { ...row };
    },
    async findOne(name: string, q: any = {}) {
      return rows(name).find((r) => matches(r, q.where)) ?? null;
    },
    async find(name: string, q: any = {}) {
      let out = rows(name).filter((r) => matches(r, q.where));
      const order = q.orderBy?.[0];
      if (order) {
        out = [...out].sort(
          (a, b) => (a[order.field] > b[order.field] ? 1 : -1) * (order.order === 'desc' ? -1 : 1),
        );
      }
      if (q.offset) out = out.slice(q.offset);
      if (q.limit) out = out.slice(0, q.limit);
      return out.map((r) => ({ ...r }));
    },
    async count(name: string, q: any = {}) {
      return rows(name).filter((r) => matches(r, q.where)).length;
    },
    async update(name: string, patch: any) {
      const row = rows(name).find((r) => r.id === patch.id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async delete(name: string, q: any = {}) {
      // [#4550] Pinned to ObjectQL.delete's own dispatch predicate rather than a
      // hand-written approximation of it: a fake that accepts a call the real
      // engine refuses is how #4434 shipped a dead REST route with its suite
      // green.
      //
      // Measured, so the claim stays honest: the paths this file drives
      // (sign-up → get-session → /jwks) never reach a delete today, so this
      // line cannot currently flip the suite red. It is a forward guard. What
      // it guards is that better-auth's adapter only ever deletes by SCALAR id
      // — `objectql-adapter.ts`'s `delete`/`deleteMany`/`consumeOne` each
      // resolve the row first, then call `delete(object, { where: { id } })` —
      // so the day an upgrade routes a session/verification purge through here
      // as a bare predicate, this fails in a unit test instead of 500ing on a
      // real server.
      assertEngineDeleteDispatch(q);
      const table = rows(name);
      const keep = table.filter((r) => !matches(r, q.where));
      tables.set(name, keep);
      return table.length - keep.length;
    },
  };
};

/**
 * Remove Ed25519 from this process's WebCrypto, the way WebContainer's lacks it.
 *
 * This is deliberately stronger than stubbing our own probe. If the probe were
 * the only thing stubbed, real WebCrypto would still happily import an Ed25519
 * key — so a regression that let better-auth select a stored EdDSA key would
 * pass the test and still 500 on the real host. Patching WebCrypto itself makes
 * the test fail for the same reason production would.
 *
 * `generateKey` is where the reported stack died (`cfrgGenerateKey`), and
 * `importKey` is patched with it because that is what a deployment with an
 * ALREADY-MINTED EdDSA key hits first, via `importJWK` in resolveSigningKey.
 * Every other algorithm delegates to the real implementation, so ES256 keygen,
 * AES-GCM private-key encryption and session hashing all still work.
 */
const removeEd25519 = (): { restore: () => void } => {
  const subtle = globalThis.crypto.subtle as any;
  const originalGenerateKey = subtle.generateKey.bind(subtle);
  const originalImportKey = subtle.importKey.bind(subtle);
  const isEd25519 = (algorithm: any) =>
    (typeof algorithm === 'string' ? algorithm : algorithm?.name) === 'Ed25519';
  const operationError = () =>
    Object.assign(new Error('The operation failed for an operation-specific reason'), {
      name: 'OperationError',
    });

  subtle.generateKey = async (algorithm: any, ...rest: any[]) => {
    if (isEd25519(algorithm)) throw operationError();
    return originalGenerateKey(algorithm, ...rest);
  };
  subtle.importKey = async (format: any, keyData: any, algorithm: any, ...rest: any[]) => {
    if (isEd25519(algorithm)) throw operationError();
    return originalImportKey(format, keyData, algorithm, ...rest);
  };

  return {
    restore: () => {
      subtle.generateKey = originalGenerateKey;
      subtle.importKey = originalImportKey;
    },
  };
};

/** Decode a compact JWS header without verifying — we only assert `alg`. */
const jwtHeader = (token: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8'));

const SECRET = 'test-secret-at-least-32-chars-long!!';

const makeManager = (engine: any) =>
  new AuthManager({
    secret: SECRET,
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    plugins: { oidcProvider: true },
  });

const signUp = (manager: AuthManager, email: string) =>
  manager.handleRequest(
    new Request('http://localhost:3000/api/v1/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'S3cure!Passw0rd-3585', name: 'Ed25519 Test' }),
    }),
  );

const getSession = (manager: AuthManager, cookie: string) =>
  manager.handleRequest(
    new Request('http://localhost:3000/api/v1/auth/get-session', { headers: { cookie } }),
  );

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');

describe('#3585 — JWT signing on a host without Ed25519', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let patched: { restore: () => void } | undefined;

  beforeEach(() => {
    patched = undefined;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    patched?.restore();
    vi.restoreAllMocks();
  });

  it('control: on a host WITH Ed25519 nothing changes — get-session 200, EdDSA header', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine as any);

    const signed = await signUp(manager, 'healthy@example.com');
    expect(signed.status).toBe(200);

    const session = await getSession(manager, cookieFrom(signed));
    expect(session.status).toBe(200);

    const token = session.headers.get('set-auth-jwt');
    expect(token).toBeTruthy();
    expect(jwtHeader(token!).alg).toBe('EdDSA');
    expect(manager.getDegradedAuthFeatures()).toEqual([]);
  });

  it('the reported bug: sign-in + get-session both 200 on a host without Ed25519', async () => {
    const engine = createMemoryEngine();
    patched = removeEd25519();
    const manager = makeManager(engine as any);

    const signed = await signUp(manager, 'webcontainer@example.com');
    expect(signed.status).toBe(200);

    const session = await getSession(manager, cookieFrom(signed));

    // The bug: this was a 500 with `OperationError ... cfrgGenerateKey`.
    expect(session.status).toBe(200);
    const token = session.headers.get('set-auth-jwt');
    expect(token).toBeTruthy();
    expect(jwtHeader(token!).alg).toBe('ES256');
    expect(manager.getDegradedAuthFeatures()).toEqual([]);
  });

  it('mints an ES256 key into sys_jwks, and says which algorithm it chose and why', async () => {
    const engine = createMemoryEngine();
    patched = removeEd25519();
    const manager = makeManager(engine as any);

    const signed = await signUp(manager, 'keys@example.com');
    await getSession(manager, cookieFrom(signed));

    const keys = engine.tables.get('sys_jwks') ?? [];
    expect(keys).toHaveLength(1);
    expect(keys[0]!.alg).toBe('ES256');

    // The operator has to be able to correlate "my tokens are ES256" with a
    // cause; the message names the algorithm, not just "keygen failed".
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("WebCrypto has no Ed25519"),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('ES256'));
  });

  it('the /jwks endpoint serves the ES256 key rather than 500ing', async () => {
    const engine = createMemoryEngine();
    patched = removeEd25519();
    const manager = makeManager(engine as any);

    const signed = await signUp(manager, 'jwks@example.com');
    await getSession(manager, cookieFrom(signed));

    const response = await manager.handleRequest(
      new Request('http://localhost:3000/api/v1/auth/jwks'),
    );
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.keys.map((k: any) => k.alg)).toEqual(['ES256']);
  });
});

describe('#3585 — an EXISTING EdDSA key when the host loses Ed25519', () => {
  // The upgrade path, and the part configuring `keyPairConfig` alone does not
  // fix: better-auth's resolveSigningKey falls back to `getLatestKey()` (ANY
  // algorithm) when no key matches the configured one, so a stored EdDSA key
  // would be selected and then die in `importJWK`.
  let patched: { restore: () => void } | undefined;

  beforeEach(() => {
    patched = undefined;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    patched?.restore();
    vi.restoreAllMocks();
  });

  it('a deployment that already minted EdDSA keeps working after moving to such a host', async () => {
    const engine = createMemoryEngine();

    // ── Phase 1: a normal host mints a REAL EdDSA key (better-auth's own
    //    createJwk, correctly encrypted under the real secret — not a fixture).
    const healthy = makeManager(engine as any);
    const signed = await signUp(healthy, 'migrating@example.com');
    const cookie = cookieFrom(signed);
    const before = await getSession(healthy, cookie);
    expect(jwtHeader(before.headers.get('set-auth-jwt')!).alg).toBe('EdDSA');
    expect(engine.tables.get('sys_jwks')!.map((k: any) => k.alg)).toEqual(['EdDSA']);

    // ── Phase 2: same database, host without Ed25519.
    patched = removeEd25519();
    const degraded = makeManager(engine as any);

    const after = await getSession(degraded, cookie);

    // Not a 500, and not merely "no header": the deployment CONVERGES on a
    // usable algorithm instead of sitting broken.
    expect(after.status).toBe(200);
    const token = after.headers.get('set-auth-jwt');
    expect(token).toBeTruthy();
    expect(jwtHeader(token!).alg).toBe('ES256');
    expect(degraded.getDegradedAuthFeatures()).toEqual([]);
  });

  it('the stored EdDSA row is HIDDEN, never deleted — moving back restores it', async () => {
    const engine = createMemoryEngine();

    const healthy = makeManager(engine as any);
    const signed = await signUp(healthy, 'preserve@example.com');
    const cookie = cookieFrom(signed);
    await getSession(healthy, cookie);
    const eddsaId = engine.tables.get('sys_jwks')![0]!.id;

    patched = removeEd25519();
    const degraded = makeManager(engine as any);
    await getSession(degraded, cookie);

    // Both rows are still on disk…
    const stored = engine.tables.get('sys_jwks')!;
    expect(stored.map((k: any) => k.alg).sort()).toEqual(['ES256', 'EdDSA']);
    expect(stored.some((k: any) => k.id === eddsaId)).toBe(true);

    // …but this host does not advertise the one it cannot sign or verify with.
    const jwks: any = await (
      await degraded.handleRequest(new Request('http://localhost:3000/api/v1/auth/jwks'))
    ).json();
    expect(jwks.keys.map((k: any) => k.alg)).toEqual(['ES256']);

    // Move back to a host with Ed25519: the original key is visible again.
    patched.restore();
    patched = undefined;
    const restored = makeManager(engine as any);
    const restoredJwks: any = await (
      await restored.handleRequest(new Request('http://localhost:3000/api/v1/auth/jwks'))
    ).json();
    expect(restoredJwks.keys.map((k: any) => k.alg).sort()).toEqual(['ES256', 'EdDSA']);
  });
});

describe('#3585 — degradation when signing cannot work at all', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a session is still returned when JWT signing throws — no 500 on the session path', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine as any);

    const signed = await signUp(manager, 'nosign@example.com');
    const cookie = cookieFrom(signed);

    // Break signing after sign-up: every jwks write fails, so there is no key
    // to sign with and no way to mint one. (Models a host where neither
    // algorithm works, or an unwritable sys_jwks.)
    const originalInsert = engine.insert.bind(engine);
    engine.insert = async (name: string, data: any) => {
      if (name === 'sys_jwks') throw new Error('sys_jwks is not writable (simulated)');
      return originalInsert(name, data);
    };

    const session = await getSession(manager, cookie);

    // The session itself is valid and must be returned — the JWT header is an
    // optional enrichment, not the session.
    expect(session.status).toBe(200);
    const body: any = await session.json();
    expect(body?.user?.email).toBe('nosign@example.com');
    expect(session.headers.get('set-auth-jwt')).toBeNull();
  });

  it('the degradation is recorded and announced once, naming the algorithm and the remedy', async () => {
    const engine = createMemoryEngine();
    const manager = makeManager(engine as any);

    const signed = await signUp(manager, 'announce@example.com');
    const cookie = cookieFrom(signed);

    const originalInsert = engine.insert.bind(engine);
    engine.insert = async (name: string, data: any) => {
      if (name === 'sys_jwks') throw new Error('sys_jwks is not writable (simulated)');
      return originalInsert(name, data);
    };

    await getSession(manager, cookie);

    expect(manager.getDegradedAuthFeatures()).toEqual([
      expect.objectContaining({ feature: 'jwtSigning' }),
    ]);

    const announcement = errorSpy.mock.calls.find((call) =>
      String(call[0]).includes('JWT signing failed'),
    );
    expect(announcement).toBeTruthy();
    // Names the algorithm (the issue's complaint was that the error pointed at
    // better-auth rather than the algorithm choice)…
    expect(String(announcement![0])).toContain('EdDSA');
    // …says what still works, so nobody reads it as "auth is down"…
    expect(String(announcement![0])).toContain('sign-in and cookie auth are unaffected');
    // …and names the opt-out.
    expect(String(announcement![0])).toContain('OS_OIDC_PROVIDER_ENABLED=false');

    // Said ONCE, not once per request.
    await getSession(manager, cookie);
    await getSession(manager, cookie);
    const announcements = errorSpy.mock.calls.filter((call) =>
      String(call[0]).includes('JWT signing failed'),
    );
    expect(announcements).toHaveLength(1);
  });
});
