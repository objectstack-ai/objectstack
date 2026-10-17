// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24186] The MCP access-token verifier's key set follows the cross-request
 * caching rule: it is read through the signer's own keyring reader, so a
 * keyring write this process observes reaches the next verification, the
 * reader's TTL bounds a write it cannot see, and a token signed by a key the
 * set does not carry earns one bounded fresh read before it is refused.
 *
 * ## The composition
 *
 * A real `AuthManager` on a real `ObjectQL` over `@objectstack/driver-sql` +
 * better-sqlite3, with this plugin's identity objects. Its embedded
 * authorization server is on (a loopback origin, the MCP surface on), so the
 * jwt plugin and its keyring reader are the ones a deployment runs. Tokens are
 * signed by that jwt plugin's own `signJWT` with the stored key, for this
 * deployment's issuer and MCP audience.
 *
 * ## What is pinned — one consequence per case
 *
 *  1. A signing key removed from the keyring stops verifying the tokens it
 *     signed on the very next call, with no clock movement.
 *  2. A key that joins the keyring after the verifier's last read verifies on
 *     the first call: through the write seam when the write passes this
 *     process's engine, and through the one bounded fresh read when it does not
 *     (written below the engine here, as a write on another node would be).
 *  3. A burst of tokens naming keys the keyring does not carry costs at most
 *     one keyring read inside the floor interval, however the burst is spread.
 *
 * The bound's own edges — a read in flight is joined, the floor re-arms
 * exactly at its interval, a failed read still spends it — are pinned on a
 * counting key-set double at the foot of the file.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AuthManager } from './auth-manager.js';
import { authIdentityObjects } from './manifest.js';
import { retireHeldKeyrings, UNKNOWN_SIGNING_KEY_REREAD_FLOOR_MS } from './signing-key-read-cache.js';

const BASE = 'http://localhost:3000';
const SECRET = 'test-secret-at-least-32-chars-long-24186';
const SYS = { context: { isSystem: true } } as const;
const USER = 'usr_24186';
const CLIENT = 'client_24186';

const ENV_KEYS = ['OS_MCP_SERVER_ENABLED', 'OS_OIDC_PROVIDER_ENABLED'] as const;
const savedEnv: Record<string, string | undefined> = {};
const engines: ObjectQL[] = [];

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.OS_MCP_SERVER_ENABLED = 'true';
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  while (engines.length) {
    try {
      await (engines.pop() as unknown as { destroy?(): Promise<void> })?.destroy?.();
    } catch {
      /* noop */
    }
  }
});

/** The `kid` a compact JWS names. */
const kidOf = (jwt: string): string =>
  JSON.parse(Buffer.from(jwt.split('.')[0]!, 'base64url').toString('utf8')).kid;

/** A real AuthManager on a real engine, its keyring reads counted below the engine. */
async function verifierRig() {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const engine = new ObjectQL();
  engines.push(engine);
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine.registerDriver(driver, true);
  await engine.init();
  for (const object of authIdentityObjects) {
    engine.registry.registerObject(object as never, '@objectstack/plugin-auth');
  }
  await engine.syncSchemas();
  vi.spyOn((engine as any).logger, 'info').mockImplementation(() => undefined);

  // Every driver read of the keyring table, whichever verb carries it.
  let keyringDriverReads = 0;
  for (const verb of ['find', 'findOne'] as const) {
    const original = (driver as any)[verb].bind(driver);
    (driver as any)[verb] = async (object: string, ...rest: unknown[]) => {
      if (object === 'sys_jwks') keyringDriverReads += 1;
      return original(object, ...rest);
    };
  }

  const manager = new AuthManager({ secret: SECRET, baseUrl: BASE, dataEngine: engine as never } as never);
  const api: any = await manager.getApi();

  /** A token for this deployment's MCP resource, signed by the jwt plugin with the stored key. */
  const mint = async (): Promise<string> =>
    (await api.signJWT({
      body: {
        payload: {
          sub: USER,
          azp: CLIENT,
          scope: 'data:read',
          iss: manager.getAuthIssuer(),
          aud: manager.getMcpResourceUrl(),
        },
      },
    })).token;

  /** A token for the same issuer and audience, signed by `privateKey` under `kid`. */
  const signWith = (privateKey: CryptoKey, kid: string): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ scope: 'data:read', azp: CLIENT })
      .setProtectedHeader({ alg: 'EdDSA', kid })
      .setIssuer(manager.getAuthIssuer())
      .setAudience(manager.getMcpResourceUrl())
      .setSubject(USER)
      .setIssuedAt(now)
      .setExpirationTime(now + 900)
      .sign(privateKey);
  };

  /** What ONE keyring read costs at the driver on this engine — the unit the burst is counted in. */
  const oneKeyringRead = async (): Promise<number> => {
    const before = keyringDriverReads;
    retireHeldKeyrings(engine);
    await api.getJwks();
    return keyringDriverReads - before;
  };

  return { engine, driver, manager, api, mint, signWith, oneKeyringRead, keyringReads: () => keyringDriverReads };
}

