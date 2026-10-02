// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ICryptoProvider — pluggable encryption hook shared by every platform
 * surface that seals a secret at rest.
 *
 * The provider's only job is to round-trip plaintext to a *handle*
 * (a string the caller persists; opaque to everyone else). The handle
 * usually points to a row in `sys_secret`, but the contract intentionally
 * leaves the format up to the implementation. Where the caller *records*
 * the handle differs per producer — see "Producers" below.
 *
 * Producers — three independent call sites construct a
 * {@link CryptoContext}, and only the first of them means "settings". Each
 * names itself with its own member of {@link CRYPTO_CONTEXT_SCOPES}
 * (`ctx.scope`, ADR-0128 D1):
 *
 *  1. **Settings** (`SettingsService`, scope `'settings'`) —
 *     `ctx.namespace` is the settings namespace, `ctx.key` the specifier
 *     key; `handle.id` is recorded in `sys_setting.value_enc`.
 *  2. **Object secret fields** (the ObjectQL engine's secret-field path,
 *     scope `'object_secret_field'`) — `ctx.namespace` is the **object
 *     name**, `ctx.key` the **field name**; `handle.id` is recorded as a
 *     `secret:` ref on the business row itself.
 *  3. **Datasource credentials** (the datasource secret binder, scope
 *     `'datasource_credential'`) — `ctx.namespace` is caller-supplied
 *     (default `'datasource'`), `ctx.key` the datasource name; `handle.id`
 *     is recorded as the artefact's `sys_secret:` credentialsRef.
 *
 * All three persist a `sys_secret` row keyed by `handle.id`, and the three
 * `(namespace, key)` vocabularies are uncoordinated: `sys_secret` declares
 * that pair **non-unique** precisely because it does not attribute a row to
 * a producer. The scope is what does — see {@link CryptoContext} for how an
 * AAD binding uses it.
 *
 * Why an interface (not a concrete class):
 *
 *  - **Default / self-host** ships a `LocalCryptoProvider`: AES-256-GCM
 *    keyed off `OS_SECRET_KEY` (or a persisted dev key). Secrets surviving
 *    a restart is correctness, not a premium feature, so this provider is
 *    open-source and fails loud rather than silently minting an ephemeral
 *    key in production.
 *  - **Managed custody** plugs in `AwsKmsCryptoProvider`,
 *    `GcpKmsCryptoProvider`, or `HashicorpVaultCryptoProvider` (per-tenant
 *    keys, automatic rotation) without touching `SettingsService`.
 *  - Custom KMS providers (PKCS#11 HSMs, customer-managed keys) can be
 *    registered by the host application via `SettingsServiceOptions`.
 *
 * Lifecycle:
 *
 *  1. `encrypt(plain, ctx)` — called once per write of an encrypted
 *     value (a settings `set()`, an object secret field, a datasource
 *     credential). Returns a `CryptoHandle` describing both the storage
 *     handle and the KMS metadata. The caller persists a `sys_secret`
 *     row keyed by `handle.id` and records `handle.id` wherever its
 *     producer keeps it (see "Producers" above).
 *  2. `decrypt(handle, ctx)` — called on every read of an encrypted
 *     value to reveal the plaintext to the consumer (e.g. EmailService
 *     building a transport). Implementations may cache decrypted
 *     plaintext in-process for the duration of a request.
 *  3. `rotateKey(handle, ctx)` — re-wraps the same plaintext under the
 *     provider's current KMS key and current AAD derivation. Returns a new
 *     handle (typically `version + 1`). Audit trail records the rotation as
 *     `action='rotate'`.
 *
 * Threading: implementations MUST be safe to call concurrently from
 * multiple async tasks. They should *not* assume sequential access.
 */
export interface CryptoHandle {
  /**
   * Stable opaque id — the key of the `sys_secret` row, recorded by the
   * producer wherever that producer keeps its reference (`sys_setting
   * .value_enc`, a `secret:` ref on a business row, or a `sys_secret:`
   * credentialsRef). Not a settings-only coordinate.
   */
  readonly id: string;
  /** Identifier of the KMS key that wrapped the cipher. */
  readonly kmsKeyId: string;
  /** AEAD / cipher tag (e.g. `'aes-256-gcm'`). */
  readonly alg: string;
  /**
   * Monotonic version bumped on every rotation. A rotation counter only —
   * not the AAD derivation that sealed {@link CryptoHandle.ciphertext},
   * which the provider records inside the ciphertext itself.
   */
  readonly version: number;
  /**
   * Provider-encoded ciphertext blob. The caller is expected to persist
   * this verbatim under `sys_secret.ciphertext`. Round-tripped to the
   * provider on `decrypt` and `rotateKey`. Verbatim matters: the blob
   * carries the provider's record of which AAD derivation sealed it (see
   * {@link CryptoContext}), and that record is what `decrypt` dispatches on.
   */
  readonly ciphertext: string;
}

/**
 * The closed set of producer vocabularies a {@link CryptoContext} is drawn
 * from — ADR-0128 D1. One member per producer of `CryptoContext` (see
 * "Producers" on {@link ICryptoProvider}):
 *
 *  - `'settings'` — `SettingsService`: settings namespace + specifier key.
 *  - `'object_secret_field'` — the ObjectQL engine's secret-field path:
 *    object name + field name.
 *  - `'datasource_credential'` — the datasource secret binder:
 *    caller-supplied namespace (default `'datasource'`) + datasource name.
 *
 * Closed on purpose. A new producer of `CryptoContext` adds its own member
 * here in the same change that adds the producer — ⛔ it never borrows an
 * existing member, because borrowing one puts the new vocabulary's
 * `(namespace, key)` pairs back into another producer's AAD space, which is
 * exactly what the discriminant exists to prevent.
 */
export const CRYPTO_CONTEXT_SCOPES = [
  'settings',
  'object_secret_field',
  'datasource_credential',
] as const;

/** A producer vocabulary — derived from {@link CRYPTO_CONTEXT_SCOPES}. */
export type CryptoContextScope = (typeof CRYPTO_CONTEXT_SCOPES)[number];

/**
 * Context passed to encrypt/decrypt/rotateKey so providers can bind
 * Additional Authenticated Data (AAD) — e.g. AWS KMS encryption context.
 *
 * **What the binding covers (ADR-0128).** The AAD binds a ciphertext to the
 * triple `(scope, namespace, key)`. `(namespace, key)` alone is not a
 * coordinate: the three producer vocabularies share it, uncoordinated, and
 * nothing reserves a name in one against another. `scope` names which
 * vocabulary the pair is drawn from, so under a conforming provider a
 * ciphertext sealed by one producer does not authenticate under another
 * producer's context — however the two pairs are spelled — and within one
 * producer a ciphertext moved to another coordinate does not authenticate
 * either.
 *
 * Every provider that binds AAD MUST:
 *
 *  1. **Fold `scope` in** (D1). A binding over `(namespace, key)` alone
 *     cannot say which producer sealed a ciphertext.
 *  2. **Encode delimiter-safely** (D2). Distinct `(scope, namespace, key)`
 *     triples MUST produce distinct AAD bytes — length-prefixing, escaping,
 *     or a canonical structured encoding. ⛔ Never an unescaped join:
 *     neither a settings specifier key nor a caller-supplied datasource
 *     namespace is barred from containing any separator.
 *  3. **Record its derivation in what it seals** (§4's versioned handle). A
 *     provider whose AAD derivation changes records, in the ciphertext it
 *     returns, which derivation sealed it. `decrypt` and `rotateKey` open a
 *     ciphertext with the derivation it records, and refuse — fail closed —
 *     one whose derivation they do not know. ⛔ Never try a second
 *     derivation, or a second scope, after one fails (D3: the fix lives at
 *     the producer of the AAD, never in a fallback): the record decides,
 *     nothing is guessed.
 *
 * ⚠️ **What it does not cover yet.** A ciphertext sealed before its
 * provider adopted the scope (for `LocalCryptoProvider`: every handle whose
 * ciphertext carries no derivation marker) still carries the older binding
 * over `(namespace, key)` alone. That binding rejects a ciphertext moved
 * between two coordinates of one vocabulary and does NOT exclude a pair
 * spelled identically in two vocabularies. It holds until the ciphertext is
 * re-wrapped under the current derivation ({@link ICryptoProvider.rotateKey}).
 * Implementations MUST NOT treat such a ciphertext as attributed to a
 * producer.
 */
export interface CryptoContext {
  /**
   * The producer vocabulary `namespace` and `key` are drawn from — REQUIRED
   * (ADR-0128 D1). Each producer passes its own member of
   * {@link CRYPTO_CONTEXT_SCOPES}, on every call (`encrypt`, `decrypt` and
   * `rotateKey` alike), so the AAD names the producer as well as the
   * coordinate. Required, never optional: an optional discriminant is
   * absent exactly where nobody thought about it.
   */
  scope: CryptoContextScope;
  /**
   * Producer-scoped namespace: a settings namespace, an **object name**
   * (secret fields), or a caller-supplied datasource namespace (default
   * `'datasource'`). Not a settings namespace in general.
   */
  namespace: string;
  /**
   * Producer-scoped key within {@link CryptoContext.namespace}: a settings
   * specifier key, a **field name** (secret fields), or a datasource name.
   */
  key: string;
  /** Optional tenant id for multi-tenant key segregation. */
  tenantId?: string;
}

export interface ICryptoProvider {
  /**
   * Encrypt plaintext and return a handle. The caller persists it as a
   * `sys_secret` row and references it from wherever its producer keeps
   * the reference (see "Producers" on {@link ICryptoProvider}). The
   * ciphertext is bound to `ctx` under the provider's current AAD
   * derivation, and records that derivation (see {@link CryptoContext}).
   */
  encrypt(plain: string, ctx: CryptoContext): Promise<CryptoHandle>;

  /**
   * Decrypt a handle previously returned by `encrypt`. Opens the ciphertext
   * with the AAD derivation it records, under the caller's `ctx` — the same
   * producer's scope that sealed it. Throws when the ciphertext is invalid
   * for the given context (AAD mismatch, a scope or coordinate other than
   * the sealing one, missing KMS key, a derivation the provider does not
   * know, etc.).
   */
  decrypt(handle: CryptoHandle, ctx: CryptoContext): Promise<string>;

  /**
   * Re-wrap the plaintext under the provider's current KMS key and current
   * AAD derivation: the input is opened with the derivation it records and
   * the output is sealed with the current one, so this is also the seam an
   * at-rest re-wrap of older ciphertexts uses.
   * The returned handle replaces the input handle in `sys_secret`.
   * Implementations SHOULD bump `version` and update `kmsKeyId` while
   * leaving `id` stable, so no producer's stored reference to the handle
   * has to be rewritten.
   */
  rotateKey(handle: CryptoHandle, ctx: CryptoContext): Promise<CryptoHandle>;

  /**
   * Stable hex digest of `plain` used for audit logging. SHOULD NOT
   * reveal the plaintext (use HMAC or SHA-256 of canonical JSON).
   * Same hash for same input enables operators to detect duplicate
   * writes without exposing secrets.
   *
   * Not keyed by contract: plain SHA-256 satisfies it, so anyone holding a
   * candidate input can recompute it. A value that must not be computable
   * without the provider's key comes from {@link ICryptoProvider.keyedDigest}.
   */
  digest(plain: string): string;

  /**
   * Keyed digest of `plain` under the provider's server-held key — the
   * primitive for a value that is handed to a caller yet must not let that
   * caller confirm a guess about the input offline.
   *
   * Each of the following is a requirement on every implementation:
   *
   *  1. **Keyed.** The output MUST NOT be computable from `plain` without
   *     the provider's key. An implementation that holds no key material
   *     MUST reject — ⛔ never resolve to an unkeyed value (a plain hash of
   *     `plain`, or a MAC under an empty or publicly known key).
   *  2. **Stable per key.** Under one key, equal `plain` yields an equal
   *     output in every process and on every node holding that key, so a
   *     value one node hands out compares equal when a caller echoes it to
   *     another. Replacing the key changes every output.
   *  3. **Not a substitute for {@link ICryptoProvider.digest}.** `digest`
   *     keeps its own contract and the stability the audit trail relies on;
   *     nothing that records or compares audit digests moves to this method,
   *     and this method is not an audit fingerprint.
   *
   * Output: `hmac-sha256:` followed by the 64 lowercase hex characters of an
   * HMAC-SHA-256 — 76 characters drawn from `[0-9a-z:-]`. That one token
   * travels unchanged in an HTTP header value, a query-string value and a
   * JSON string, and its prefix keeps it disjoint from the `sha256:`
   * spelling of an unkeyed content hash.
   *
   * Asynchronous because a managed-custody provider computes the MAC inside
   * its KMS, where the key never leaves.
   */
  keyedDigest(plain: string): Promise<string>;
}
