// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which SCIM connection performed a write — the metadata key the audit writer
 * stamps on a SCIM-provisioned row, in one place.
 *
 * An identity provider (Okta, Entra ID) provisions, deactivates and
 * deprovisions users through the SCIM 2.0 endpoints, authenticated by a bearer
 * that `@objectstack/plugin-auth` verifies as one CONNECTION. No human acts, so
 * the row's `user_id` stays null. plugin-auth names the connection as the
 * write's service principal on the attribution-only `ExecutionContext.actor`,
 * spelled `svc:scim:CONNECTION_ID` (`scimServicePrincipal` in plugin-auth's
 * `scim-connection-service.ts`, the incumbent `svc:<name>` shape of ADR-0014
 * D2), and the engine hands it to hooks as `HookContext.session.actor`. The
 * writer records it on `sys_audit_log.actor`, as it does every service
 * principal, and ALSO under this key:
 *
 *  - `sys_audit_log.metadata.scim_connection_id` — the connection id alone, so
 *    an auditor (or the audit export) asks "which connection did this" of a
 *    named field rather than by parsing the label (ADR-0118 D5: "which
 *    non-user acted" is answered by an association field).
 *
 * One source, so the two never disagree: the key is READ OFF the label the
 * `actor` column carries, never off a second carrier. It is present only on a
 * row whose actor is a SCIM connection; the ABSENCE is the record that no SCIM
 * connection performed the write. Nothing in the authorization path reads it,
 * and neither the bearer nor its digest ever reaches the label.
 *
 * The prefix is spelled here rather than imported: this package does not
 * depend on `@objectstack/plugin-auth`. The two spellings are held equal by
 * plugin-auth's `scim-transaction-scope.test.ts` (the label its writes carry)
 * and this package's `audit-writers.test.ts` (the label this module reads).
 */

/** The `ExecutionContext.actor` prefix of a SCIM connection's service-principal label. */
export const SCIM_SERVICE_PRINCIPAL_PREFIX = 'svc:scim:';

/** The metadata key naming the SCIM connection that performed the write. */
export const SCIM_CONNECTION_ID_KEY = 'scim_connection_id';

/**
 * The SCIM connection a row's actor label names, or `undefined` when the actor
 * is not a SCIM connection (a user id, another service principal, or none).
 */
export function scimConnectionOf(actorLabel: string | null | undefined): string | undefined {
  if (typeof actorLabel !== 'string' || !actorLabel.startsWith(SCIM_SERVICE_PRINCIPAL_PREFIX)) return undefined;
  const connectionId = actorLabel.slice(SCIM_SERVICE_PRINCIPAL_PREFIX.length);
  return connectionId.length > 0 ? connectionId : undefined;
}