describe('[#24186] the MCP verifier\'s key set follows the keyring, on a real engine', () => {
  it('a signing key removed from the keyring stops verifying its tokens on the next call, with no clock movement', async () => {
    const { engine, manager, mint } = await verifierRig();
    const token = await mint();
    expect(await manager.verifyMcpAccessToken(token)).toMatchObject({ userId: USER, clientId: CLIENT });

    await engine.delete('sys_jwks', { where: { id: kidOf(token) }, ...SYS });

    expect(await manager.verifyMcpAccessToken(token)).toBeNull();
    // The verifier itself is intact: a token from the key that replaced it verifies.
    const next = await mint();
    expect(kidOf(next)).not.toBe(kidOf(token));
    expect(await manager.verifyMcpAccessToken(next)).toMatchObject({ userId: USER });
  }, 60_000);

  it('a key that joins the keyring through this engine after the last read verifies on the first call', async () => {
    const { engine, manager, mint } = await verifierRig();
    const first = await mint();
    expect(await manager.verifyMcpAccessToken(first)).toMatchObject({ userId: USER });

    // The stored key expires a moment ago, so the next signature mints its successor.
    await engine.update('sys_jwks', { id: kidOf(first), expires_at: new Date(Date.now() - 1_000).toISOString() }, SYS);
    const second = await mint();
    expect(kidOf(second)).not.toBe(kidOf(first));

    expect(await manager.verifyMcpAccessToken(second)).toMatchObject({ userId: USER });
  }, 60_000);

  it('a key that joins the keyring where this engine cannot see it verifies on the first call, through one fresh read', async () => {
    const { driver, manager, mint, signWith, oneKeyringRead, keyringReads } = await verifierRig();
    expect(await manager.verifyMcpAccessToken(await mint())).toMatchObject({ userId: USER });
    const unit = await oneKeyringRead();
    expect(unit, 'the instrument sees a keyring read').toBeGreaterThan(0);

    // A key row written BELOW the engine, as another node's write would land:
    // nothing in this process observes it. Its private half is never read here.
    const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
    const kid = 'key_24186_unobserved';
    await driver.create('sys_jwks', {
      id: kid,
      public_key: JSON.stringify(await exportJWK(pair.publicKey)),
      private_key: '{}',
      alg: 'EdDSA',
      crv: 'Ed25519',
      created_at: new Date().toISOString(),
    });

    const before = keyringReads();
    expect(await manager.verifyMcpAccessToken(await signWith(pair.privateKey as CryptoKey, kid)))
      .toMatchObject({ userId: USER, clientId: CLIENT });
    expect(keyringReads() - before, 'the first call paid exactly one fresh keyring read').toBe(unit);
  }, 60_000);

  it('a burst of tokens naming keys the keyring does not carry costs at most one keyring read inside the floor interval', async () => {
    const { manager, mint, signWith, oneKeyringRead, keyringReads } = await verifierRig();
    expect(await manager.verifyMcpAccessToken(await mint())).toMatchObject({ userId: USER });
    const unit = await oneKeyringRead();
    expect(unit, 'the instrument sees a keyring read').toBeGreaterThan(0);

    const stranger = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const unknown = (i: number) => signWith(stranger.privateKey as CryptoKey, `key_24186_absent_${i}`);

    const before = keyringReads();
    // Concurrent, then one after another: neither shape buys a second read.
    const concurrent = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => manager.verifyMcpAccessToken(await unknown(i))),
    );
    const sequential: unknown[] = [];
    for (let i = 20; i < 40; i += 1) sequential.push(await manager.verifyMcpAccessToken(await unknown(i)));

    expect([...concurrent, ...sequential].every((r) => r === null)).toBe(true);
    expect(keyringReads() - before).toBe(unit);
    // And a token the keyring does carry still verifies from the held set, for free.
    const known = await mint();
    const beforeKnown = keyringReads();
    expect(await manager.verifyMcpAccessToken(known)).toMatchObject({ userId: USER });
    expect(keyringReads() - beforeKnown).toBe(0);
  }, 60_000);
});

