// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17176] One boot builds ONE better-auth instance — and therefore seeds the
 * RFC 8707 `sys_oauth_resource` row once.
 *
 * ## The reported symptom, and what it actually is
 *
 * The card reports `Insert operation failed {object: sys_oauth_resource}` on a
 * boot, and reads it as a bootstrap row being "re-inserted on every boot".
 * Neither half of that survived measurement:
 *
 * - The insert is `@better-auth/oauth-provider`'s, from its own plugin `init`,
 *   and 1.7.2 already seeds check-then-insert: `findOne` by `identifier`, then
 *   `create` only on a miss, with the UNIQUE refusal caught and treated as a
 *   no-op ("one wins, the other catches the constraint error", its own
 *   docblock). `seedsOnce` below is the reading: a second init over the same
 *   store attempts zero inserts.
 * - What made it collide anyway is on OUR side. `AuthManager.getOrCreateAuth()`
 *   assigned `this.auth` only after `createAuthInstance()` resolved, so every
 *   caller arriving inside that window started its own build. Overlapping
 *   callers exist at boot: `auth-plugin.ts` dispatches
 *   `registerOidcDiscoveryRoutes()` with `void` from one `kernel:ready` hook
 *   and a later hook reads the instance for the account-issuer backfill. N
 *   instances run the vendor `init` N times; on a FRESH database all N miss on
 *   `findOne` together and all N insert, and the unique index refuses N - 1.
 *
 * ⇒ First boot of a fresh project only, which is exactly the shape measured
 * downstream (boot 1: one occurrence; boots 2-4: none) and exactly what
 * `packages/objectql/src/engine.ts` records as the cost of moving that log
 * line off `error`.
 *
 * ## Why these checks can fail
 *
 * `singleFlight` counts DISTINCT instance objects, and carries a firing
 * control: two separate managers must yield two distinct objects, so a green
 * "one instance" can never come from an identity comparison that cannot tell
 * objects apart. `seedsOnce` / `concurrentInitsCollide` boot the REAL provider
 * from the REAL options `AuthManager` produces, over one shared store whose
 * `identifier` column refuses a duplicate the way `sys_oauth_resource`'s
 * unique index does — and they are a differential: same store, same options,
 * one variable (whether the two inits overlap). If a provider bump ever made
 * the seed unconditional, `seedsOnce` reddens and this fix is no longer the
 * right one.
 *
 * ⛔ No log level is asserted here and none is changed by the fix: the write
 * doors' `warn` is a separate ruling, and the cure for a duplicated step is
 * not doing it twice.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AuthManager } from './auth-manager';
import { buildJwtPluginSchema } from './auth-schema-config.js';

// better-auth itself stays REAL: the defect is about how many instances
// `AuthManager` constructs, and a mocked constructor is exactly the thing that
// cannot tell one from three. Only the oauth provider is stubbed, so the
// manager's own build stays cheap; the authorization servers the seed checks
// run against are separate, REAL ones booted from `vi.importActual` below.
vi.mock('@better-auth/oauth-provider', () => ({
  oauthProvider: vi.fn((opts: any) => ({ id: 'oauth-provider', _opts: opts })),
}));

import { oauthProvider } from '@better-auth/oauth-provider';

const BASE_URL = 'https://acme.example.com';
const SECRET = 'test-secret-at-least-32-chars-long';
const UNIQUE_REFUSAL = 'UNIQUE constraint failed: sys_oauth_resource.identifier';

const ENV_KEYS = ['OS_MCP_SERVER_ENABLED', 'OS_OIDC_PROVIDER_ENABLED', 'OS_OIDC_DCR_ENABLED'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function newManager(): AuthManager {
  return new AuthManager({ secret: SECRET, baseUrl: BASE_URL });
}

describe('[#17176] AuthManager.getAuthInstance() is single-flight', () => {
  it('singleFlight: concurrent callers share one instance, separate managers do not', async () => {
    const manager = newManager();
    const concurrent = await Promise.all([
      manager.getAuthInstance(),
      manager.getAuthInstance(),
      manager.getAuthInstance(),
    ]);

    // The defect: each caller that arrived before `this.auth` was assigned
    // built its own better-auth instance, and every one of them ran the
    // vendor plugin `init` that seeds the resource row.
    expect(new Set(concurrent).size, 'three concurrent callers must share ONE better-auth instance').toBe(1);

    // Same manager, no overlap — the already-cached path.
    const cachedFirst = await manager.getAuthInstance();
    const cachedSecond = await manager.getAuthInstance();
    expect(new Set([...concurrent, cachedFirst, cachedSecond]).size).toBe(1);

    // ⭐ Firing control. Without it, "distinct count is 1" would also be the
    // reading if these objects compared equal for some reason unrelated to
    // the fix. Two managers are two instances, and the same comparison sees it.
    const other = await newManager().getAuthInstance();
    expect(
      new Set([cachedFirst, other]).size,
      'control: two separate managers must yield two DISTINCT instances',
    ).toBe(2);
  });

  it('applyConfigPatch discards an in-flight build instead of adopting it', async () => {
    const manager = newManager();
    const inFlight = manager.getAuthInstance();
    // Invalidate while the build is still running: the disowned build must not
    // install itself as the manager's instance.
    manager.applyConfigPatch({ baseUrl: 'https://patched.example.com' });
    const disowned = await inFlight;
    const rebuilt = await manager.getAuthInstance();
    expect(rebuilt).not.toBe(disowned);
    // ⭐ Control: the rebuilt instance is itself cached, so the assertion above
    // is about invalidation and not about the cache having been switched off.
    expect(await manager.getAuthInstance()).toBe(rebuilt);
  });
});

/**
 * The options `AuthManager` actually hands `oauthProvider()`. Read off the
 * capturing stub rather than hand-written, so the servers below are configured
 * exactly the way a deployment is.
 */
async function captureProviderOptions(): Promise<any> {
  process.env.OS_MCP_SERVER_ENABLED = 'true';
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await newManager().getAuthInstance();
  } finally {
    warnSpy.mockRestore();
  }
  const opts = (oauthProvider as any).mock.calls.at(-1)?.[0];
  expect(opts, 'AuthManager must register the oauthProvider plugin').toBeDefined();
  return opts;
}

