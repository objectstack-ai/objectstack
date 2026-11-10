// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the OAuth consent page shows a person about the request it asks them
 * to approve, beyond the name the client gave itself:
 *
 *   POST /api/v1/auth/oauth-consent/request   { "oauth_query": "…" }
 *
 * `@better-auth/oauth-provider` sends the browser to the consent page with the
 * authorization request it validated at `/oauth2/authorize`, signed (`sig`,
 * `exp`). The page forwards that query verbatim to `/oauth2/consent`, which
 * checks the signature before it issues a code. The client's name and logo
 * are registration metadata the client chose, so they are not an identity a
 * person can check. This read answers the two facts that are:
 *
 *  - `redirectUri` — where a consent on this request sends the authorization
 *    code. It is read from the signed request only after the provider's own
 *    signature check (`verifyOAuthQueryParams`, the check the consent door
 *    runs), so it is the redirect `/oauth2/authorize` matched against the
 *    client's registered list, and the one `/oauth2/consent` will use. It is
 *    never read from the client's registration metadata or from anything the
 *    page sends beside the signed request.
 *  - `registeredAnonymously` — `true` when no account of this deployment
 *    registered the client: its stored row carries neither a `user_id` nor a
 *    `reference_id`. Every registration door that takes a session stamps the
 *    caller on the row (the Setup create action's
 *    `/sys-oauth-application/register`, `/oauth2/create-client`, and
 *    `/oauth2/register` called with a session); a dynamic registration made
 *    with no credential stamps nobody. Read from the stored row, never from a
 *    field the client declared. The page marks such a client unverified.
 *
 * Session-required, like the consent door and the public-client read the page
 * already makes. A request that names a client the provider no longer serves
 * (deleted or disabled) is `404`, as the public-client read answers it.
 *
 * ## The answer
 *
 * `200 { success: true, data: { clientId, redirectUri, registeredAnonymously } }`,
 * `Cache-Control: no-store`. Nothing else about the client is answered.
 *
 * ## Refusals (ADR-0112: code AND status)
 *
 *  - no session: `401 UNAUTHENTICATED`, before the body is read;
 *  - a held session: `403` with the posture's own code;
 *  - any query parameter: `400 VALIDATION_ERROR`;
 *  - a body declared as JSON that does not parse: `400 INVALID_REQUEST`;
 *  - a body that is not an object, carries a key other than `oauth_query`, or
 *    has no non-empty `oauth_query`: `400 VALIDATION_ERROR`;
 *  - a request this server did not sign, or whose signature has expired, or
 *    that does not name exactly one `client_id` and one `redirect_uri`:
 *    `400 VALIDATION_ERROR`;
 *  - a client the provider does not serve: `404 RESOURCE_NOT_FOUND`.
 */

import { unknownQueryParamRefusalMessage } from '@objectstack/rest';
import type { AuthSessionApi } from '@objectstack/spec/contracts';
import { inProcessSessionReadInput } from '@objectstack/types';
import { judgeHeldSession, PLATFORM_ADMIN_REFUSAL_MESSAGES } from './platform-admin-gate.js';
import { readJsonRequestBody } from './request-json-body.js';

/** The read, relative to the auth base path. */
export const OAUTH_CONSENT_REQUEST_PATH = '/oauth-consent/request';

/** The body's CLOSED key set. */
export const OAUTH_CONSENT_REQUEST_BODY_KEYS: readonly string[] = Object.freeze(['oauth_query']);

/** The refusal for a request this server did not sign, or signed and let expire. */
export const OAUTH_CONSENT_REQUEST_UNSIGNED_MESSAGE =
  'The authorization request is not one this server signed, or its signature has expired. Start the authorization again from the application.';

/** The refusal for a request naming a client the provider does not serve. */
export const OAUTH_CONSENT_REQUEST_CLIENT_NOT_FOUND_MESSAGE =
  'The application this authorization request names is not registered here, or it is disabled.';

export interface OAuthConsentRequestData {
  clientId: string;
  /** Where a consent on this request sends the authorization code. */
  redirectUri: string;
  /** `true` when no account of this deployment registered the client. */
  registeredAnonymously: boolean;
}

export interface OAuthConsentRequestResult {
  status: 200 | 400 | 401 | 403 | 404;
  body:
    | { success: true; data: OAuthConsentRequestData }
    | { success: false; error: { code: string; message: string } };
  headers: Record<string, string>;
}

/** What the in-process session read answers, as `AuthSessionApi` declares it. */
type SessionRead = Awaited<ReturnType<NonNullable<AuthSessionApi['getSession']>>>;

/** The stored client, as this read decodes it. */
export interface ConsentRequestClient {
  /** The registering account (`user_id`, else `reference_id`), `null` when none. */
  registeredBy: string | null;
  disabled: boolean;
}

/** The seams the read uses. {@link oauthConsentRequestDepsFor} wires the real ones. */
export interface OAuthConsentRequestDeps {
  /** The caller's session, `customSession`-decorated (`authGate`). */
  readCallerSession(headers: Headers): Promise<SessionRead | null>;
  /** Did this server sign `oauthQuery`, and is the signature unexpired? */
  verifySignedRequest(oauthQuery: string): Promise<boolean>;
  /** The stored client with this `client_id`, `null` when there is none. */
  readClient(clientId: string): Promise<ConsentRequestClient | null>;
}

/** The slice of `AuthManager` the real seams are built from. */
export interface OAuthConsentRequestManager {
  getApi(): Promise<unknown>;
  getAuthContext(): Promise<unknown>;
  getDataEngine(): unknown;
}

