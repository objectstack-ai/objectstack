// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /api/v1/auth/oauth2/client-name?client_id=CLIENT_ID&oauth_query=SIGNED_QUERY`
 * — the name of the application a sign-in hand-off is for.
 *
 * When an application sends a person here to sign in (`/oauth2/authorize`
 * with no session), the provider redirects the browser to the Console's
 * sign-in page with the authorization request on the URL, signed by this
 * server (`sig`, `exp`). The sign-in page reads the client name only for the
 * client its signed request names, so it can say "Sign in to continue to
 * NAME" instead of a bare host. This route is that one read, and nothing
 * wider:
 *
 *  - **Admitted by the signed request.** `oauth_query` must carry a signature
 *    this server made and that has not expired, verified by the provider's own
 *    `verifyOAuthQueryParams` against the auth secret. The session is never
 *    read, so a signed-in caller gets the same answer.
 *  - **One client: the one the signed request names.** The client is the
 *    single `client_id` inside the verified request. `client_id` on the URL is
 *    only a check against it: when the two differ, nothing is read.
 *  - **One field.** `{ client_name }` and nothing else of the client.
 *  - **One refusal.** A request whose signature does not verify or has
 *    expired, a `client_id` that is not the one the signed request names, an
 *    unknown client, a disabled client and a client with no name all answer
 *    the same `404` ({@link OAUTH_CLIENT_NAME_NOT_FOUND}), so the answer tells
 *    no two of them apart.
 *
 * A malformed request (a parameter outside the closed set, a repeated one, a
 * missing one) answers `400`: it is not a state of a client.
 *
 * Mounted by `auth-plugin.ts` ahead of the catch-all and ledgered in
 * `auth-route-ledger.ts`.
 */

import { repeatedQueryParamMessage, unknownQueryParamRefusalMessage } from '@objectstack/rest';
import { withSystemContext } from './objectql-adapter.js';

/** The route under the auth base path. */
export const OAUTH_CLIENT_NAME_PATH = '/oauth2/client-name';

/** The route's CLOSED query-parameter set. */
export const OAUTH_CLIENT_NAME_QUERY_PARAMS: readonly string[] = ['client_id', 'oauth_query'];

/** The one answer for every request that is not served a name. */
export const OAUTH_CLIENT_NAME_NOT_FOUND = {
  success: false,
  error: {
    code: 'RESOURCE_NOT_FOUND',
    message: 'No application name is available for this sign-in.',
  },
} as const;

export interface OAuthClientNameAnswer {
  status: 200 | 400 | 404 | 500;
  body: unknown;
  headers: Record<string, string>;
}

/** The slice of the data engine this read needs. */
export interface OAuthClientNameEngine {
  findOne(object: string, query?: unknown): Promise<unknown>;
}

export interface OAuthClientNameDeps {
  /** The better-auth context: its `secret` signed the request. */
  getAuthContext(): Promise<{ secret?: unknown } | undefined>;
  getDataEngine(): OAuthClientNameEngine | undefined;
}

export interface OAuthClientNameRequest {
  /** Every query parameter as the transport parsed it, each name with all its values. */
  queries: Record<string, readonly string[]>;
}

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const notFound = (): OAuthClientNameAnswer => ({ status: 404, body: OAUTH_CLIENT_NAME_NOT_FOUND, headers: { ...NO_STORE } });

function refusal(status: 400 | 500, code: string, message: string): OAuthClientNameAnswer {
  return { status, body: { success: false, error: { code, message } }, headers: { ...NO_STORE } };
}

/** The one value of a parameter, or a `400` answer. */
function single(queries: Record<string, readonly string[]>, name: string): string | OAuthClientNameAnswer {
  const values = queries[name] ?? [];
  if (values.length > 1) return refusal(400, 'VALIDATION_ERROR', repeatedQueryParamMessage(name, values.length));
  const value = (values[0] ?? '').trim();
  if (!value) return refusal(400, 'VALIDATION_ERROR', `The "${name}" query parameter is required.`);
  return value;
}

/** The body of the route; `auth-plugin.ts` mounts it and writes what it returns. */
export async function answerOAuthClientName(
  request: OAuthClientNameRequest,
  deps: OAuthClientNameDeps,
): Promise<OAuthClientNameAnswer> {
  const unknown = unknownQueryParamRefusalMessage(request.queries, OAUTH_CLIENT_NAME_QUERY_PARAMS);
  if (unknown !== undefined) return refusal(400, 'VALIDATION_ERROR', unknown);
  const asked = single(request.queries, 'client_id');
  if (typeof asked !== 'string') return asked;
  const oauthQuery = single(request.queries, 'oauth_query');
  if (typeof oauthQuery !== 'string') return oauthQuery;

  const authContext = await deps.getAuthContext();
  const secret = authContext?.secret;
  const engine = deps.getDataEngine();
  if (typeof secret !== 'string' || !secret || !engine) {
    return refusal(500, 'INTERNAL_ERROR', 'The application name is unavailable.');
  }

  // The provider's own verification: this server's signature, not expired.
  const { verifyOAuthQueryParams } = await import('@better-auth/oauth-provider');
  if (!(await verifyOAuthQueryParams(oauthQuery, secret))) return notFound();

  // The client is the one the signed request names; the URL's `client_id`
  // only has to agree with it.
  const named = new URLSearchParams(oauthQuery).getAll('client_id');
  if (named.length !== 1 || named[0] !== asked) return notFound();

  const sys = withSystemContext(engine as never) as unknown as OAuthClientNameEngine;
  const client = (await sys.findOne('sys_oauth_application', {
    where: { client_id: named[0] },
    fields: ['client_id', 'name', 'disabled'],
  })) as Record<string, unknown> | null;
  if (!client || client.disabled === true || client.disabled === 1) return notFound();
  const name = typeof client.name === 'string' ? client.name.trim() : '';
  if (!name) return notFound();

  return { status: 200, body: { success: true, data: { client_name: name } }, headers: { ...NO_STORE } };
}
