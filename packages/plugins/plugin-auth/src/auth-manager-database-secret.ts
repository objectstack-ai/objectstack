// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 7] The database and the secret `AuthManager` hands better-auth
 * when it builds the instance — the ObjectQL adapter factory (or, with no
 * data engine, the in-memory store keyed by model name), the auth secret
 * resolved once per manager, and the environment read behind it that refuses
 * to boot production without one — moved out of `auth-manager.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `AuthManager` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same adapter and created-user staging, the same
 * fallback store, the same secret precedence, the same production refusal and
 * development warning. (Since then that refusal's gate fails closed:
 * the fallback is admitted on a development boot or under `NODE_ENV=test`
 * only — see `generateSecret`.)
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), which `auth-manager-actor-guards.ts`,
 * `auth-manager-sign-in-lockout.ts`, `auth-manager-password-session-policy.ts`,
 * `auth-manager-database-hooks.ts`, `auth-manager-email-sms-delivery.ts` and
 * `auth-manager-plugin-assembly.ts` follow, applied per method. The class
 * keeps all three methods — the published `dist/*.d.ts` lists each one — and
 * each body is one literal of exactly the {@link DatabaseSecretHost} members
 * that method reads, plus a `.call`; `generateSecret` reads none, so its
 * method calls the function here directly. `createDatabaseConfig` is no
 * longer `async`: it returns the moved function's own promise, so a caller
 * awaits the same promise the body settles, with no extra wrapper.
 *
 * A method goes as a closure that calls it on the manager at call time, so a
 * test double or spy set on the manager is still the one a body reaches:
 * `stageUserCreatedInRequest`, which the adapter's created-record callback
 * runs inside every creating endpoint call, long after the factory was
 * built, and `generateSecret`. `config` goes as a GETTER: the class reassigns
 * it after construction (`setRuntimeBaseUrl` and `applyConfigPatch`), so it is
 * read off the manager when a body reads it, as before. `resolvedAuthSecret`
 * goes as a get/set pair, because `resolveAuthSecret` stores the secret on
 * the manager: every consumer still reads the one memo.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import { isDevelopmentBoot } from '@objectstack/core';
import { readEnvWithDeprecation } from '@objectstack/types';
import type { AuthManager } from './auth-manager.js';
import { createObjectQLAdapterFactory } from './objectql-adapter.js';

/**
 * The `AuthManager` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header for
 * why `config` is a getter and `resolvedAuthSecret` an accessor.
 */
export interface DatabaseSecretHost {
  readonly config: AuthManager['config'];
  resolvedAuthSecret: AuthManager['resolvedAuthSecret'];
  generateSecret: AuthManager['generateSecret'];
  stageUserCreatedInRequest: AuthManager['stageUserCreatedInRequest'];
}

