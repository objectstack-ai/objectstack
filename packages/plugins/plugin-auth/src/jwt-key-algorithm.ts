// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Host-aware signing-algorithm selection for better-auth's `jwt` plugin (#3585).
 *
 * ## The failure this exists to prevent
 *
 * better-auth's `jwt` plugin defaults to **EdDSA / Ed25519** — `utils.mjs`
 * reads `options?.jwks?.keyPairConfig ?? { alg: 'EdDSA', crv: 'Ed25519' }` and
 * hands it to jose's `generateKeyPair`, which resolves `EdDSA` to the WebCrypto
 * algorithm `{ name: 'Ed25519' }` (see jose `lib/jws_algorithms.js`). Hosts
 * whose WebCrypto lacks Ed25519 — StackBlitz/WebContainer is the reported one —
 * throw `OperationError` out of `crypto.subtle.generateKey`.
 *
 * That would be a contained problem if it only broke the IdP, but the plugin
 * installs an `after` hook on **`/get-session`** that signs a `set-auth-jwt`
 * header for *every* session. So on such a host the first authenticated request
 * after sign-in 500s, and the OIDC provider is on by default whenever the MCP
 * server is (`resolveOidcProviderEnabled` → `isMcpServerEnabled()`). An app that
 * never asked for OIDC gets an unusable login.
 *
 * ## Why a capability probe rather than a host sniff
 *
 * `isWebContainerRuntime()` (auth-manager.ts) answers "which host is this",
 * which is a proxy for the question that actually matters — "can this host do
 * Ed25519". The proxy is wrong on both sides: it misses every *other* runtime
 * without Ed25519, and it would downgrade a WebContainer that gained support.
 * {@link probeEd25519Support} asks WebCrypto the real question, using the exact
 * algorithm descriptor jose uses, so the answer cannot drift from the operation
 * it predicts.
 *
 * ## The part that bites existing deployments
 *
 * Picking ES256 for *new* keys is not sufficient on its own. better-auth's
 * `resolveSigningKey` (jwt/sign.mjs) selects an existing key like this:
 *
 * ```js
 * const primaryAlg = options?.jwks?.keyPairConfig?.alg ?? 'EdDSA';
 * key = await adapter.getLatestKeyByAlg(ctx, primaryAlg) ?? await adapter.getLatestKey(ctx);
 * ```
 *
 * The second half is an **any-algorithm** fallback. A deployment that already
 * minted an EdDSA key into `sys_jwks` — then moved to a host without Ed25519 —
 * finds no ES256 key, falls back to the stored EdDSA row, and dies one line
 * later in `importJWK(privateWebKey, 'EdDSA')`. Configuring `keyPairConfig`
 * alone therefore leaves the *upgrade* path broken while fixing the fresh one.
 *
 * {@link createHostUsableJwksReader} closes that by installing better-auth's
 * documented `adapter.getJwks` keyring seam and hiding keys this host cannot
 * use. `getLatestKey()` then also returns nothing, `resolveSigningKey` mints a
 * fresh ES256 key, and the deployment converges on a working state instead of
 * sitting broken. The EdDSA row is never deleted — move back to a host with
 * Ed25519 and it is simply visible again.
 *
 * The reader is installed **only when the host lacks Ed25519**, so every normal
 * deployment runs better-auth's stock code path with no ObjectStack code in it.
 *
 * @see https://github.com/objectstack-ai/objectstack/issues/3585
 */

/**
 * better-auth's own default. Kept explicit rather than inherited so the
 * algorithm this deployment signs with is visible at the call site instead of
 * hidden in a dependency's `??` default.
 */
export const ED25519_KEY_PAIR_CONFIG = { alg: 'EdDSA', crv: 'Ed25519' } as const;

/**
 * Fallback for hosts without Ed25519. ES256 (ECDSA P-256 + SHA-256) is the
 * other algorithm every OIDC relying party is required to support (OpenID
 * Connect Core §15.1 lists RS256 as mandatory and ES256 as the standard EC
 * choice), and its WebCrypto primitives (`ECDSA` / `P-256`) predate Ed25519 in
 * every runtime we have seen. RS256 would also work but costs a 2048-bit RSA
 * keygen on a host that is, by construction, already slow.
 */
export const ES256_KEY_PAIR_CONFIG = { alg: 'ES256' } as const;

export type JwtKeyPairConfig =
  | typeof ED25519_KEY_PAIR_CONFIG
  | typeof ES256_KEY_PAIR_CONFIG;

/**
 * The WebCrypto algorithm descriptor jose uses for `EdDSA`.
 *
 * Single-sourced here because the probe is only meaningful if it asks for the
 * *same* thing the later `generateKeyPair` / `importJWK` will ask for — a probe
 * that tested a different descriptor could report success and still let signing
 * throw.
 */
