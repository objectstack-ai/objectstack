// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0138 D4 — the refusal an anonymous request meets where it needs an
 * organization the deployment cannot resolve for it.
 *
 * ## The rule
 *
 * A guest-entry door with no declared organization binding of its own resolves
 * the guest's organization on the server, never from anything the client
 * sends: when the deployment holds exactly one organization the guest acts in
 * it, and otherwise the request is refused, loudly, naming the missing site
 * binding (ADR-0138 D5) — never answered by a silent pick. The decision is
 * `resolveSystemWriteOrganization`'s (ADR-0131 D9), asked by
 * `resolveGuestOrganization` (`resolve-authz-context.ts`), "never a second
 * spelling of it" (D4 item 2).
 *
 * ## Where it is raised, and why not at the entry
 *
 * The runtime face assembles the guest envelope for EVERY sessionless request
 * it serves, before any route is matched — the domains that answer 401 to an
 * anonymous caller included. Refusing there would turn every one of those 401s
 * into this refusal on a multi-organization deployment, and would reach the
 * flow door (D2 class 5), which D4 item 3 leaves untouched: a flow runs under
 * its own declared posture. So the entry records nothing it cannot use — no
 * organization, no set — and the refusal is raised where the guest's
 * organization MATTERS: the CRUD gate the guest's data operation reaches
 * (`SecurityPlugin.resolveOperationPrincipals`), before any grant is resolved
 * (D3 item 7: where D4 refuses, D3 is never reached).
 *
 * ## The code
 *
 * `NOT_IMPLEMENTED` (501), a member of the ADR-0112 standard catalog, as D4
 * requires. The request is not malformed and the caller cannot repair it — D4
 * forbids taking the organization from anything the client sends, so no
 * 4xx-shaped invitation to "supply a precondition" fits — and it is not an
 * outage: the deployment lacks a capability that is not built yet, the site
 * binding (D5, "built when demand arrives"). `PERMISSION_DENIED` would make the
 * refusal indistinguishable from an ungranted guest, which is exactly what the
 * located refusal exists to stop.
 *
 * ## What the caller is told
 *
 * The message names the missing site binding and the two ways to serve the
 * door, and nothing about the deployment: no organization count and no posture
 * name reach an anonymous caller (ADR-0138: door-level readings stay private).
 */

/** ADR-0112 standard-catalog member the refusal answers with. */
export const GUEST_ORGANIZATION_UNRESOLVED_CODE = 'NOT_IMPLEMENTED' as const;

/** HTTP status a transport answers the refusal with. */
export const GUEST_ORGANIZATION_UNRESOLVED_STATUS = 501 as const;

/** The caller-facing sentence: the missing site binding, and the remedies. */
export const GUEST_ORGANIZATION_UNRESOLVED_MESSAGE =
  'This endpoint serves anonymous callers in the organization the server resolves for them, and this '
  + 'deployment does not resolve one: an anonymous request acts in an organization only on a deployment '
  + 'that holds exactly one (ADR-0138 D4), and no site binding maps a request to an organization of its '
  + 'own yet (ADR-0138 D5). Nothing was read or written. Call this endpoint signed in, or serve it from a '
  + 'single-organization deployment.';

/**
 * Why the deployment resolves no organization for the guest — the
 * `refuse` reasons of `resolveSystemWriteOrganization`. Server-side only.
 */
export type GuestOrganizationRefusalReason = 'walled-posture' | 'ambiguous-organization' | 'no-organization';

/**
 * ADR-0138 D4's located refusal. Identified by {@link isGuestOrganizationUnresolvedError}
 * (a `code` and `reason` compare), never `instanceof`, so it survives a package
 * boundary where two copies of this module can exist.
 */
export class GuestOrganizationUnresolvedError extends Error {
  /** ADR-0112 wire code. */
  readonly code = GUEST_ORGANIZATION_UNRESOLVED_CODE;
  /** HTTP status a transport should answer — the spelling the HTTP doors read. */
  readonly status = GUEST_ORGANIZATION_UNRESOLVED_STATUS;
  /** The same number under ADR-0112 D5's spelling. */
  readonly httpStatus = GUEST_ORGANIZATION_UNRESOLVED_STATUS;
  /** Why no organization resolved — for the server's own log, never the wire. */
  readonly reason: GuestOrganizationRefusalReason;

  constructor(reason: GuestOrganizationRefusalReason) {
    super(GUEST_ORGANIZATION_UNRESOLVED_MESSAGE);
    this.name = 'GuestOrganizationUnresolvedError';
    this.reason = reason;
  }
}

/** True when `err` is ADR-0138 D4's located refusal. */
export function isGuestOrganizationUnresolvedError(err: unknown): err is GuestOrganizationUnresolvedError {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; name?: unknown };
  return e.code === GUEST_ORGANIZATION_UNRESOLVED_CODE && e.name === 'GuestOrganizationUnresolvedError';
}
