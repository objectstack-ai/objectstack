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
 * {@link CryptoContext}, and only the first of them means "settings":
 *
 *  1. **Settings** (`SettingsService`) — `ctx.namespace` is the settings
 *     namespace, `ctx.key` the specifier key; `handle.id` is recorded in
 *     `sys_setting.value_enc`.
 *  2. **Object secret fields** (the ObjectQL engine's secret-field path)
 *     — `ctx.namespace` is the **object name**, `ctx.key` the **field
 *     name**; `handle.id` is recorded as a `secret:` ref on the business
 *     row itself.
 *  3. **Datasource credentials** (the datasource secret binder) —
 *     `ctx.namespace` is caller-supplied (default `'datasource'`),
 *     `ctx.key` the datasource name; `handle.id` is recorded as the
 *     artefact's `sys_secret:` credentialsRef.
 *
 * All three persist a `sys_secret` row keyed by `handle.id`, and all three
 * share one flat `(namespace, key)` space: `sys_secret` declares that pair
 * **non-unique** precisely because it does not attribute a row to a
 * producer. See {@link CryptoContext} for what that costs an AAD binding.
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
 *  3. `rotateKey(handle)` — re-wraps the same plaintext under a new
 *     KMS key. Returns a new handle (typically `version + 1`). Audit
 *     trail records the rotation as `action='rotate'`.
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
  /** Monotonic version bumped on every rotation. */
  readonly version: number;
  /**
   * Provider-encoded ciphertext blob. The caller is expected to persist
   * this verbatim under `sys_secret.ciphertext`. Round-tripped to the
   * provider on `decrypt` and `rotateKey`.
   */
  readonly ciphertext: string;
}

/**
 * Optional context passed to encrypt/decrypt so providers can implement
 * Additional Authenticated Data (AAD) bindings — e.g. AWS KMS encryption
 * context.
 *
 * ⚠️ **What an AAD over this pair does and does not guarantee.**
 * `(namespace, key)` is one flat space shared by the three producer
 * vocabularies listed under {@link ICryptoProvider} — settings
 * namespace/specifier key, object name/field name, datasource binder —
 * and nothing reserves a name in one vocabulary against another. So a
 * provider binding its ciphertext to this pair **rejects a ciphertext
 * swapped between two coordinates within one producer's vocabulary** (a
 * settings value moved to another specifier; a secret field moved to
 * another field). It does **NOT** exclude a cross-vocabulary pair: an
 * object named `mail` carrying a secret field named `api_key` yields the
 * same coordinate as the `mail` settings namespace's `api_key` specifier,
 * under the same provider and key, in a `sys_secret` table that permits
 * both rows — and a ciphertext swapped between those two rows decrypts
 * cleanly. Implementations MUST NOT treat this pair as attributing a
 * ciphertext to a producer.
 *
 * This describes the contract as it stands today, not the shape it is
 * meant to keep: the intended end state is a producer-discriminated AAD
 * (a scope discriminant on this type, delimiter-safe encoding), deferred
 * because it is a breaking `ICryptoProvider` change plus an at-rest
 * rewrap of every existing ciphertext. Until that lands, the paragraph
 * above is the guarantee — do not read a stronger one into it.
 */
export interface CryptoContext {
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
   * the reference (see "Producers" on {@link ICryptoProvider}).
   */
  encrypt(plain: string, ctx: CryptoContext): Promise<CryptoHandle>;

  /**
   * Decrypt a handle previously returned by `encrypt`. Throws when the
   * ciphertext is invalid for the given context (AAD mismatch, missing
   * KMS key, expired version, etc.).
   */
  decrypt(handle: CryptoHandle, ctx: CryptoContext): Promise<string>;

  /**
   * Re-wrap the plaintext under the provider's current KMS key.
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
   */
  digest(plain: string): string;
}