/**
 * One store, shared by every authorization server a run boots — the way one
 * database is shared by every better-auth instance a single boot constructs.
 * `create` on the resource model is counted and refuses a duplicate
 * `identifier`, mirroring `sys_oauth_resource`'s unique index; that refusal is
 * the line the card reported.
 */
async function makeSharedStore() {
  const [{ betterAuth }, { memoryAdapter }, { jwt }, { oauthProvider: realOauthProvider }] = await Promise.all([
    vi.importActual<typeof import('better-auth')>('better-auth'),
    import('better-auth/adapters/memory'),
    import('better-auth/plugins'),
    vi.importActual<typeof import('@better-auth/oauth-provider')>('@better-auth/oauth-provider'),
  ]);

  const opts = await captureProviderOptions();
  const probePlugin = realOauthProvider(opts);
  const pluginSchema = (probePlugin as any).schema as Record<string, { modelName?: string }>;
  const resourceModel = pluginSchema?.oauthResource?.modelName ?? 'oauthResource';

  const db: Record<string, any[]> = {};
  for (const m of ['user', 'session', 'account', 'verification', 'jwks']) db[m] = [];
  for (const [model, def] of Object.entries(pluginSchema ?? {})) db[def.modelName ?? model] = [];

  // ⛔ `jwt()` must be given the SAME schema the platform gives it: 1.7.2's
  // `jwt()` MUTATES its shared default schema object, so a bare `jwt()` after
  // AuthManager has built one silently comes back mapped to `sys_jwks`.
  const jwtPlugin = jwt({ schema: buildJwtPluginSchema() as any });
  const jwksModel = (jwtPlugin as any).schema?.jwks?.modelName ?? 'jwks';
  db[jwksModel] = db[jwksModel] ?? [];

  const insertAttempts: string[] = [];
  const uniqueRefusals: string[] = [];
  // A unique index refuses at the moment of the insert, not after an async
  // round-trip: the first insert reserves the value and the database
  // serialises the second against it. Reading the row array back instead would
  // let two overlapping inserts both pass — modelling no constraint at all.
  const claimedIdentifiers = new Set<string>();

  const baseAdapter = memoryAdapter(db);
  const countingAdapter = (options: any) => {
    const adapter: any = (baseAdapter as any)(options);
    const create = adapter.create.bind(adapter);
    adapter.create = async (args: any) => {
      if (args?.model === resourceModel) {
        const identifier = args?.data?.identifier;
        insertAttempts.push(identifier);
        if (claimedIdentifiers.has(identifier)) {
          uniqueRefusals.push(identifier);
          throw new Error(UNIQUE_REFUSAL);
        }
        claimedIdentifiers.add(identifier);
      }
      return create(args);
    };
    return adapter;
  };

  const boot = () =>
    betterAuth({
      baseURL: BASE_URL,
      basePath: '/api/v1/auth',
      secret: SECRET,
      database: countingAdapter as any,
      emailAndPassword: { enabled: true },
      plugins: [jwtPlugin, realOauthProvider(opts) as any],
    });

  return {
    boot,
    resourceModel,
    insertAttempts,
    uniqueRefusals,
    rowCount: () => db[resourceModel]?.length ?? 0,
  };
}

describe('[#17176] @better-auth/oauth-provider 1.7.2 seeds sys_oauth_resource check-then-insert', () => {
  it('seedsOnce: a second init over the same store attempts NO insert', async () => {
    const store = await makeSharedStore();

    await store.boot().$context; // fresh store — the seed inserts
    expect(store.insertAttempts.length, 'the fresh store must be seeded exactly once').toBe(1);
    expect(store.rowCount()).toBe(1);

    await store.boot().$context; // warm store — findOne hits, nothing is inserted
    await store.boot().$context;

    // ⇒ "re-inserted on every boot" is FALSE of this provider: the second and
    // third inits attempt zero inserts, so the refusal cannot come from a boot
    // that merely repeats an earlier boot's work.
    expect(store.insertAttempts.length, 'warm inits must attempt no further insert').toBe(1);
    expect(store.uniqueRefusals, 'a warm init never reaches the unique index').toEqual([]);
    expect(store.rowCount()).toBe(1);
  });

  it('concurrentInitsCollide: overlapping inits on a FRESH store produce the reported refusal', async () => {
    const store = await makeSharedStore();

    // Two instances built in one process, the way an un-serialised
    // `getOrCreateAuth()` built them. Both `findOne` miss before either
    // `create` lands.
    const [first, second] = [store.boot(), store.boot()];
    await Promise.all([first.$context, second.$context]);

    // The differential against `seedsOnce`: same store, same options, the only
    // variable is whether the inits overlap.
    expect(store.insertAttempts.length, 'both overlapping inits attempt the insert').toBe(2);
    expect(store.uniqueRefusals.length, 'the unique index refuses exactly one of them').toBe(1);
    // The refusal is a no-op for the data: the row is present exactly once,
    // which is why nothing downstream breaks and only the log line shows it.
    expect(store.rowCount()).toBe(1);
  });
});
