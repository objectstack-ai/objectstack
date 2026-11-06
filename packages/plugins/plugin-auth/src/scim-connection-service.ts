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
 * request". Opened by `AuthManager.handleRequest` with `run(...)` around every
 * request whose better-auth endpoint path is under `/scim/v2`, so it holds
 * for that request's whole async chain — the endpoint handler and the
 * provisioning writes the plugin performs inside it.
 *
 * ⛔ Not `enterWith`, and not from inside the `verifyBearerToken` callback:
 * that is where it used to be stamped, and the store never reached the
 * writes. An `enterWith` marks only the async resource it runs in and that
 * resource's descendants; the vendor awaits the verifier from the endpoint's
 * own frame and resumes the handler from a continuation captured before the
 * verifier ran. Measured 2026-09-02 (#14624) on the then-installed
 * `@better-auth/scim` 1.7.2: zero `engine.transaction` calls across
 * `POST /Users` + `PATCH /Users/{id}`, `inScimRequestScope()` false inside
 * every identity write. ⛔ Deliberately anchored rather than restamped to the
 * lifted family: that reading is an ABLATION of the design that was REJECTED,
 * and re-running it would mean re-breaking the scope to watch it fail. What
 * ships is pinned at run time against whatever version is installed, by
 * `scim-transaction-scope.test.ts`. `run(...)` has a callback boundary; every
 * `als.run` the vendor performs underneath nests inside it.
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
 *
 * The store also carries the request's ATTRIBUTION slot — see
 * {@link ScimRequestScope.connectionId}.
 */
export const scimRequestScope = new AsyncLocalStorage<ScimRequestScope>();

/**
 * One SCIM protocol request's scope: opened empty by `handleRequest`, its
 * `connectionId` filled in once by the bearer verifier.
 */
export interface ScimRequestScope {
  scim: true;
  /**
   * The SCIM connection this request's bearer verified as — the IdP that is
   * acting. Recorded by {@link recordScimRequestConnection} from inside the
   * `verifyBearerToken` callback; read by {@link scimRequestConnectionId} when
   * the adapter builds each write's context (`authSystemWriteContext`), so
   * every provisioning write of the request — the `sys_user` create, the
   * deactivation's ban update, `sys_member`, `sys_scim_*` — is attributed to
   * the connection.
   *
   * Why a MUTABLE slot on a store `handleRequest` already opened, and not a
   * new store: the verifier runs in a continuation the endpoint handler does
   * not descend from (the `enterWith` note above, measured). A store the
   * verifier opened or entered never reaches the writes. The object opened
   * here, though, is the store of BOTH frames — the verifier's and the
   * handler's — because both run inside the one `run(...)`; writing a field
   * on it is seen by every later read in the request. Each request gets its
   * own object from its own `run(...)`, so two concurrent requests on two
   * connections never see each other's slot (pinned by
   * `scim-transaction-scope.test.ts`, the attribution block).
   *
   * Only the connection id is kept. The bearer, its digest and the credential
   * row are never placed here, so no write context can carry them.
   */
  connectionId?: string;
}

/** Is the current async chain inside an authenticated SCIM protocol request? */
export function inScimRequestScope(): boolean {
  return scimRequestScope.getStore()?.scim === true;
}

/**
 * Record the connection a SCIM bearer verified as on the current request's
 * scope, and hand the verification back unchanged.
 *
 * A no-op outside a SCIM request scope, on a failed verification (`null`), and
 * once a connection is already recorded: the first verified connection of a
 * request is the one its writes are attributed to, so a later call cannot
 * re-attribute writes already in flight.
 */
export function recordScimRequestConnection<T extends ScimBearerVerification | null>(verification: T): T {
  const scope = scimRequestScope.getStore();
  if (scope?.scim === true && verification && scope.connectionId === undefined) {
    scope.connectionId = verification.connection.id;
  }
  return verification;
}

/** The connection the current SCIM request's bearer verified as, or `undefined`. */
export function scimRequestConnectionId(): string | undefined {
  const scope = scimRequestScope.getStore();
  return scope?.scim === true ? scope.connectionId : undefined;
}

/**
 * The service-principal label of a SCIM connection, as it lands on
 * `ExecutionContext.actor` and from there on `sys_audit_log.actor`.
 *
 * `svc:scim:CONNECTION_ID` — the incumbent `svc:<name>` shape
 * (`ExecutionContext.actor`, ADR-0014 D2) with the kind segment first, the way
 * an automation run is `svc:flow:FLOW_NAME`. The connection id is the
 * identifier and not a display name: it is immutable, it scopes every resource
 * the connection provisions, it is what `sys_scim_connection_binding` and
 * `sys_scim_connection_credential` are keyed by, and the credential row holds
 * no connection name to use instead (its `label` names one credential, which a
 * rotation replaces). The audit writer also records the id on its own, as
 * `metadata.scim_connection_id` (ADR-0118 D5's association field).
 */
export function scimServicePrincipal(connectionId: string): string {
  return `${SCIM_SERVICE_PRINCIPAL_PREFIX}${connectionId}`;
}

/** The `ExecutionContext.actor` prefix every SCIM connection's label starts with. */
export const SCIM_SERVICE_PRINCIPAL_PREFIX = 'svc:scim:';

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
  findOne(
    object: string,
    query: { where: Record<string, unknown> },
    options?: { context?: { isSystem?: boolean } },
  ): Promise<Record<string, unknown> | null>;
}

