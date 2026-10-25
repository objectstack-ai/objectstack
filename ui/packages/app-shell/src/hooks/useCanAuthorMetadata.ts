// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { usePermissions } from '@object-ui/permissions';

/**
 * [ADR-0066] The system capability every metadata-authoring surface ultimately
 * requires. The server is the authority (it refuses the write either way); what
 * follows is only the presentational half.
 */
export const AUTHORING_CAPABILITY = 'manage_metadata';

/**
 * May this session author metadata?
 *
 * Extracted from the console HomePage (where it gated the builder CTAs) when
 * the maker convergence (cloud#1674) made the SAME question decide which chat
 * composer a console session gets — one shared answer, not two drifting copies.
 *
 * objectstack#8270 — on the EE single-database multi-tenant deployment a
 * workspace owner holds `org_owner` + `organization_admin` but NOT
 * `manage_metadata`; that absence is the intended hosted posture (maintainer
 * ruling 2026-08-13), not a missing grant. `useWorkspaceAdminStatus` reads the
 * session's POSITIONS (spelled `roles` until framework ADR-0090 D3 renamed it;
 * objectui#5389 moved this hook onto the live spelling, and `org_owner` is in
 * that array either way), so it says `true` for that owner and the builder CTAs
 * rendered — the owner followed "Build an app", filled in the new-package
 * dialog, and hit a raw capability refusal at submit. This consumes the answer
 * the server already gives (`GET /api/v1/auth/me/permissions` →
 * `systemPermissions`, surfaced by `MePermissionsProvider`); it does NOT
 * re-derive permission logic client-side.
 *
 * **Unknown → fail OPEN**, the same doctrine `useCapabilityGate` states for
 * ADR-0066 gates (framework#3923): the server enforces regardless, and hiding a
 * permitted user's primary CTA on missing client data is the worse failure.
 * `MePermissionsProvider` now preserves the absent-vs-empty distinction
 * natively (objectui#4656) — `hasCapabilities` itself returns `true` when the
 * backend never reported `systemPermissions` at all (a deployment predating
 * ADR-0066), and gates normally on a real answer, including a genuinely
 * EMPTY one. This hook no longer re-derives that heuristic locally; it just
 * asks the centralized signal. The ruled case is unaffected: the EE owner's
 * set is non-empty (`manage_org_users`, `setup.access`, `setup.write`), so it
 * gates closed. Hosts with no permission provider at all already fail open
 * inside `usePermissions`.
 */
export function useCanAuthorMetadata(): boolean {
  const { hasCapabilities } = usePermissions();
  return hasCapabilities([AUTHORING_CAPABILITY]);
}

/**
 * objectui#12475 — the capabilities the item-scoped AUTHORING TRAIL doors admit:
 * `GET /meta/:type/:name/history`, `/audit` and `/diff`. objectstack#23546
 * (ruling A1) narrowed them to `system`, `studio.access` and `manage_metadata`;
 * `setup.access` no longer opens them. `system` is a principal flag, not a
 * capability `/auth/me/permissions` reports, so it has no client half here: a
 * console session is never a system principal.
 */
export const AUTHORING_TRAIL_CAPABILITIES: readonly string[] = ['studio.access', AUTHORING_CAPABILITY];

/**
 * May this session read an item's authoring trail (its history, audit and diff)?
 *
 * The ONE answer the editors that offer History and Audit ask, so the entries
 * are shown only to a caller the doors admit: an organization admin holding
 * `setup.access` alone is offered no button that always answers 403. The
 * doors admit ANY of the capabilities above, so each is asked on its own
 * (`hasCapabilities` answers "holds ALL of"). Unknown fails OPEN, exactly as
 * {@link useCanAuthorMetadata} does: `hasCapabilities` itself returns `true`
 * when the backend never reported `systemPermissions`, and the server
 * enforces regardless.
 */
export function useCanReadAuthoringTrail(): boolean {
  const { hasCapabilities } = usePermissions();
  return AUTHORING_TRAIL_CAPABILITIES.some((capability) => hasCapabilities([capability]));
}
