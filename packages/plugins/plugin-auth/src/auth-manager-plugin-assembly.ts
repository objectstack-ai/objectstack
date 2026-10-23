// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 6] The plugin assembly helpers of `AuthManager` — the isolation
 * that keeps one optional better-auth plugin's construction failure from
 * taking down core auth, the construction of better-auth's `jwt` plugin with a
 * signing algorithm this host can use and a non-fatal `/get-session` header
 * hook, and the once-only report of a JWT signing failure that hook catches —
 * moved out of `auth-manager.ts` whole.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `AuthManager` method of the same name as it stood, re-indented one level
 * and otherwise unedited: the same plugins pushed or skipped, the same
 * degraded-feature records, the same algorithm probe and keyring read, the
 * same log lines at the same levels.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), which `auth-manager-actor-guards.ts`,
 * `auth-manager-sign-in-lockout.ts`, `auth-manager-password-session-policy.ts`,
 * `auth-manager-database-hooks.ts` and `auth-manager-email-sms-delivery.ts`
 * follow, applied per method. The class keeps all three methods — the
 * published `dist/*.d.ts` lists each one — and each body is one literal of
 * exactly the {@link PluginAssemblyHost} members that method reads, plus a
 * `.call`. The two `async` methods are no longer `async`: each returns the
 * moved function's own promise, so a caller awaits the same promise the body
 * settles, with no extra wrapper.
 *
 * `reportJwtSigningFailure` goes as a closure that calls it on the manager at
 * call time, so a test double or spy set on the manager is still the one the
 * `/get-session` guard reaches; that guard runs at request time, long after
 * `buildJwtPlugin` returned. `config` and `degradedFeatures` go as GETTERS:
 * the class reassigns `config` after construction (`setRuntimeBaseUrl` and
 * `applyConfigPatch`), so each is read off the manager when a body reads it,
 * as before. `ed25519ProbeResult` and `jwtSigningFailureReported` go as
 * get/set pairs, because the bodies store to both on the manager: the Ed25519
 * probe still runs once per manager, and a signing failure is still announced
 * once per plugin-list build, which resets the flag.
 *
 * Nothing re-exports this module, so the published surface does not move.
 */

import type { AuthManager } from './auth-manager.js';
import { buildJwtPluginSchema } from './auth-schema-config.js';
import {
  createHostUsableJwksReader,
  probeEd25519Support,
  protectGetSessionJwtHook,
  resolveJwtSigningAlgorithm,
} from './jwt-key-algorithm.js';
import { createSigningKeyReader } from './signing-key-read-cache.js';

/**
 * The `AuthManager` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header for
 * why `config` and `degradedFeatures` are getters and `ed25519ProbeResult` and
 * `jwtSigningFailureReported` accessors.
 */
export interface PluginAssemblyHost {
  readonly config: AuthManager['config'];
  readonly degradedFeatures: AuthManager['degradedFeatures'];
  ed25519ProbeResult: AuthManager['ed25519ProbeResult'];
  jwtSigningFailureReported: AuthManager['jwtSigningFailureReported'];
  reportJwtSigningFailure: AuthManager['reportJwtSigningFailure'];
}

/** The body of `AuthManager#addOptionalPlugin`; the method's docblock there is its contract. */
export async function addOptionalPlugin(
  this: Pick<PluginAssemblyHost, 'degradedFeatures'>,
  plugins: any[],
  feature: string,
  build: () => Promise<any | any[]>,
): Promise<void> {
  try {
    const built = await build();
    for (const p of Array.isArray(built) ? built : [built]) plugins.push(p);
  } catch (err: any) {
    const message = err?.message ?? String(err);
    this.degradedFeatures.set(feature, message);
    console.error(
      `[AuthManager] Optional auth feature "${feature}" failed to initialize and is DISABLED ` +
      `for this process — its endpoints will 404. Core email/password + session auth is unaffected. ` +
      `Fix the underlying error (often a better-auth version mismatch) and restart. Cause: ${message}`,
      err,
    );
  }
}

