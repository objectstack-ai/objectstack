// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30398] `GET /admin/client-address` — the caller's address as the
 * `auth.allowed_ip_ranges` save check and the ADR-0069 D5 sign-in gate judge
 * it, served to an administrator BEFORE a save.
 *
 * Without it the only way to learn that address was to be refused: the save
 * check names it in its refusal (`constraint.clientAddress`), after the fact.
 * The console's Authentication settings page reads this route to show it beside
 * the Allowed IP ranges field. ⛔ A client never works its own address out:
 * behind a proxy the address it can see is not the one the server judges, and
 * `server.trustProxy` decides which one counts.
 *
 * ## One reading of the address
 *
 * `clientAddress` is {@link judgedClientAddress}, the very call the save check
 * makes (`allowed-ip-ranges.ts`), on the two facts every auth mount hands the
 * rule: the request's headers and the transport's peer address. So the address
 * shown is the address a save from the same connection is judged by. It is
 * `null` when the server cannot establish an address; while any list is set,
 * such a request is refused at the gate, and any non-empty list at the save.
 * `trustProxy` says whether forwarded headers counted
 * (`AuthManager.trustsForwardedHeaders`).
 *
 * ## Who may read it
 *
 * The ADR-0068 D2 platform-admin gate every ObjectStack `/admin/*` mount calls
 * (`gateAdmin` in `auth-plugin.ts`, the judge in `platform-admin-gate.ts`),
 * asked before this module runs: no session → `401`, a held session (ADR-0069
 * D3) → `403` with the posture's own code, any other caller who is not a
 * platform admin → `403`. The setting this informs lives in the `auth` settings
 * namespace, written on `manage_platform_settings`, a platform-exclusive
 * capability (`admin_full_access` carries it, `organization_admin` withholds
 * it). ⛔ Not on the anonymous `GET /config`: an address echo is not served to a
 * caller with no session.
 *
 * The route sits under the auth mount, so the D5 gate runs ahead of it like it
 * does for every auth route but the sign-in page's two render reads: a caller
 * whose address is outside the list already in force is refused there with
 * `403 IP_NOT_ALLOWED`.
 *
 * ## The answer
 *
 * `200 { success: true, data: { clientAddress, trustProxy } }` with
 * `Cache-Control: no-store`: it describes one connection, and no cache may hand
 * it to another. The query set is closed and empty, so any query parameter is
 * refused with `400 VALIDATION_ERROR`. No body is read.
 */

import { unknownQueryParamRefusalMessage } from '@objectstack/rest';
import { judgedClientAddress, type RequestTransport } from './allowed-ip-ranges.js';
import type { AuthManager } from './auth-manager.js';

/** The route under the auth base path. */
export const CLIENT_ADDRESS_READ_PATH = '/admin/client-address';

/** The route's CLOSED query-parameter set: the handler reads none. */
export const CLIENT_ADDRESS_READ_QUERY_PARAMS: readonly string[] = Object.freeze([]);

/** What the read serves. */
export interface ClientAddressReadData {
  /** The address the allow-list judges for this connection, `null` when none can be established. */
  clientAddress: string | null;
  /** Whether this deployment declares `server.trustProxy`, so forwarded headers counted. */
  trustProxy: boolean;
}

/** The request facts the read needs, as the raw mount gathers them. */
export interface ClientAddressReadRequest {
  /** The parsed query, every value as the list of its occurrences. */
  queries: Record<string, readonly string[]>;
  /** The request's headers and the transport's peer address. */
  transport: RequestTransport;
}

export interface ClientAddressReadAnswer {
  status: 200 | 400;
  body:
    | { success: true; data: ClientAddressReadData }
    | { success: false; error: { code: 'VALIDATION_ERROR'; message: string } };
  headers: Record<string, string>;
}

/** Answer the read for a caller the platform-admin gate already admitted. */
export function runClientAddressRead(
  manager: Pick<AuthManager, 'resolveClientAddress' | 'trustsForwardedHeaders'>,
  request: ClientAddressReadRequest,
): ClientAddressReadAnswer {
  const headers = { 'Cache-Control': 'no-store' };
  const unknown = unknownQueryParamRefusalMessage(request.queries, CLIENT_ADDRESS_READ_QUERY_PARAMS);
  if (unknown !== undefined) {
    return { status: 400, body: { success: false, error: { code: 'VALIDATION_ERROR', message: unknown } }, headers };
  }
  return {
    status: 200,
    body: {
      success: true,
      data: {
        clientAddress: judgedClientAddress(manager, request.transport) ?? null,
        trustProxy: manager.trustsForwardedHeaders(),
      },
    },
    headers,
  };
}