/**
 * The credential probe's execution context: the explicit system opt-in. The
 * verifier runs BEFORE any caller is known — the bearer it is verifying is the
 * only identity on the request — so there is no principal to carry, and the
 * read must say so rather than reach the engine with no principal and no
 * opt-in (the security middleware's former principal-less hand-off, which
 * ADR-0096 D5 replaced with a refusal). The
 * digest equality in the `where` is the whole of what the probe may match.
 */
const CREDENTIAL_PROBE_CONTEXT = { context: { isSystem: true } } as const;

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
    row = await engine.findOne(SCIM_CREDENTIAL_OBJECT, { where: { token_digest: digest } }, CREDENTIAL_PROBE_CONTEXT);
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

/** Minimal engine surface {@link revokeScimConnectionCredential} needs. */
interface RevocationEngine {
  findOne(
    object: string,
    query: { where: Record<string, unknown>; fields?: string[] },
    options?: { context?: { isSystem?: boolean } },
  ): Promise<Record<string, unknown> | null>;
  update(object: string, data: Record<string, unknown>, options?: { context?: { isSystem?: boolean } }): Promise<unknown>;
}

/** What {@link revokeScimConnectionCredential} found and did. */
export type ScimCredentialRevocation =
  | { outcome: 'revoked'; credentialId: string; connectionId: string }
  | { outcome: 'already_revoked'; credentialId: string; connectionId: string }
  | { outcome: 'not_found' };

/**
 * Revoke one credential (#30958): switch its row's `active` off — the switch
 * {@link verifyScimBearerToken} refuses on — so its bearer is refused from the
 * next SCIM request on. The row is kept (its digest is one-way; the audit
 * trail and the staged-rotation history point at it). Rotation is a second
 * {@link mintScimConnectionCredential} for the same `connectionId` followed by
 * this. A row already inactive is reported as such and not written again.
 */
export async function revokeScimConnectionCredential(
  engine: RevocationEngine,
  credentialId: string,
): Promise<ScimCredentialRevocation> {
  const row = await engine.findOne(
    SCIM_CREDENTIAL_OBJECT,
    { where: { id: credentialId }, fields: ['id', 'connection_id', 'active'] },
    CREDENTIAL_PROBE_CONTEXT,
  );
  if (!row) return { outcome: 'not_found' };
  const connectionId = String((row as { connection_id?: unknown }).connection_id ?? '');
  const id = String((row as { id?: unknown }).id);
  // Read `active` the way the verifier does: anything not affirmatively active is off.
  const active = (row as { active?: unknown }).active;
  if (active === false || active === 0 || active == null) return { outcome: 'already_revoked', credentialId: id, connectionId };
  // The system context is spelled at the call, not only inherited from the
  // caller's wrapped engine, so the write says what it is wherever it is read.
  await engine.update(SCIM_CREDENTIAL_OBJECT, { id, active: false }, { context: { isSystem: true } });
  return { outcome: 'revoked', credentialId: id, connectionId };
}
