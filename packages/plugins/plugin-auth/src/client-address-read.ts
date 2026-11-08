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

/** Answer the read for a caller the route's gate already admitted. */
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

// ───────────────────────────────────────────────────────────────────────────
// The organization administrator's read
// ───────────────────────────────────────────────────────────────────────────

/**
 * `GET /client-address` — the same answer, served to an ORGANIZATION
 * administrator before they save their organization's
 * `access_policy.allowed_ip_ranges` (ADR-0069 TL;DR 6).
 *
 * That list is judged against the very address {@link runClientAddressRead}
 * answers: the save check (`allowedIpRangesWritePredicate`, recovery off)
 * refuses a list that leaves out the saving request's address, and the
 * scoping hook judges a member's session by the address the HTTP door
 * established. The platform route above is gated to platform administrators,
 * so an organization administrator learned the address only from that
 * refusal. This route answers it before the save.
 *
 * ## Who may read it: whoever may save the list
 *
 * The caller's execution context, resolved by the platform's one composition
 * (`resolveRequestExecutionContext`) with the parameters the settings door
 * resolves a saving caller with, is judged by {@link judgeOrganizationAddressReader}:
 * no principal → `401 UNAUTHENTICATED`; a held session (ADR-0069 D3) → `403`
 * with the posture's own code; a caller without
 * {@link ORGANIZATION_CLIENT_ADDRESS_CAPABILITY} in their current organization
 * → `403 PERMISSION_DENIED`. `setup.write` is the `access_policy` manifest's
 * `writePermission`, so the caller this admits is the caller whose save the
 * address decides. ⛔ It answers the CALLER's own address only — there is no
 * parameter naming a user, a session or an organization, and the query set is
 * closed and empty.
 */
export const ORGANIZATION_CLIENT_ADDRESS_READ_PATH = '/client-address';

/** The capability the read demands in the caller's current organization: the `access_policy` manifest's `writePermission`. */
export const ORGANIZATION_CLIENT_ADDRESS_CAPABILITY = 'setup.write';

/** The slice of a resolved execution context the reader's gate reads. */
export interface OrganizationAddressReaderContext {
  /** System capabilities, resolved for the caller's current organization. */
  systemPermissions?: readonly string[];
  /** The ADR-0069 posture the composition resolved for the credential, when one holds the caller. */
  authGate?: unknown;
}

/** A refusal the gate answers, in the ADR-0112 envelope. */
export interface OrganizationAddressReaderRefusal {
  status: 401 | 403;
  body: { success: false; error: { code: string; message: string } };
}

const ORGANIZATION_ADDRESS_REFUSAL_MESSAGES = {
  401: 'Authentication required: sign in to read your client address.',
  403: 'Reading your client address requires the `setup.write` capability in your current organization: '
    + 'it is the address the organization\'s Allowed IP ranges are judged by, and only a caller who may save that list is told it.',
} as const;

/**
 * Judge the caller of {@link ORGANIZATION_CLIENT_ADDRESS_READ_PATH}: `null`
 * admits, a refusal refuses. `context` is the resolved execution context, or
 * `undefined` when the request resolved no principal. `heldRefusal` is the
 * ADR-0069 D3 judge (`judgeHeldSession`), handed in so this module keeps the
 * gate's one decision rather than a copy of it.
 */
export function judgeOrganizationAddressReader(
  context: OrganizationAddressReaderContext | undefined,
  heldRefusal: (carrier: { authGate?: unknown }) => { status: number; body: { success: false; error: { code: string; message: string } } } | null,
): OrganizationAddressReaderRefusal | null {
  if (!context) {
    return { status: 401, body: { success: false, error: { code: 'UNAUTHENTICATED', message: ORGANIZATION_ADDRESS_REFUSAL_MESSAGES[401] } } };
  }
  const held = context.authGate ? heldRefusal({ authGate: context.authGate }) : null;
  if (held) return { status: 403, body: held.body };
  const capabilities = Array.isArray(context.systemPermissions) ? context.systemPermissions : [];
  if (!capabilities.includes(ORGANIZATION_CLIENT_ADDRESS_CAPABILITY)) {
    return { status: 403, body: { success: false, error: { code: 'PERMISSION_DENIED', message: ORGANIZATION_ADDRESS_REFUSAL_MESSAGES[403] } } };
  }
  return null;
}