/** The body of `AuthManager#createDatabaseConfig`; the method's docblock there is its contract. */
export async function createDatabaseConfig(this: Pick<DatabaseSecretHost, 'config' | 'stageUserCreatedInRequest'>): Promise<any> {
  // Use ObjectQL adapter factory if dataEngine is provided
  if (this.config.dataEngine) {
    // createObjectQLAdapterFactory returns an AdapterFactory
    // (options => DBAdapter) which better-auth invokes via getBaseAdapter().
    // The factory is created by better-auth's createAdapterFactory and
    // automatically applies modelName/fields transformations declared in
    // the betterAuth config above.
    return createObjectQLAdapterFactory(this.config.dataEngine, {
      // ADR-0093 D7 — the adapter is the one place that sees the created
      // user's id INSIDE the creating endpoint call; staging it here lets the
      // session seam recognise that user without reading the row back.
      onRecordCreated: async (objectName, row) => {
        if (objectName !== 'sys_user') return;
        const { tryGetCurrentAuthEndpointContext } = await import('@better-auth/core/context');
        this.stageUserCreatedInRequest(tryGetCurrentAuthEndpointContext(), row?.id);
      },
    });
  }

  // Fallback warning if no dataEngine is provided
  console.warn(
    '⚠️  WARNING: No dataEngine provided to AuthManager! ' +
    'Using in-memory storage. This is NOT suitable for production. ' +
    'Please provide a dataEngine instance (e.g., ObjectQL) in AuthManagerOptions.'
  );

  // ⛔ NOT `undefined`, and ⛔ do not "simplify" it back to that.
  //
  // Handing better-auth no `database` makes it build its own in-memory store
  // in `getBaseAdapter`, and that store is keyed by the schema KEY while
  // every read resolves by `modelName`. Re-measured 2026-10-21 for #25096 on
  // better-auth 1.7.12, unchanged since the 1.7.2 reading
  // (`db/adapter-base.mjs` builds the store by schema KEY;
  // `@better-auth/memory-adapter` throws on the lookup, naming the model):
  //
  //   getAuthTables(options) -> { oauthResource: { modelName: 'sys_oauth_resource' }, … }
  //   its memoryDB           -> { oauthResource: [] }            // keyed by KEY
  //   the adapter then asks  -> 'sys_oauth_resource'             // resolved by modelName
  //   => Error: Model sys_oauth_resource not found
  //
  // So on that path EVERY model this package renames is unreachable —
  // `user`/`sys_user` included. It stayed invisible for as long as nothing
  // touched a renamed model during boot; the RFC 8707 resource seed does,
  // from the oauth-provider plugin's `init`, where the throw surfaces as an
  // UNHANDLED REJECTION rather than a failed request.
  //
  // Keying the store by `modelName` is what the adapter actually reads, so
  // this fixes the dev/test fallback instead of working around it. Production
  // never reaches this branch — it returns the ObjectQL factory above.
  //
  // The import is dynamic on purpose (the rest of better-auth is loaded the
  // same way here); `createAuthInstance` awaits this method, and better-auth
  // then calls the returned factory SYNCHRONOUSLY, so the module has to be
  // resolved before we hand it over, not inside it.
  const [{ memoryAdapter }, { getAuthTables }] = await Promise.all([
    import('better-auth/adapters/memory'),
    import('@better-auth/core/db'),
  ]);
  return (options: any) => {
    const tables = getAuthTables(options) as Record<string, { modelName?: string }>;
    const db: Record<string, unknown[]> = {};
    for (const [key, table] of Object.entries(tables)) db[table?.modelName ?? key] = [];
    return memoryAdapter(db)(options);
  };
}

/** The body of `AuthManager#resolveAuthSecret`; the method's docblock there is its contract. */
export function resolveAuthSecret(this: Pick<DatabaseSecretHost, 'config' | 'generateSecret' | 'resolvedAuthSecret'>): string {
  if (!this.resolvedAuthSecret) {
    this.resolvedAuthSecret = this.config.secret || this.generateSecret();
  }
  return this.resolvedAuthSecret;
}

/** The body of `AuthManager#generateSecret`; the method's docblock there is its contract. */
export function generateSecret(): string {
  const envSecret = readEnvWithDeprecation('OS_AUTH_SECRET', ['AUTH_SECRET', 'BETTER_AUTH_SECRET'], { silent: true });
  if (envSecret) return envSecret;

  // No secret configured. Outside development this is FATAL: a predictable
  // `dev-secret-<timestamp>` makes session tokens forgeable. The fallback is
  // fail-CLOSED: it is admitted only on a development boot
  // (`isDevelopmentBoot`, `@objectstack/core` — `NODE_ENV` exactly
  // `development`) or under `NODE_ENV=test`, the pair core's own production
  // fuse reads (`isCloudManaged`). An unset, misspelled or custom `NODE_ENV`
  // is treated as a real deployment and refused, so an embedder who forgets
  // to export it gets a refusal to boot, never a guessable secret. `os serve`
  // and `os start` default an unset `NODE_ENV` to `production` (and `--dev`
  // sets `development`), so the CLI boots are unaffected.
  const developmentOrTest = isDevelopmentBoot(undefined) || process.env.NODE_ENV === 'test';
  if (!developmentOrTest) {
    throw new Error(
      '[auth] OS_AUTH_SECRET is required outside development but is not set ' +
      `(NODE_ENV is ${process.env.NODE_ENV === undefined ? 'unset' : JSON.stringify(process.env.NODE_ENV)}). ` +
      'Refusing to boot with a temporary development secret — session tokens ' +
      'would be forgeable. Set OS_AUTH_SECRET to a strong random value, or set ' +
      'NODE_ENV=development for a local development boot.'
    );
  }

  // Development / test only: fall back to an ephemeral secret, loudly.
  const fallbackSecret = 'dev-secret-' + Date.now();
  console.warn(
    '⚠️  WARNING: No OS_AUTH_SECRET environment variable set! ' +
    'Using a temporary development secret. ' +
    'This is NOT secure for production use. ' +
    'Please set OS_AUTH_SECRET in your environment variables.'
  );
  return fallbackSecret;
}