const ED25519_SUBTLE_ALGORITHM = { name: 'Ed25519' } as const;

/** Minimal shape of a persisted `sys_jwks` row, as better-auth hands it back. */
export interface StoredJwk {
  readonly id?: string;
  readonly alg?: string | null;
  readonly crv?: string | null;
  readonly publicKey?: string | null;
  readonly privateKey?: string | null;
  readonly createdAt?: Date;
  readonly expiresAt?: Date | null;
}

/**
 * Ask WebCrypto whether this host can actually generate an Ed25519 key pair.
 *
 * Returns `false` — never throws — for every way a host can lack the
 * capability: no `crypto.subtle` at all, a `generateKey` that rejects
 * (`OperationError` on WebContainer, `NotSupportedError` elsewhere), or one
 * that throws synchronously.
 *
 * @param subtle - Injectable for tests. Omitted (or explicitly `undefined`)
 *   means "ask this host"; `null` models a host with no WebCrypto at all.
 */
export async function probeEd25519Support(
  subtle: Pick<SubtleCrypto, 'generateKey'> | null | undefined = (globalThis as any)?.crypto
    ?.subtle,
): Promise<boolean> {
  if (typeof subtle?.generateKey !== 'function') return false;
  try {
    // `extractable: true` matches better-auth's generateExportedKeyPair — it
    // exports the pair to JWK immediately after minting, and a host could in
    // principle allow non-extractable keys only.
    await subtle.generateKey(ED25519_SUBTLE_ALGORITHM as any, true, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
}

/** Outcome of the startup probe. */
export interface JwtSigningAlgorithmDecision {
  /** Pass verbatim as better-auth's `jwks.keyPairConfig`. */
  readonly keyPairConfig: JwtKeyPairConfig;
  /** `false` when this host cannot do Ed25519 and the fallback was taken. */
  readonly ed25519Supported: boolean;
}

/**
 * Decide which key-pair algorithm this host should sign JWTs with.
 *
 * @param probe - Injectable capability probe; defaults to
 *   {@link probeEd25519Support}. Tests stub this to simulate a host without
 *   Ed25519 without needing WebContainer.
 */
export async function resolveJwtSigningAlgorithm(
  probe: () => Promise<boolean> = probeEd25519Support,
): Promise<JwtSigningAlgorithmDecision> {
  const ed25519Supported = await probe();
  return {
    ed25519Supported,
    keyPairConfig: ed25519Supported ? ED25519_KEY_PAIR_CONFIG : ES256_KEY_PAIR_CONFIG,
  };
}

/**
 * Is this stored key an Ed25519 key?
 *
 * Three sources, in order of trust, because rows written at different times
 * carry different amounts of metadata:
 *
 * 1. `alg === 'EdDSA'` — written by better-auth 1.7+.
 * 2. `crv === 'Ed25519'` — likewise.
 * 3. the serialized public JWK's own `kty`/`crv` — the only signal on **legacy
 *    rows minted before the `alg`/`crv` columns existed**, which is not a
 *    theoretical case: `getLatestKeyByAlg` treats `alg == null` as "the
 *    configured default", so after the ES256 fallback a legacy *EdDSA* row
 *    would otherwise be selected *as if it were ES256* and blow up in
 *    `importJWK`. Reading the key material is what makes the answer true
 *    rather than merely well-typed.
 */
export function isEd25519Jwk(key: StoredJwk | null | undefined): boolean {
  if (!key) return false;
  if (key.alg === 'EdDSA') return true;
  if (key.crv === 'Ed25519') return true;
  // Legacy row: alg/crv unset. Fall back to the key material itself.
  if (key.alg == null && key.crv == null && typeof key.publicKey === 'string') {
    try {
      const jwk = JSON.parse(key.publicKey) as { kty?: unknown; crv?: unknown };
      return jwk?.kty === 'OKP' && jwk?.crv === 'Ed25519';
    } catch {
      // Unparseable key material is not evidence of Ed25519; leave it visible
      // and let better-auth fail on it loudly rather than silently hiding a
      // key for the wrong reason.
      return false;
    }
  }
  return false;
}

/**
 * Drop keys this host cannot import, sign with, or verify.
 *
 * Identity when `ed25519Supported` — the filter exists only for the degraded
 * host, and must be provably inert everywhere else.
 */
export function selectHostUsableJwks<T extends StoredJwk>(
  keys: readonly T[],
  ed25519Supported: boolean,
): T[] {
  if (ed25519Supported) return [...keys];
  return keys.filter((key) => !isEd25519Jwk(key));
}

/**
 * Build the `jwt({ adapter: { getJwks } })` reader for a host without Ed25519.
 *
 * better-auth routes *all four* of its keyring reads (`getAllKeys`,
 * `getLatestKey`, `getLatestKeyByAlg`, `getKeyById`) through this one hook when
 * it is present, which is what makes it sufficient: there is no read path left
 * that can hand `resolveSigningKey` a key this host cannot import.
 *
 * It also means the published `/api/v1/auth/jwks` document loses the hidden
 * keys. That is the honest answer rather than a side effect — this host is the
 * issuer, it cannot sign or verify with those keys, and advertising them would
 * be a machine-readable surface claiming a capability the runtime does not have
 * (AGENTS.md "Machine-readable surfaces must not lie").
 *
 * @param onHidden - Called once per read that actually hid something, with the
 *   count. Used to emit exactly one operator-facing line.
 */
export function createHostUsableJwksReader(
  onHidden?: (hiddenCount: number) => void,
): (ctx: any) => Promise<StoredJwk[]> {
  return async (ctx: any): Promise<StoredJwk[]> => {
    // Same read better-auth's default adapter performs — the model name is
    // mapped to `sys_jwks` by buildJwtPluginSchema(), so this stays a single
    // source of truth for the table.
    const all: StoredJwk[] = (await ctx?.context?.adapter?.findMany({ model: 'jwks' })) ?? [];
    const usable = selectHostUsableJwks(all, false);
    if (usable.length !== all.length) onHidden?.(all.length - usable.length);
    return usable;
  };
}

/**
 * Shape better-auth's jwt plugin uses for its `/get-session` `after` hook.
 * Narrow on purpose: {@link protectGetSessionJwtHook} must be able to tell
 * "the hook moved in a better-auth upgrade" from "the hook is fine".
 */
interface AfterHookEntry {
  matcher?: (context: { path?: string }) => boolean;
  handler?: ((ctx: unknown) => unknown) & Record<string, unknown>;
}

/**
 * Make a JWT signing failure degrade the **header**, not the **session**.
 *
 * better-auth's hook is `await getJwtToken(ctx, options)` with no `catch`, so
 * any signing error — an algorithm this host cannot use, a key encrypted under
 * a rotated secret, a `sys_jwks` write that fails — turns every
 * `/get-session` into a 500 and locks the user out of an otherwise healthy app.
 * Signing the `set-auth-jwt` header is an *optional* enrichment; the session it
 * describes is already valid. So the failure is downgraded to "no header", in
 * the same spirit as `AuthManager.addOptionalPlugin`: one optional federation
 * feature must never take down core session auth.
 *
 * Returns `false` when the hook could not be found, so the caller can say so
 * out loud instead of silently shipping an unprotected build — a guard that
 * quietly stops guarding is worse than no guard (AGENTS.md "Absence must be
 * loud"). `better-auth-schema-parity.test.ts` pins the shape so a better-auth
 * upgrade that moves the hook fails a test rather than a production login.
 *
 * @param onFailure - Invoked with the signing error. Called on every failure;
 *   the caller is responsible for logging it only once.
 */
export function protectGetSessionJwtHook(
  plugin: { hooks?: { after?: AfterHookEntry[] } },
  onFailure: (error: unknown) => void,
): boolean {
  const after = plugin?.hooks?.after;
  if (!Array.isArray(after)) return false;

  let wrapped = 0;
  for (const entry of after) {
    const original = entry?.handler;
    if (typeof original !== 'function') continue;
    if (entry.matcher && !entry.matcher({ path: '/get-session' })) continue;

    const guarded = async (ctx: any): Promise<unknown> => {
      try {
        return await original(ctx);
      } catch (error) {
        onFailure(error);
        // Return what a no-op run of this hook returns, NOT a bare `undefined`.
        // better-auth's `runAfterHooks` (api/dispatch.mjs) does an unguarded
        // `result.headers` read on every hook result, so swallowing the error
        // and returning nothing just moves the 500 one frame up. better-call
        // shapes a middleware's return by the caller's `returnHeaders` flag
        // (`middleware.mjs`), so mirror that: `{ headers, response }` when the
        // caller asked for headers, plain `undefined` otherwise.
        //
        // `headers: undefined` is explicitly safe — `mergeResponseHeaders`
        // early-returns on falsy — and `response: undefined` leaves
        // `context.returned` (the real session payload) untouched, which is
        // the entire point: the session survives, only the header is missing.
        return ctx?.returnHeaders ? { headers: undefined, response: undefined } : undefined;
      }
    };
    // better-call middlewares carry an own `options` property that the router
    // reads (better-call `middleware.mjs`); copy whatever is there so the
    // wrapper is indistinguishable from the original to better-auth.
    entry.handler = Object.assign(guarded, original) as AfterHookEntry['handler'];
    wrapped++;
  }

  return wrapped > 0;
}
