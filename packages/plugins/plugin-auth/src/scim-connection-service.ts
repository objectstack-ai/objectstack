// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectStack-owned SCIM connection credentials — mint, digest, verify (#3653).
 *
 * Stable `@better-auth/scim` (1.7.x) stores no bearer credential of its own:
 * the rc.1 `/scim/generate-token` endpoint and `scimProvider.scim_token`
 * column are gone, and no stable model declares a token/secret column. The
 * plugin instead accepts an application-owned
 * `authentication.verifyBearerToken`, which `auth-manager.ts` wires to
 * {@link verifyScimBearerToken} below. SCIM connections therefore stay what
 * they have always been in ObjectStack — RUNTIME DATA resolved from a row at
 * request time (`sys_scim_connection_credential`) — rather than boot-time
 * static config or the upstream managed catalog (not adopted; maintainer
 * ruling 2026-08-25).
 *
 * ## Credential-at-rest posture (pinned by `credential-at-rest-posture.test.ts`)
 *
 * The stored value is an HMAC-SHA-256 of the bearer, keyed by the
 * deployment's auth secret, base64url unpadded — one-way, never cleartext.
 * This is deliberately AT PARITY OR BETTER than what the rc.1 line stored
 * (an UNSALTED SHA-256 of the token): the keyed digest additionally resists
 * offline table matching if a backup of this table leaks without the secret.
 * The digest is deterministic on purpose — it is the row's unique lookup key,
 * so verification is one indexed equality probe instead of a table scan.
 * The input is domain-separated (`scim-credential-v1:`) so the digest can
 * never collide with any other HMAC use of the same deployment secret.
 *
 * ⚠️ Keying consequence, stated where it is decided: the digest is bound to
 * the deployment's auth secret. Rotating that secret invalidates every stored
 * SCIM credential (verification simply misses), and digests are NOT portable
 * between deployments with different secrets — each such event is an IdP
 * token reissue, which is already the migration-day posture for this epic
 * (digests were not portable from rc.1 on any path).
 *
 * The plaintext bearer is returned exactly once from
 * {@link mintScimConnectionCredential} and is not recoverable afterwards.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped marker: "the current async chain is a SCIM protocol
 * request". Entered by the auth manager's `verifyBearerToken` wrapper (the
 * first application code every authenticated SCIM request runs) via
 * `enterWith`, so it holds for the remainder of that request's async chain —
 * including the provisioning writes the plugin performs afterwards.
 *
 * Read by `objectql-adapter.ts`'s `config.transaction`: SCIM requests get a
 * REAL engine transaction (the atomicity upstream's
 * `assertNativeSCIMTransactions` exists to demand), while every other
 * better-auth flow keeps the sequential behaviour it has always had. The
 * scoping is load-bearing, measured, not a convenience: better-auth wraps
 * WHOLE request flows in `adapter.transaction` (`runWithTransaction`), and
 * opening a real driver transaction around every sign-in/sign-up starved the
 * single-connection sqlite pools — the dogfood showcase boot deadlocked on
 * `Acquire connection error` until the hook timeout, reproduced in CI and
 * locally (#3653). Core flows never had native DB transactions before (the
 * adapter factory's default is the sequential as-is fallback), so this keeps
 * them at their historical posture rather than weakening anything.
 */
export const scimRequestScope = new AsyncLocalStorage<{ scim: true }>();

/** Is the current async chain inside an authenticated SCIM protocol request? */
export function inScimRequestScope(): boolean {
  return scimRequestScope.getStore()?.scim === true;
}

/** The ObjectStack-owned credential store (see platform-objects/identity). */
export const SCIM_CREDENTIAL_OBJECT = 'sys_scim_connection_credential';

/** Recognizable prefix for minted SCIM bearers (aids secret scanning). */
export const SCIM_BEARER_PREFIX = 'oss_scim_';

/**
 * Every operation scope the stable plugin defines. Credentials mint with the
 * full set — scoped-down credentials are a follow-up the store's shape admits
 * (a `scopes` column) but nothing pulls for today, so it is deliberately not
 * declared surface (PD #10: declared = enforced).
 */
export const SCIM_ALL_SCOPES = [
  'scim.users.read',
  'scim.users.write',
  'scim.groups.read',
  'scim.groups.write',
] as const;

/** One operation scope, as the stable plugin spells them. */
export type ScimScope = (typeof SCIM_ALL_SCOPES)[number];

/** Minimal engine surface the service needs (matches IDataEngine usage here). */
interface CredentialEngine {
  insert(object: string, row: Record<string, unknown>): Promise<Record<string, unknown>>;
  findOne(object: string, query: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
}

/**
 * One-way digest of a SCIM bearer: HMAC-SHA-256(secret, "scim-credential-v1:" + token),
 * base64url unpadded. See the file header for why keyed + deterministic.
 */
export function digestScimBearerToken(secret: string, token: string): string {
  return createHmac('sha256', secret)
    .update(`scim-credential-v1:${token}`, 'utf8')
    .digest('base64url');
}

export interface MintScimConnectionCredentialInput {
  /** Immutable connection identifier that scopes every provisioned resource. */
  connectionId: string;
  /** Application-owned boundary; defaults to the connection id when absent. */
  provisioningDomainId?: string;
  /** Organization scope, when provisioning is org-scoped. */
  organizationId?: string;
  /** Operator-facing label (e.g. "rotation 2026-Q3"). */
  label?: string;
  /** Optional hard expiry for staged rotation. */
  expiresAt?: Date;
  /** User who minted the credential, for audit. */
  mintedByUserId?: string;
}

export interface MintedScimConnectionCredential {
  /** The plaintext bearer — shown exactly once, never stored. */
  token: string;
  /** The `sys_scim_connection_credential` row id. */
  credentialId: string;
}

/**
 * Mint a bearer credential for a SCIM connection: generate a 256-bit random
 * token, persist ONLY its keyed digest, return the plaintext once.
 */
export async function mintScimConnectionCredential(
  engine: CredentialEngine,
  secret: string,
  input: MintScimConnectionCredentialInput,
): Promise<MintedScimConnectionCredential> {
  if (!input.connectionId) throw new Error('[scim] mint requires a connectionId');
  const token = SCIM_BEARER_PREFIX + randomBytes(32).toString('base64url');
  const row = await engine.insert(SCIM_CREDENTIAL_OBJECT, {
    connection_id: input.connectionId,
    provisioning_domain_id: input.provisioningDomainId,
    organization_id: input.organizationId,
    label: input.label,
    token_digest: digestScimBearerToken(secret, token),
    active: true,
    expires_at: input.expiresAt ? input.expiresAt.toISOString() : undefined,
    user_id: input.mintedByUserId,
  });
  return { token, credentialId: String(row.id) };
}

/**
 * The verification result shape `@better-auth/scim`'s
 * `SCIMResolvedConnectionVerificationResult` expects from an application-owned
 * verifier (spelled structurally so this module does not import the plugin's
 * types at runtime).
 */
export interface ScimBearerVerification {
  connection: { id: string; provisioningDomainId: string };
  credentialId: string;
  scopes: readonly ScimScope[];
  expiresAt?: Date;
}

/**
 * Application-owned bearer verification for the stable scim plugin: digest the
 * presented token, probe the credential store by digest (unique index), refuse
 * inactive or expired rows, and resolve the connection from the row.
 *
 * Returns `null` — upstream's "unauthenticated" — on any miss. Never throws on
 * a bad token: an unknown bearer is a 401, not a 500.
 */
export async function verifyScimBearerToken(
  engine: CredentialEngine,
  secret: string,
  token: string,
): Promise<ScimBearerVerification | null> {
  if (!token || typeof token !== 'string') return null;
  const digest = digestScimBearerToken(secret, token);
  let row: Record<string, unknown> | null;
  try {
    row = await engine.findOne(SCIM_CREDENTIAL_OBJECT, { where: { token_digest: digest } });
  } catch {
    // A storage fault reads as "cannot verify", never as "verified".
    return null;
  }
  if (!row) return null;
  // sqlite hands booleans back as 0/1 — refuse anything not affirmatively active.
  const active = (row as { active?: unknown }).active;
  if (active === false || active === 0 || active == null) return null;
  const rawExpiry = (row as { expires_at?: unknown }).expires_at;
  let expiresAt: Date | undefined;
  if (rawExpiry != null) {
    const parsed = new Date(rawExpiry as string);
    if (Number.isNaN(parsed.getTime())) return null; // unreadable expiry fails closed
    if (parsed.getTime() <= Date.now()) return null;
    expiresAt = parsed;
  }
  const connectionId = String((row as { connection_id?: unknown }).connection_id ?? '');
  if (!connectionId) return null;
  const domain = (row as { provisioning_domain_id?: unknown }).provisioning_domain_id;
  return {
    connection: {
      id: connectionId,
      provisioningDomainId: domain ? String(domain) : connectionId,
    },
    credentialId: String((row as { id?: unknown }).id),
    scopes: SCIM_ALL_SCOPES,
    ...(expiresAt ? { expiresAt } : {}),
  };
}
