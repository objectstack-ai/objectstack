// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ICryptoProvider — pluggable encryption hook for the Settings subsystem.
 *
 * The provider's only job is to round-trip plaintext to a *handle*
 * (a string the caller persists; opaque to everyone else). The handle
 * doubles as the value stored in `sys_setting.value_enc` — it usually
 * points to a row in `sys_secret`, but the contract intentionally
 * leaves the format up to the implementation.
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
 *  1. `encrypt(plain)` — called once per `set()` for an encrypted
 *     specifier. Returns a `CryptoHandle` describing both the storage
 *     handle and the KMS metadata. The caller persists a `sys_secret`
 *     row keyed by `handle.id` and stores `handle.id` in
 *     `sys_setting.value_enc`.
 *  2. `decrypt(handle)` — called on every `get()` of an encrypted
 *     specifier to reveal the plaintext to the consumer (e.g.
 *     EmailService building a transport). Implementations may cache
 *     decrypted plaintext in-process for the duration of a request.
 *  3. `rotateKey(handle)` — re-wraps the same plaintext under a new
 *     KMS key. Returns a new handle (typically `version + 1`). Audit
 *     trail records the rotation as `action='rotate'`.
 *
 * Threading: implementations MUST be safe to call concurrently from
 * multiple async tasks. They should *not* assume sequential access.
 */
export interface CryptoHandle {
  /** Stable opaque id stored in `sys_setting.value_enc`. */
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
 * context. Helps reject ciphertexts that were copied across namespaces.
 */
export interface CryptoContext {
  /** Settings namespace the value belongs to. */
  namespace: string;
  /** Specifier key within the namespace. */
  key: string;
  /** Optional tenant id for multi-tenant key segregation. */
  tenantId?: string;
}

export interface ICryptoProvider {
  /**
   * Encrypt plaintext and return a handle. The handle is stored in
   * `sys_secret` and referenced by `sys_setting.value_enc`.
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
   * leaving `id` stable (so `sys_setting.value_enc` need not be rewritten).
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
