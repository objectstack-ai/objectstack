// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Revoking an MCP access token, through the OAuth consent the installed
 * provider already records (objectstack-ai/cloud#3606, ruling A).
 *
 * The ruling, verbatim:
 *
 * > 方案 A（推荐）： 以平台已有的「授权同意」记录为准。撤销或撤回时删掉这条记录，每次 MCP 请求都查一次，记录不在就拒绝。不新增对象、表或门禁，控制台的撤回也随之真正生效。代价是每次 MCP 请求多一次带索引的读取，撤销后用户下次连接要重新同意。
 *
 * An MCP access token is a JWT the provider signs and never stores, so there
 * is no token row to delete. The grant it was minted under IS stored: the
 * consent row (`oauthConsent`, `sys_oauth_consent`) keyed by client, user and
 * the organization the consent bound (`reference_id`, the token's
 * `organization_id` claim). So the consent is the revocable record:
 *
 *  - **The MCP door reads it on every request** ({@link mcpConsentAdmits},
 *    called by `verifyMcpAccessToken`). A token whose consent is gone, or
 *    whose consent was created after the token was issued (revoked, then
 *    granted again), verifies as no principal. A store error refuses too.
 *    `@objectstack/spec` `IAuthService.verifyMcpAccessToken` already says
 *    this: a falsy value when the token is revoked, and callers fail CLOSED.
 *  - **`/oauth2/revoke` deletes it** ({@link answerMcpTokenRevocation}) and
 *    revokes the grant's refresh family: the client's refresh tokens for that
 *    user, except those minted under another organization
 *    ({@link revokeMcpGrant}).
 *  - **The Console's withdraw** (`authorized-clients-withdraw.ts`, the own and
 *    the admin door) revokes a grant through {@link revokeMcpGrant} too, keyed
 *    by the consent id; the read above refuses on the next request.
 *
 * No object, table or gate is added. The costs the ruling accepts: one
 * indexed read per MCP request (`client_id` and `user_id` are both indexed
 * columns of the provider's schema), and after a revoke the person consents
 * again on the next connect.
 *
 * ## The revoke wrap runs AFTER the provider, and reads only its answer
 *
 * Client authentication on `/oauth2/revoke` stays the provider's and runs
 * first, unchanged: this module never authenticates a client. It acts on two
 * answers the provider gives only once the client has authenticated:
 *
 *  - `unsupported_token_type`: the provider found a JWT access token that
 *    verifies for this issuer and carries an `azp`, and says it cannot revoke
 *    it (`@better-auth/oauth-provider` 1.7.12, `revokeJwtAccessToken`). This
 *    module verifies the token itself as an MCP access token
 *    (`verifyMcpAccessTokenClaims`: signature against this deployment's key
 *    set, issuer, MCP audience, a delegated subject) and compares its `azp`
 *    with the client the provider authenticated. A match deletes the consent
 *    and the refresh family and answers 200. Another client's token answers
 *    a 200 that touches nothing (RFC 7009 section 2.1). A token that is not an
 *    MCP access token, or a server-only `skip_consent` client, which has no
 *    consent row to delete, keeps the provider's honest answer.
 *  - `invalid_request` with one of the provider's "this token is not one I
 *    know" descriptions ({@link UNKNOWN_TOKEN_DESCRIPTIONS}): the provider
 *    searched only where the `token_type_hint` pointed, and RFC 7009 section
 *    2.1 requires a hint that does not locate the token to widen the search
 *    to every token type the server supports. So this module looks for an MCP
 *    access token first, exactly as above (same client: revoked; another
 *    client: a 200 that touches nothing; a `skip_consent` client: the honest
 *    `unsupported_token_type`). Only a token that is not one answers 200 as
 *    unknown (RFC 7009 section 2.2). Every other `invalid_request` (a
 *    malformed request, a repeated parameter) and every `invalid_client`
 *    passes through unchanged.
 *
 * A store error while revoking answers 503 (RFC 7009 section 2.2.1: the
 * token still stands and the client may retry later), and a retry completes
 * the revoke, because every step is idempotent.
 *
 * Which client authenticated is read off the request in the provider's own
 * order (`extractClientCredentials`): a JWT client assertion's `sub`, else
 * the `Basic` credentials, else the one form `client_id`. The provider's
 * `unsupported_token_type` proves those credentials authenticated, so
 * reading the identifier they name is not a second authentication. A shape
 * this module cannot read the same way (an assertion type it does not know,
 * another authorization scheme) keeps the provider's answer.
 *
 * ⛔ Never move this wrap before the provider, and ⛔ never answer from it a
 * request the provider has not answered first.
 */

import { decodeJwt } from 'jose';
import {
  CLIENT_ASSERTION_TYPE,
  decodeBasicCredentials,
  stripAccessTokenAuthorizationScheme,
} from '@better-auth/core/oauth2';

/** The provider endpoint path (`betterAuthEndpointPath`) the wrap answers. */
export const OAUTH_REVOKE_PATH = '/oauth2/revoke';

/**
 * The `error_description` values `@better-auth/oauth-provider` 1.7.12 answers
 * on `/oauth2/revoke` with `invalid_request` AFTER the client authenticated,
 * when the token is one it does not know: `revokeAccessToken` ("Invalid access
 * token"), `revokeEndpoint` and `revokeRefreshToken` ("token not found"), and
 * a refresh token already revoked ("refresh token revoked").
 *
 * A closed list, so an answer outside it passes through: a provider bump that
 * rewords one of these keeps its 400 and the pin in
 * `mcp-token-revocation.test.ts` goes red, rather than a new refusal becoming
 * a 200 nobody chose.
 */
export const UNKNOWN_TOKEN_DESCRIPTIONS: ReadonlySet<string> = new Set([
  'Invalid access token',
  'token not found',
  'refresh token revoked',
]);

/** One `where` clause, in better-auth's adapter dialect. */
interface AdapterWhere {
  field: string;
  value: unknown;
  operator?: string;
}

/**
 * The part of better-auth's storage adapter (`$context.adapter`) this module
 * uses: the adapter the provider itself reads and writes these rows through,
 * so the model names and field mapping are the provider's own.
 */
export interface OAuthGrantStore {
  findOne(query: { model: string; where: AdapterWhere[] }): Promise<unknown>;
  findMany(query: { model: string; where: AdapterWhere[] }): Promise<unknown[]>;
  delete(query: { model: string; where: AdapterWhere[] }): Promise<unknown>;
  deleteMany(query: { model: string; where: AdapterWhere[] }): Promise<unknown>;
}

/** The grant a verified MCP access token was minted under. */
export interface McpGrantKey {
  /** The token's `azp`: the client the consent was given to. */
  clientId: string;
  /** The token's `sub`: the person who consented. */
  userId: string;
  /** The token's `organization_id` claim: the consent's `reference_id`. Absent ⇒ a consent with none. */
  organizationId?: string;
}

/**
 * A consent or refresh-token row as the adapter answers it (camelCase, the
 * provider's field names). Both models store the organization reference the
 * grant was made under in `referenceId`.
 */
interface GrantRow {
  id?: unknown;
  referenceId?: unknown;
  createdAt?: unknown;
}

/**
 * Whether a consent row is the one for this organization reference — the
 * provider's own rule (`findConsent`): with a reference, the row carrying
 * exactly it; without one, a row whose reference is missing, null or empty.
 */
function isConsentFor(row: GrantRow, organizationId: string | undefined): boolean {
  return organizationId ? row.referenceId === organizationId : !row.referenceId;
}

/**
 * Whether a refresh-token row is in the family a revoke of this organization
 * reference deletes: a row of the grant's own organization (the consent rule
 * above: the provider copies the consent's reference onto the authorization
 * code, the refresh token it starts and every rotation of it), AND every row
 * with no reference, whatever organization is revoked.
 *
 * ⛔ A row with no reference dies on every revoke of the client for that
 * person. Which grant it was minted under cannot be read off it (a row from
 * before consents bound an organization, or from any path that leaves the
 * reference unset, looks the same), so keeping it alive could leave the
 * withdrawn assistant a live refresh token: fail closed, as every revoke did
 * before refresh families were scoped. Only a row that names ANOTHER
 * organization is kept.
 */
function isRefreshFamilyRow(row: GrantRow, organizationId: string | undefined): boolean {
  return !row.referenceId || isConsentFor(row, organizationId);
}

/** The rows of `model` for (client, user) that `belongs` admits for the grant's organization. */
async function grantRowsOf(
  store: OAuthGrantStore,
  model: string,
  grant: McpGrantKey,
  belongs: (row: GrantRow, organizationId: string | undefined) => boolean,
): Promise<GrantRow[]> {
  const rows = await store.findMany({
    model,
    where: [
      { field: 'clientId', value: grant.clientId },
      { field: 'userId', value: grant.userId },
    ],
  });
  return (Array.isArray(rows) ? rows : []).filter(
    (row): row is GrantRow => !!row && typeof row === 'object' && belongs(row as GrantRow, grant.organizationId),
  );
}

const consentsOf = (store: OAuthGrantStore, grant: McpGrantKey) =>
  grantRowsOf(store, 'oauthConsent', grant, isConsentFor);

/** Whether the client is a server-only `skip_consent` client: one that never has a consent row. */
async function isSkipConsentClient(store: OAuthGrantStore, clientId: string): Promise<boolean> {
  const client = (await store.findOne({
    model: 'oauthClient',
    where: [{ field: 'clientId', value: clientId }],
  })) as { skipConsent?: unknown } | null;
  return client?.skipConsent === true;
}

/**
 * The consent read the MCP door makes on every request: does the grant a
 * verified token was minted under still stand?
 *
 * Admits when the consent for (`azp`, `sub`, organization) exists and was
 * created no later than the token was issued (compared in whole seconds, the
 * unit of `iat`). Refuses when it is missing, when it is newer than the token
 * (revoked and granted again: the old token belongs to the old grant), when
 * `iat` or the row's `createdAt` cannot be read, and when there is no store.
 * A store error propagates, and the verifier answers it as a refusal.
 *
 * One indexed read for a client that consents. Only when that read finds no
 * consent is the client read, so that a server-only `skip_consent` client,
 * which has no consent row at all, is admitted (ruling A, step 5).
 */
export async function mcpConsentAdmits(
  store: OAuthGrantStore | undefined,
  grant: McpGrantKey,
  issuedAt: number | undefined,
): Promise<boolean> {
  if (!store) return false;
  const [consent] = await consentsOf(store, grant);
  if (!consent) return isSkipConsentClient(store, grant.clientId);
  if (typeof issuedAt !== 'number' || !Number.isFinite(issuedAt)) return false;
  const createdAtMs =
    consent.createdAt instanceof Date || typeof consent.createdAt === 'string' || typeof consent.createdAt === 'number'
      ? new Date(consent.createdAt).getTime()
      : Number.NaN;
  if (!Number.isFinite(createdAtMs)) return false;
  return Math.floor(createdAtMs / 1000) <= issuedAt;
}

/**
 * How many times {@link revokeMcpGrant} reads and deletes the refresh family.
 * The second read finds the row a rotation racing the first pass wrote: that
 * rotation started from a row the first read returned and wrote its successor
 * after the read. A rotation needs a live row to start from, and the first
 * pass deletes every row it read, so a rotation that starts after it finds
 * none. The provider's own family delete, by filter, catches a successor
 * written before its delete runs; the second read runs later than that.
 */
const REFRESH_FAMILY_PASSES = 2;

/**
 * Revokes the grant: deletes the consent for (client, user, organization),
 * then that grant's refresh family — the client's refresh tokens for that
 * user that name no other organization, and the opaque access tokens
 * minted from them, as the provider's own `invalidateRefreshFamily` does for
 * a whole (client, user) pair. The consent goes first because it is what the
 * MCP door reads; a failure after it leaves the access token already refused,
 * and the client's retry finishes the rest (every step is idempotent).
 *
 * ⛔ A person can authorize the same client in two organizations: withdrawing
 * it in one must not sign the client out of the other, so a refresh row that
 * names another organization is kept. Every row this grant minted is deleted,
 * and so is every row with no reference ({@link isRefreshFamilyRow}).
 */
export async function revokeMcpGrant(store: OAuthGrantStore, grant: McpGrantKey): Promise<void> {
  for (const consent of await consentsOf(store, grant)) {
    await store.delete({ model: 'oauthConsent', where: [{ field: 'id', value: consent.id }] });
  }
  for (let pass = 0; pass < REFRESH_FAMILY_PASSES; pass += 1) {
    const refreshIds = (await grantRowsOf(store, 'oauthRefreshToken', grant, isRefreshFamilyRow))
      .map((row) => row.id)
      .filter((id) => id !== undefined && id !== null);
    if (!refreshIds.length) return;
    await store.deleteMany({
      model: 'oauthAccessToken',
      where: [{ field: 'refreshId', operator: 'in', value: refreshIds }],
    });
    await store.deleteMany({
      model: 'oauthRefreshToken',
      where: [{ field: 'id', operator: 'in', value: refreshIds }],
    });
  }
}

/**
 * The client the provider authenticated, read off the request in the
 * provider's own order (`extractClientCredentials`, 1.7.12): a JWT client
 * assertion names it in `sub` (else `iss`), else `Basic` credentials name it,
 * else the one form `client_id` does. `undefined` when the request is a shape
 * this function cannot read the way the provider did.
 */
export function authenticatedClientIdOf(request: Request, form: URLSearchParams): string | undefined {
  const single = (name: string): string | undefined => {
    const values = form.getAll(name).filter((value) => value.length > 0);
    return values.length === 1 ? values[0] : undefined;
  };
  const assertion = single('client_assertion');
  const assertionType = single('client_assertion_type');
  if (form.getAll('client_assertion').some(Boolean) || form.getAll('client_assertion_type').some(Boolean)) {
    if (!assertion || assertionType !== CLIENT_ASSERTION_TYPE) return undefined;
    try {
      const claims = decodeJwt(assertion);
      const id = claims.sub ?? claims.iss;
      return typeof id === 'string' && id ? id : undefined;
    } catch {
      return undefined;
    }
  }
  const authorization = request.headers.get('authorization');
  if (authorization) {
    if (!/^Basic +/i.test(authorization)) return undefined;
    try {
      return decodeBasicCredentials(authorization).clientId || undefined;
    } catch {
      return undefined;
    }
  }
  return single('client_id');
}

/** What the revoke wrap needs from the manager. */
export interface McpTokenRevocationDeps {
  /**
   * The verified grant of an MCP access token, WITHOUT the consent read
   * (`verifyMcpAccessTokenClaims`): a revoke must still find the grant of a
   * token whose consent is already gone. `null` when the token is not an MCP
   * access token of this deployment.
   */
  verifyClaims(token: string): Promise<McpGrantKey | null>;
  /** better-auth's storage adapter; `undefined` when the instance has none. */
  getStore(): Promise<OAuthGrantStore | undefined>;
}

/** The provider's own success answer: `200` and the JSON `null` (its endpoint returns `null`). */
function revoked(vendor: Response): Response {
  const headers = new Headers(vendor.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json');
  return new Response('null', { status: 200, headers });
}

/** A JSON OAuth error answer, never cached. */
function oauthError(status: number, error: string, description: string): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * The `/oauth2/revoke` answer, given the request (unread) and the provider's
 * response to it. See the module header for each branch.
 */
export async function answerMcpTokenRevocation(
  deps: McpTokenRevocationDeps,
  request: Request,
  vendor: Response,
): Promise<Response> {
  if (vendor.status !== 400) return vendor;
  let refusal: { error?: unknown; error_description?: unknown } | null;
  try {
    refusal = (await vendor.clone().json()) as typeof refusal;
  } catch {
    return vendor;
  }
  const unknownToProvider =
    refusal?.error === 'invalid_request'
    && typeof refusal.error_description === 'string'
    && UNKNOWN_TOKEN_DESCRIPTIONS.has(refusal.error_description);
  if (!unknownToProvider && refusal?.error !== 'unsupported_token_type') return vendor;
  // What a token that is not an MCP access token of this deployment is
  // answered: unknown to the provider too → 200 (RFC 7009 §2.2); otherwise
  // the provider's own answer.
  const notMcpToken = unknownToProvider ? revoked(vendor) : vendor;

  if (!(request.headers.get('content-type') ?? '').toLowerCase().includes('application/x-www-form-urlencoded')) {
    return notMcpToken;
  }
  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return notMcpToken;
  }
  const raw = form.get('token');
  if (!raw) return notMcpToken;
  // RFC 7009 §2.1: a hint that did not locate the token does not end the
  // search, so an MCP access token is looked for whatever the hint said.
  const grant = await deps.verifyClaims(stripAccessTokenAuthorizationScheme(raw));
  if (!grant) return notMcpToken;
  // A verified token whose client this module cannot read off the request is
  // never answered 200: that would claim a revoke that did not happen.
  const clientId = authenticatedClientIdOf(request, form);
  if (!clientId) return vendor;
  // Another client's token: nothing of the owner's is touched (RFC 7009 §2.1).
  if (grant.clientId !== clientId) return revoked(vendor);

  try {
    const store = await deps.getStore();
    if (!store) throw new Error('better-auth exposes no storage adapter');
    if (await isSkipConsentClient(store, clientId)) {
      return unknownToProvider
        ? oauthError(400, 'unsupported_token_type', 'JWT access tokens are self-contained and cannot be revoked server-side')
        : vendor;
    }
    await revokeMcpGrant(store, grant);
  } catch {
    // Handed to the caller, never swallowed: RFC 7009 §2.2.1's 503 tells the
    // client the token still stands and to retry (every step above is
    // idempotent), and `handleRequest` logs it with its body as it logs every
    // 5xx.
    return oauthError(503, 'server_error', 'the grant could not be revoked; retry the request');
  }
  return revoked(vendor);
}
