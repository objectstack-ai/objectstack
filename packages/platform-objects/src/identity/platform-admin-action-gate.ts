// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The declared gate of a first-party action whose door runs the ADR-0068
 * platform-admin gate (#30771, ruling A on #30126 row 16).
 *
 * ## Why the action declares it
 *
 * Such a door answers every caller below the ADR-0095 D3 `PLATFORM_ADMIN` rung
 * 403. Its action used to carry that fact only in `visible`, which is display
 * only: no door reads it. So MCP `list_actions` listed `ban_user` and
 * `set_user_manager` to a plain member, and the platform action door
 * (`POST /actions/:object/:action`, MCP `run_action`) forwarded the call for the
 * target to refuse. Declaring the gate in `requiredPermissions` (ADR-0066 D4,
 * an existing key) puts it where both doors already look: the runtime's ONE
 * reader, `actionPermissionError`, refuses the call with 403 at the door and
 * leaves the action out of `list_actions`, from this one declaration.
 *
 * ## Why a capability stands for the rung
 *
 * The rung is not a key an action can name, but the rung implies these
 * capabilities by construction: both anchors that confer it (the stored
 * `admin_full_access` grant and the deployment's `OS_PLATFORM_OWNER_EMAIL`
 * list) hand the holder `ADMIN_FULL_ACCESS_CAPABILITIES.systemPermissions`,
 * and both names below are catalog `scope: 'platform'` capabilities that
 * `organization_admin` withholds. So the declaration never hides the action from
 * a caller its door admits on the rung, and the door still judges the rung
 * itself: a holder of the capability without the rung is listed and refused by
 * the target, as before.
 *
 * Pinned, for every action on such a door, by
 * `platform-admin-affordance-standing.test.ts` (both halves: the `visible`
 * standing and this declaration).
 */

/** Doors that administer accounts and memberships across the platform. */
export const PLATFORM_ADMIN_USERS_GATE: readonly string[] = Object.freeze(['manage_users']);

/** Doors that administer platform-wide settings: OAuth applications, SSO providers. */
export const PLATFORM_ADMIN_SETTINGS_GATE: readonly string[] = Object.freeze(['manage_platform_settings']);
