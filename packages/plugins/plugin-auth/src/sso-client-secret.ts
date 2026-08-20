// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8009] The persistence seam for an OIDC provider's `clientSecret`.
 *
 * ## The defect (measured, not asserted)
 * `sys_sso_provider.oidc_config` is a textarea holding the whole OIDC config as
 * one JSON string, `clientSecret` included. A provider registered through the
 * real write path stores that secret BYTE-FOR-BYTE IN CLEARTEXT — measured on
 * issue #8009 by registering a provider against a real `betterAuth` + real
 * `sso()` + this adapter over a real engine, then reading the row back with
 * `engine.find` (bypassing the adapter). The object file's own register-action
 * helpText claims the value is "stored encrypted by better-auth"; that claim is
 * measured FALSE. An OIDC `clientSecret` is what authenticates THIS PLATFORM to
 * the IdP, and `sys_sso_provider` is readable through the generic data API
 * (`apiMethods: ['get','list']`), so anyone who can read the row can
 * impersonate our OIDC client.
 *
 * better-auth's OWN read endpoints are not the exposure — `sanitizeProvider`
 * masks `clientId` and never returns `clientSecret`. The exposure is cleartext
 * at rest plus our own generic read path.
 *
 * ## The seam
 * `@better-auth/sso` has NO secret-at-rest option, so there is no upstream
 * switch to flip: `SSOOptions` has no equivalent of
 * `scim({ storeSCIMToken: 'hashed' })`. Measured 2026-08-20 against the
 * installed `@better-auth/sso@1.7.1` by enumerating the top-level members of
 * `SSOOptions` in the shipped `dist/index-CZytzKv6.d.mts` — `resolveUser`,
 * `guardProviderMutation`, `provisionUser`, `provisionUserOnEveryLogin`,
 * `organizationProvisioning`, `defaultSSO`, `defaultOverrideUserInfo`,
 * `disableImplicitSignUp`, `modelName`, `fields`, `schema`, `providersLimit`,
 * `trustEmailVerified`, `domainVerification`. None of them concerns storage of
 * `clientSecret`; the only `encrypt`-shaped strings in the package are SAML
 * assertion algorithms. Re-check by re-listing those members: a new one named
 * for secret storage is what would retire this whole file. better-auth owns the writes, so the seam
 * sits between better-auth and its adapter — here — and never in a route handler.
 *
 *   register / update-provider
 *     -> adapter `create` / `update` / `updateMany`
 *        -> {@link liftClientSecretForWrite}: `clientSecret` is LIFTED OUT of the
 *           JSON blob into `sys_sso_provider.oidc_client_secret` (`type: 'secret'`)
 *        -> the engine encrypts it via the registered `ICryptoProvider`, stores
 *           the ciphertext as a `sys_secret` row, and leaves only an opaque
 *           `secret:` ref on the column
 *        -> `oidc_config` persists the same blob MINUS `clientSecret`
 *
 *   /sso/callback (and every other better-auth read of the model)
 *     -> adapter `findOne` / `findMany`
 *        -> {@link injectClientSecretOnRead}: the plaintext is recovered through
 *           `engine.resolveSecretField()` and put BACK into the blob better-auth
 *           receives, so the IdP token exchange still authenticates.
 *
 * Decrypt-on-read is MANDATORY, not decorative: `/sso/callback` reads the blob
 * back and expects plaintext. Encrypt-on-write alone would break every
 * federated login while making the column LOOK protected.
 *
 * ⚠️ This is NOT the "redact on read" shape that was ruled out on #8009. Redact
 * on read leaves cleartext at rest and hides it from readers; this stores
 * ciphertext at rest and hands plaintext only to the one privileged server-side
 * consumer that must have it.
 *
 * ## Two things this file deliberately does NOT do
 * - It does not invent a second cipher store, and it does not encrypt anything
 *   itself. The engine owns the `ICryptoProvider` (the host injects it via
 *   `setCryptoProvider`), so this seam writes cleartext INTO the `secret`-typed
 *   column exactly once and lets the engine's own write path wrap it. That
 *   inherits the engine's fail-closed posture for free: no provider ⇒ the write
 *   THROWS ⇒ registration fails loudly, rather than silently persisting
 *   cleartext in a column that advertises itself as encrypted. Same reasoning as
 *   `plugin-webhooks/src/webhook-secret.ts` (#7799), and the same privileged
 *   accessor (#7823).
 * - It does not guess on read. A row whose secret cannot be resolved is handed
 *   to better-auth WITHOUT a `clientSecret` rather than with a wrong one: the
 *   IdP rejects the token exchange visibly, which is safer than a silent
 *   half-authenticated login.
 */

import type { IDataEngine } from '@objectstack/core';

/** Object whose rows carry the OIDC config. */
export const SSO_PROVIDER_OBJECT = 'sys_sso_provider';

/** Column holding the encrypted OIDC client secret (`type: 'secret'`). */
export const SSO_CLIENT_SECRET_FIELD = 'oidc_client_secret';

/** Column holding the rest of the OIDC config, as a JSON string. */
export const SSO_OIDC_CONFIG_FIELD = 'oidc_config';

/** Member lifted out of the blob. */
const CLIENT_SECRET_KEY = 'clientSecret';

/**
 * Engine surface this seam needs. `withSystemContext` deliberately exposes only
 * the CRUD verbs, so the privileged dereference has to come from the RAW engine
 * — `resolveSecretField` is a separately-named privileged verb precisely so it
 * cannot be reached from a query string (#7823).
 */
export interface SecretResolvingEngine {
  resolveSecretField?(
    object: string, recordId: string, field: string, opts?: { tenantId?: string },
  ): Promise<string | null>;
  /**
   * [#8022] The engine's crypto-provider registration channel. "No CryptoProvider"
   * is not only a misconfiguration — on every host it is also a transient BOOT
   * state, because plugins run inside `kernel:ready` while the composition root
   * (`serve.ts`) injects the provider only after `runtime.start()` returns.
   */
  onCryptoProviderChange?(listener: () => void): () => void;
}

/** Parsed view of the `oidc_config` column, remembering how it was carried. */
interface ParsedConfig {
  config: Record<string, unknown>;
  /** True when the column carried a JSON STRING (what better-auth writes). */
  wasString: boolean;
}

/**
 * Parse the `oidc_config` value. better-auth hands the adapter a JSON STRING
 * (`JSON.stringify` in its register handler), but the column is also readable as
 * an already-parsed object depending on driver/JSON support, so both are
 * accepted and the original carrier shape is restored on the way out. Returns
 * `null` for anything that is not a usable config — a null column, an empty
 * string, or a string that is not JSON — so a malformed row is left untouched
 * rather than rewritten into a different malformed shape.
 */
function parseOidcConfig(value: unknown): ParsedConfig | null {
  if (value == null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return { config: value as Record<string, unknown>, wasString: false };
  }
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return { config: parsed as Record<string, unknown>, wasString: true };
  } catch {
    return null;
  }
}

/** Re-serialize a config in the same carrier shape it arrived in. */
function serializeOidcConfig(parsed: ParsedConfig): unknown {
  return parsed.wasString ? JSON.stringify(parsed.config) : parsed.config;
}

/**
 * WRITE half. Lift `clientSecret` out of the `oidc_config` blob on `row` and put
 * it on the `secret`-typed column, in place.
 *
 * No-ops (leaving `row` byte-for-byte alone) when the row is for another object,
 * carries no `oidc_config`, or carries a blob with no usable `clientSecret`.
 * That last case is what makes a PARTIAL update safe: `/sso/update-provider`
 * may send a config without the secret, and silently blanking the stored
 * credential on such a write would break every subsequent login.
 *
 * Returns true when a secret was lifted (for logging/tests).
 */
export function liftClientSecretForWrite(objectName: string, row: unknown): boolean {
  if (objectName !== SSO_PROVIDER_OBJECT) return false;
  if (!row || typeof row !== 'object') return false;
  const record = row as Record<string, unknown>;
  if (!(SSO_OIDC_CONFIG_FIELD in record)) return false;

  const parsed = parseOidcConfig(record[SSO_OIDC_CONFIG_FIELD]);
  if (!parsed) return false;

  const secret = parsed.config[CLIENT_SECRET_KEY];
  if (typeof secret !== 'string' || secret === '') return false;

  delete parsed.config[CLIENT_SECRET_KEY];
  record[SSO_OIDC_CONFIG_FIELD] = serializeOidcConfig(parsed);
  // Cleartext into the `secret`-typed column exactly once; the ENGINE encrypts.
  record[SSO_CLIENT_SECRET_FIELD] = secret;
  return true;
}

/**
 * READ half. Put the plaintext `clientSecret` back into the blob better-auth
 * receives, in place, and drop the internal secret column from the row.
 *
 * Three cases, in order:
 *  1. the column holds an encrypted ref ⇒ dereference it via the privileged
 *     accessor and re-inject the plaintext;
 *  2. the column is empty but the blob still carries a cleartext `clientSecret`
 *     ⇒ a row written before this seam existed. Left as-is so federated login
 *     keeps working on an un-migrated row (see
 *     {@link migrateLegacySsoClientSecrets} for how such rows are moved
 *     forward);
 *  3. neither ⇒ better-auth gets a config with no `clientSecret`, and the IdP
 *     rejects the exchange visibly. Deliberate: a wrong secret would fail more
 *     confusingly, and inventing one is not an option.
 *
 * The internal column is ALWAYS removed from the returned row, so better-auth
 * never sees the read mask as if it were a field of its own model.
 */
export async function injectClientSecretOnRead(
  engine: SecretResolvingEngine,
  objectName: string,
  row: unknown,
): Promise<void> {
  if (objectName !== SSO_PROVIDER_OBJECT) return;
  if (!row || typeof row !== 'object') return;
  const record = row as Record<string, unknown>;

  const recordId = record.id;
  // The column is masked on every supported read path, so its VALUE here is
  // never the ref — the privileged accessor re-reads the row at driver level.
  delete record[SSO_CLIENT_SECRET_FIELD];

  if (typeof recordId !== 'string' || recordId === '') return;
  if (typeof engine.resolveSecretField !== 'function') return;

  const parsed = parseOidcConfig(record[SSO_OIDC_CONFIG_FIELD]);
  if (!parsed) return;
  // Case 2: an un-migrated row already carries its cleartext secret.
  if (typeof parsed.config[CLIENT_SECRET_KEY] === 'string') return;

  let plaintext: string | null = null;
  try {
    plaintext = await engine.resolveSecretField(SSO_PROVIDER_OBJECT, recordId, SSO_CLIENT_SECRET_FIELD);
  } catch {
    // Case 3: no CryptoProvider, or the sys_secret row is gone. Hand back a
    // config with no clientSecret rather than a wrong one.
    return;
  }
  if (typeof plaintext !== 'string' || plaintext === '') return;

  parsed.config[CLIENT_SECRET_KEY] = plaintext;
  record[SSO_OIDC_CONFIG_FIELD] = serializeOidcConfig(parsed);
}

/** Outcome of the one-shot forward migration, for logging and tests. */
export interface SsoSecretMigrationResult {
  /** Rows found still carrying a cleartext `clientSecret` in the blob. */
  found: number;
  /** Rows successfully moved into the encrypted channel. */
  migrated: number;
  /** Rows that could not be migrated (message per row). */
  failures: string[];
}

/**
 * MIGRATION half — the disposition for rows written before this seam existed.
 *
 * Such a row keeps its cleartext `clientSecret` inside `oidc_config`. Leaving it
 * there while the object advertises an encrypted column is the "looks protected"
 * failure this change exists to remove, so the plugin sweeps them forward once
 * at start: every provider row whose blob still carries a cleartext secret is
 * re-written through the engine, which lifts the secret into the encrypted
 * column and drops it from the blob.
 *
 * Bounded and idempotent by construction: SSO providers are env-global admin
 * config (a handful of rows, not a data table), a migrated row no longer matches
 * the "blob still carries a cleartext secret" test, and a row that fails is
 * counted and reported rather than retried in a loop.
 *
 * Fail-SOFT at the call site, fail-CLOSED per row: this never throws into boot
 * (an environment with no CryptoProvider must still start), but a row it cannot
 * migrate is left exactly as it was — still working, still cleartext, and
 * counted in `failures` so the operator sees it. It is never rewritten into a
 * half-migrated state.
 */
export async function migrateLegacySsoClientSecrets(
  engine: IDataEngine,
): Promise<SsoSecretMigrationResult> {
  const result: SsoSecretMigrationResult = { found: 0, migrated: 0, failures: [] };
  const e = engine as unknown as {
    find(object: string, query: unknown): Promise<Record<string, unknown>[]>;
    update(object: string, data: unknown, options?: unknown): Promise<unknown>;
  };

  let rows: Record<string, unknown>[];
  try {
    rows = await e.find(SSO_PROVIDER_OBJECT, { context: { isSystem: true } });
  } catch (err) {
    result.failures.push(`could not list providers: ${String((err as Error)?.message ?? err)}`);
    return result;
  }

  for (const row of rows ?? []) {
    const parsed = parseOidcConfig(row?.[SSO_OIDC_CONFIG_FIELD]);
    if (!parsed) continue;
    if (typeof parsed.config[CLIENT_SECRET_KEY] !== 'string' || parsed.config[CLIENT_SECRET_KEY] === '') continue;
    result.found += 1;

    const id = row.id;
    if (typeof id !== 'string' || id === '') {
      result.failures.push('provider row has no id');
      continue;
    }

    const patch: Record<string, unknown> = {
      id,
      [SSO_OIDC_CONFIG_FIELD]: row[SSO_OIDC_CONFIG_FIELD],
    };
    // Same seam as the live write path — one implementation, not a second one.
    liftClientSecretForWrite(SSO_PROVIDER_OBJECT, patch);
    try {
      await e.update(SSO_PROVIDER_OBJECT, patch, { context: { isSystem: true } });
      result.migrated += 1;
    } catch (err) {
      result.failures.push(`${id}: ${String((err as Error)?.message ?? err)}`);
    }
  }

  return result;
}

/** Minimal logger surface, so this module needs no logger dependency. */
interface MigrationLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
}