const SYSTEM_READ = { context: { isSystem: true, positions: [], permissions: [] } } as const;

const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' });

interface ReadEngine {
  find(object: string, query: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

const nonEmpty = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * The real seams. The signature is checked by the provider's own exported
 * `verifyOAuthQueryParams` under the auth instance's secret — the same check,
 * with the same secret, `/oauth2/consent` runs. The client is read under a
 * system context, named columns only, so no secret column is ever loaded.
 */
export function oauthConsentRequestDepsFor(manager: OAuthConsentRequestManager): OAuthConsentRequestDeps {
  return {
    async readCallerSession(headers) {
      const api = (await manager.getApi()) as { getSession(input: unknown): Promise<SessionRead | null> };
      return api.getSession(inProcessSessionReadInput(headers));
    },
    async verifySignedRequest(oauthQuery) {
      const authContext = (await manager.getAuthContext()) as { secret?: unknown } | undefined;
      const secret = authContext?.secret;
      if (typeof secret !== 'string' || !secret) return false;
      const { verifyOAuthQueryParams } = await import('@better-auth/oauth-provider');
      return verifyOAuthQueryParams(oauthQuery, secret);
    },
    async readClient(clientId) {
      const engine = manager.getDataEngine() as ReadEngine | undefined;
      if (!engine) throw new Error('The data engine is not available.');
      const found = await engine.find(
        'sys_oauth_application',
        {
          where: { client_id: clientId },
          fields: ['client_id', 'user_id', 'reference_id', 'disabled'],
          limit: 1,
        },
        SYSTEM_READ,
      );
      const row = Array.isArray(found) ? (found[0] as Record<string, unknown> | undefined) : undefined;
      if (!row) return null;
      return {
        registeredBy: nonEmpty(row.user_id) || nonEmpty(row.reference_id) || null,
        disabled: row.disabled === true || row.disabled === 1,
      };
    },
  };
}

const refusal = (
  status: 400 | 401 | 404,
  code: string,
  message: string,
): OAuthConsentRequestResult => ({
  status,
  body: { success: false, error: { code, message } },
  headers: { ...NO_STORE },
});

/** The one value `name` carries in the signed request, or `''` when it carries none or several. */
function singleParam(params: URLSearchParams, name: string): string {
  const values = params.getAll(name);
  return values.length === 1 ? nonEmpty(values[0]) : '';
}

/** `POST /oauth-consent/request` — see the module header. */
export async function runOAuthConsentRequestRead(
  deps: OAuthConsentRequestDeps,
  request: { raw: Request; queries: Record<string, readonly string[]> },
): Promise<OAuthConsentRequestResult> {
  const session = await deps.readCallerSession(request.raw.headers);
  const user = session?.user;
  const subject = user?.id == null ? '' : String(user.id);
  if (!subject) return refusal(401, 'UNAUTHENTICATED', PLATFORM_ADMIN_REFUSAL_MESSAGES[401]);

  const held = judgeHeldSession(user);
  if (held) return { status: held.status as 403, body: held.body, headers: { ...NO_STORE } };

  const unknownQuery = unknownQueryParamRefusalMessage(request.queries, []);
  if (unknownQuery !== undefined) return refusal(400, 'VALIDATION_ERROR', unknownQuery);

  const reading = await readJsonRequestBody(request.raw);
  if (!reading.ok) return refusal(400, 'INVALID_REQUEST', reading.message);
  const body = reading.body as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return refusal(400, 'VALIDATION_ERROR', 'The request body must be a JSON object carrying "oauth_query".');
  }
  const unknownKeys = Object.keys(body)
    .filter((key) => !OAUTH_CONSENT_REQUEST_BODY_KEYS.includes(key))
    .sort();
  if (unknownKeys.length) {
    return refusal(
      400,
      'VALIDATION_ERROR',
      `Unrecognized body key${unknownKeys.length > 1 ? 's' : ''} ${unknownKeys.map((k) => `"${k}"`).join(', ')}: `
        + 'this route takes "oauth_query" only.',
    );
  }
  const raw = (body as Record<string, unknown>).oauth_query;
  const oauthQuery = typeof raw === 'string' ? raw.trim().replace(/^\?/, '') : '';
  if (!oauthQuery) {
    return refusal(400, 'VALIDATION_ERROR', 'The "oauth_query" body key is required and must be a non-empty string.');
  }

  if (!(await deps.verifySignedRequest(oauthQuery))) {
    return refusal(400, 'VALIDATION_ERROR', OAUTH_CONSENT_REQUEST_UNSIGNED_MESSAGE);
  }
  const params = new URLSearchParams(oauthQuery);
  const clientId = singleParam(params, 'client_id');
  const redirectUri = singleParam(params, 'redirect_uri');
  if (!clientId || !redirectUri) {
    return refusal(
      400,
      'VALIDATION_ERROR',
      'The authorization request must name exactly one "client_id" and one "redirect_uri".',
    );
  }

  const client = await deps.readClient(clientId);
  if (!client || client.disabled) {
    return refusal(404, 'RESOURCE_NOT_FOUND', OAUTH_CONSENT_REQUEST_CLIENT_NOT_FOUND_MESSAGE);
  }
  return {
    status: 200,
    body: {
      success: true,
      data: { clientId, redirectUri, registeredAnonymously: client.registeredBy === null },
    },
    headers: { ...NO_STORE },
  };
}
