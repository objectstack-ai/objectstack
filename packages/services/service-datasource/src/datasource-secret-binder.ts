// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Default datasource SecretBinder — persists a runtime datasource's cleartext
 * credential into the `sys_secret` cipher store and returns an opaque
 * `credentialsRef` handle (ADR-0015 Addendum, security invariant).
 *
 * Mirrors the SettingsService Phase-3 split: the cleartext is wrapped by an
 * {@link ICryptoProvider} into a {@link CryptoHandle}, the ciphertext lands in a
 * `sys_secret` row keyed by `handle.id`, and only the handle id (wrapped as
 * `sys_secret:<id>`) is ever stored on the datasource artefact. Cleartext never
 * touches metadata.
 *
 * This is the dev/self-host wiring; production hosts swap the
 * `LocalCryptoProvider` for a KMS-backed `ICryptoProvider` and pass it here.
 */

import type { CryptoHandle, ICryptoProvider } from '@objectstack/spec/contracts';

/** Prefix used to recognise a datasource credential handle. */
const REF_PREFIX = 'sys_secret:';

/** A persisted `sys_secret` row (subset used to reconstruct a {@link CryptoHandle}). */
interface SecretRow {
  id: string;
  namespace: string;
  key: string;
  kms_key_id: string;
  alg: string;
  version: number;
  ciphertext: string;
}

/**
 * [#21913] The execution context every `sys_secret` read and write below runs
 * under: the explicit system opt-in. `sys_secret` is the platform's own cipher
 * store, written and read here on behalf of a datasource record the admin
 * doors already authorized (or of boot rehydration, which has no caller at
 * all). None of these calls may rely on a missing principal to pass the
 * security middleware's principal-less hand-off, which ADR-0096 D5 closes.
 */
const SYSTEM_CTX = { isSystem: true } as const;

/**
 * Minimal data-engine surface used to read/write the `sys_secret` store. Every
 * call passes `context` (the explicit system opt-in); an adapter over a data
 * engine forwards it verbatim.
 */
export interface SecretStoreEngineLike {
  insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
  delete(object: string, options: { where: Record<string, unknown>; context?: Record<string, unknown> }): Promise<unknown>;
  /**
   * Read `sys_secret` rows for the `resolve()` path. Optional so existing
   * callers that only bind/unbind keep working; `resolve()` no-ops when absent.
   * Mirrors `IDataEngine.find` — returns an array (or `{ data: [...] }`).
   */
  find?(object: string, query: Record<string, unknown>): Promise<unknown>;
}

export interface DatasourceSecretBinderDeps {
  /** Data engine (ObjectQL) used to persist the `sys_secret` row. */
  engine: SecretStoreEngineLike;
  /** Crypto provider that wraps cleartext into a {@link CryptoHandle}. */
  cryptoProvider: ICryptoProvider;
  /**
   * Namespace recorded on the secret row and used as the `CryptoContext`
   * namespace (default `'datasource'`). This is the datasource producer's
   * own vocabulary, **not** a settings namespace — the three producers of
   * `sys_secret` rows draw `(namespace, key)` from uncoordinated
   * vocabularies and the pair does not attribute a row to a producer. The
   * binder's `CryptoContext.scope` (`'datasource_credential'`, on bind and
   * resolve alike) is what does. See `CryptoContext` in `@objectstack/spec`.
   */
  namespace?: string;
}

export interface DatasourceSecretBinder {
  bind(input: { value: string; namespace?: string; key?: string }, hint: { name: string }): Promise<string>;
  unbind(credentialsRef: string): Promise<void>;
  /**
   * Dereference a `credentialsRef` back to its cleartext credential by reading
   * the `sys_secret` row and decrypting it. Used at boot to rebuild a runtime
   * datasource's live connection pool (the cleartext is never persisted, so it
   * must be recovered from the cipher store). Returns `undefined` when the ref
   * isn't ours, the row is gone, the engine can't read, or decryption fails
   * (e.g. an ephemeral dev key changed across restarts) — callers degrade to
   * skipping that pool rather than crashing boot.
   */
  resolve(credentialsRef: string): Promise<string | undefined>;
}

/** Build a `credentialsRef` from a crypto handle id. */
export function toCredentialsRef(handleId: string): string {
  return `${REF_PREFIX}${handleId}`;
}

/** Extract the `sys_secret` handle id from a credentialsRef, if it is one. */
export function parseCredentialsRef(ref: string): string | undefined {
  return ref?.startsWith(REF_PREFIX) ? ref.slice(REF_PREFIX.length) : undefined;
}

/**
 * Create the default datasource secret binder. Persists into `sys_secret` via
 * the data engine and never returns or logs the cleartext.
 */
export function createDatasourceSecretBinder(deps: DatasourceSecretBinderDeps): DatasourceSecretBinder {
  const { engine, cryptoProvider } = deps;
  const defaultNamespace = deps.namespace ?? 'datasource';

  return {
    async bind(input, hint) {
      const namespace = input.namespace ?? defaultNamespace;
      const key = input.key ?? hint.name;
      const handle: CryptoHandle = await cryptoProvider.encrypt(input.value, {
        scope: 'datasource_credential',
        namespace,
        key,
      });
      await engine.insert('sys_secret', {
        id: handle.id,
        namespace,
        key,
        kms_key_id: handle.kmsKeyId,
        alg: handle.alg,
        version: handle.version,
        ciphertext: handle.ciphertext,
      }, { context: SYSTEM_CTX });
      return toCredentialsRef(handle.id);
    },

    async unbind(credentialsRef) {
      const id = parseCredentialsRef(credentialsRef);
      if (!id) return; // not ours (or already cleared) — nothing to do
      await engine.delete('sys_secret', { where: { id }, context: SYSTEM_CTX });
    },

    async resolve(credentialsRef) {
      const id = parseCredentialsRef(credentialsRef);
      if (!id || typeof engine.find !== 'function') return undefined;
      try {
        const result = await engine.find('sys_secret', {
          where: { id },
          limit: 1,
          // Secrets are scoped through their owning datasource artefact, so
          // skip the tenant-audit warning (mirrors SettingsService's store).
          bypassTenantAudit: true,
          context: SYSTEM_CTX,
        });
        const rows = (Array.isArray(result) ? result : (result as { data?: unknown[] })?.data) ?? [];
        const row = rows[0] as SecretRow | undefined;
        if (!row?.ciphertext) return undefined;
        // Reconstruct the handle and decrypt under the same
        // (scope, namespace, key) AAD the row was sealed with — a mismatch,
        // including a row another producer sealed, fails authentication.
        return await cryptoProvider.decrypt(
          {
            id: row.id,
            kmsKeyId: row.kms_key_id,
            alg: row.alg,
            version: row.version,
            ciphertext: row.ciphertext,
          },
          { scope: 'datasource_credential', namespace: row.namespace, key: row.key },
        );
      } catch {
        // Missing row / unreadable engine / decrypt failure (e.g. rotated dev
        // key) — never block boot; the pool is simply not rehydrated.
        return undefined;
      }
    },
  };
}