/**
 * Run {@link migrateLegacySsoClientSecrets} at boot, and again if the host wires
 * the CryptoProvider afterwards.
 *
 * The second half is not belt-and-braces: plugins run inside `kernel:ready`, and
 * `serve.ts` injects the provider only after `runtime.start()` RETURNS, so the
 * first sweep reliably precedes the capability it needs and would otherwise
 * report every legacy row as a failure and leave it cleartext until someone
 * re-saved it by hand. Same race, same remedy, as `plugin-webhooks` (#8022).
 *
 * Returns an unsubscribe function when the engine exposes the channel.
 */
export function scheduleLegacySsoSecretMigration(
  engine: IDataEngine,
  logger: MigrationLogger,
): (() => void) | undefined {
  const report = (result: SsoSecretMigrationResult): void => {
    if (result.found === 0 && result.failures.length === 0) return;
    if (result.migrated > 0) {
      logger.info(
        `Auth: migrated ${result.migrated} SSO provider client secret(s) into the encrypted channel (#8009)`,
      );
    }
    if (result.failures.length > 0) {
      logger.warn(
        `Auth: ${result.failures.length} SSO provider row(s) still hold a CLEARTEXT OIDC client secret — `
          + 'they keep working, but are not encrypted at rest. Wire a CryptoProvider '
          + '(engine.setCryptoProvider) and restart, or re-save the provider.',
        { failures: result.failures },
      );
    }
  };

  const run = (): void => {
    void migrateLegacySsoClientSecrets(engine)
      .then(report)
      .catch((err: unknown) => {
        // Never throw into boot: an environment with no CryptoProvider must
        // still start. An un-migrated row is visible above, not silent.
        logger.warn(`Auth: SSO client-secret migration sweep failed: ${String((err as Error)?.message ?? err)}`);
      });
  };

  // Subscribe BEFORE the first sweep, so a provider that lands mid-sweep is not
  // missed — the same ordering `plugin-webhooks` uses for this race.
  const observable = engine as unknown as SecretResolvingEngine;
  const unsubscribe = typeof observable?.onCryptoProviderChange === 'function'
    ? observable.onCryptoProviderChange(() => run())
    : undefined;

  run();
  return unsubscribe;
}