/** The body of `AuthManager#buildJwtPlugin`; the method's docblock there is its contract. */
export async function buildJwtPlugin(this: Pick<PluginAssemblyHost, 'config' | 'ed25519ProbeResult' | 'reportJwtSigningFailure'>, jwt: (options: any) => any): Promise<any> {
  if (!this.ed25519ProbeResult) this.ed25519ProbeResult = probeEd25519Support();
  const { keyPairConfig, ed25519Supported } = await resolveJwtSigningAlgorithm(
    () => this.ed25519ProbeResult!,
  );

  if (!ed25519Supported) {
    // Functional, not durability: the deployment is fully operational on
    // ES256. Worth one line because it changes what /jwks publishes and what
    // `alg` issued tokens carry, which an operator debugging a relying party
    // otherwise cannot correlate to anything.
    console.warn(
      `[AuthManager] This host's WebCrypto has no Ed25519 (crypto.subtle.generateKey({name:'Ed25519'}) fails), ` +
        `so JWTs are signed with ${keyPairConfig.alg} instead of better-auth's default EdDSA. ` +
        `Any existing EdDSA key in sys_jwks is hidden from the JWKS on this host — it cannot be imported here — ` +
        `and a fresh ${keyPairConfig.alg} key is minted on first use. The rows are not deleted.`,
    );
  }

  const jwtPlugin = jwt({
    schema: buildJwtPluginSchema(),
    jwks: { keyPairConfig },
    // [#24061] The keyring read goes through `createSigningKeyReader` on
    // every host: it holds the rows across requests only while no
    // `sys_jwks` write has passed this engine's middleware since they were
    // read, and never past `SIGNING_KEY_CACHE_TTL_MS` — both halves of the
    // cross-request caching rule (see `signing-key-read-cache.ts`). A miss
    // reads exactly what it read before: better-auth's stock read, or, on a
    // host without Ed25519, the host-usable keyring that hides keys this
    // host cannot import (#3585).
    adapter: {
      getJwks: createSigningKeyReader({
        engine: this.config.dataEngine,
        read: ed25519Supported ? undefined : createHostUsableJwksReader(),
      }),
    },
  });

  const protectedHook = protectGetSessionJwtHook(jwtPlugin, (error) =>
    this.reportJwtSigningFailure(error, keyPairConfig.alg),
  );
  if (!protectedHook) {
    // The guard could not attach — better-auth moved or renamed the hook.
    // Say so rather than shipping a build that looks protected and is not.
    console.error(
      '[AuthManager] Could not attach the JWT signing guard to better-auth\'s /get-session hook ' +
        '(its `hooks.after` shape changed). A JWT signing failure will now 500 every /get-session ' +
        'instead of degrading to a missing set-auth-jwt header, and every in-process session read ' +
        'signs a JWT it discards (two sys_jwks reads per authenticated request). Re-check ' +
        'the better-auth version in better-auth-schema-parity.test.ts.',
    );
  }

  return jwtPlugin;
}

/** The body of `AuthManager#reportJwtSigningFailure`; the method's docblock there is its contract. */
export function reportJwtSigningFailure(this: Pick<PluginAssemblyHost, 'degradedFeatures' | 'jwtSigningFailureReported'>, error: unknown, alg: string): void {
  const message = (error as any)?.message ?? String(error);
  this.degradedFeatures.set('jwtSigning', message);
  if (this.jwtSigningFailureReported) return;
  this.jwtSigningFailureReported = true;
  console.error(
    `[AuthManager] JWT signing failed with alg "${alg}", so /get-session responses carry no ` +
      `set-auth-jwt header and OIDC/MCP token issuance will not work. The session itself is valid — ` +
      `sign-in and cookie auth are unaffected. Common causes: this host's WebCrypto cannot use the ` +
      `algorithm of the key in sys_jwks, or OS_AUTH_SECRET changed since the key was encrypted. ` +
      `Set OS_OIDC_PROVIDER_ENABLED=false if this deployment does not need to act as an IdP. ` +
      `Cause: ${message}`,
    error,
  );
}