describe('[#24186] the bound on the fresh read an unknown key earns', () => {
  const ISSUER = 'https://acme.example.com/api/v1/auth';
  const AUDIENCE = 'https://acme.example.com/api/v1/mcp';

  /**
   * A manager whose key set is a counting double: every `getJwks()` call is
   * one read, numbered from 1, and `answer(n)` decides what read `n` returns
   * (or throws). With no reader behind it, every call is a read through.
   */
  async function countingManager() {
    const known = await generateKeyPair('RS256');
    const rotated = await generateKeyPair('RS256');
    const before = { keys: [{ ...(await exportJWK(known.publicKey)), alg: 'RS256', kid: 'known' }] };
    const after = { keys: [...before.keys, { ...(await exportJWK(rotated.publicKey)), alg: 'RS256', kid: 'rotated' }] };
    const state = { reads: 0, answer: (_n: number): Promise<unknown> | unknown => before };
    const manager = new AuthManager({ secret: SECRET, baseUrl: 'https://acme.example.com' });
    vi.spyOn(manager, 'getApi').mockResolvedValue({
      getJwks: async () => {
        state.reads += 1;
        return state.answer(state.reads);
      },
    } as any);
    const token = (privateKey: CryptoKey, kid: string) => {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({ scope: 'data:read', azp: CLIENT })
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject(USER)
        .setIssuedAt(now)
        .setExpirationTime(now + 900)
        .sign(privateKey);
    };
    return {
      manager,
      state,
      after,
      rotatedToken: () => token(rotated.privateKey as CryptoKey, 'rotated'),
      absentToken: (kid: string) => token(rotated.privateKey as CryptoKey, kid),
    };
  }

  it('a token arriving while the fresh read is in flight shares it', async () => {
    const { manager, state, after, rotatedToken } = await countingManager();
    let open!: () => void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    // Read 2 is the fresh read: it answers the rotated set, once the gate opens.
    // Every other read answers the set from before the rotation.
    const original = state.answer;
    state.answer = async (n) => (n === 2 ? (await gate, after) : original(n));

    const first = manager.verifyMcpAccessToken(await rotatedToken());
    await vi.waitFor(() => expect(state.reads).toBe(2));
    const second = manager.verifyMcpAccessToken(await rotatedToken());
    await vi.waitFor(() => expect(state.reads).toBe(3));
    // Let the second call reach the fresh read before it settles.
    await new Promise((resolve) => setTimeout(resolve, 25));
    open();

    // The second call verifies only by joining read 2: a read of its own (read
    // 4) would answer the old set, and a refusal by the floor would be `null`.
    expect(await first).toMatchObject({ userId: USER });
    expect(await second).toMatchObject({ userId: USER });
    expect(state.reads).toBe(3);
  });

  it('the floor re-arms exactly at its interval, and not a millisecond before', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T12:00:00Z'));
    const { manager, state, absentToken } = await countingManager();

    expect(await manager.verifyMcpAccessToken(await absentToken('absent_1'))).toBeNull();
    expect(state.reads).toBe(2); // the set, and the one fresh read

    vi.setSystemTime(Date.now() + UNKNOWN_SIGNING_KEY_REREAD_FLOOR_MS - 1);
    expect(await manager.verifyMcpAccessToken(await absentToken('absent_2'))).toBeNull();
    expect(state.reads).toBe(3); // the set only: still inside the floor

    vi.setSystemTime(Date.now() + 1);
    expect(await manager.verifyMcpAccessToken(await absentToken('absent_3'))).toBeNull();
    expect(state.reads).toBe(5); // the set, and a fresh read again
  });

  it('a fresh read that fails still spends the interval', async () => {
    const { manager, state, absentToken } = await countingManager();
    const original = state.answer;
    state.answer = (n) => {
      if (n === 2) throw new Error('keyring unreadable');
      return original(n);
    };

    expect(await manager.verifyMcpAccessToken(await absentToken('absent_x'))).toBeNull();
    expect(await manager.verifyMcpAccessToken(await absentToken('absent_y'))).toBeNull();
    expect(state.reads).toBe(3); // the set and the failed fresh read, then the set alone
  });
});
