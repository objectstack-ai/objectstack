// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/organizations — the multi-organization runtime, in open
 * core (ADR-0132; the return trip of cloud ADR-0081 D2, which had moved this
 * machinery into the closed `@objectstack/organizations`).
 *
 * Row-level Organization isolation for ObjectStack:
 *   - auto-stamps `organization_id` on insert from
 *     `ExecutionContext.tenantId`,
 *   - replays the APP's own seed datasets on every `sys_organization`
 *     insert (never another organization's rows — cloud#1345),
 *   - bootstraps a Default Organization for the first platform admin
 *     (multi-org flavour: reuses plugin-auth's open helper and injects the
 *     per-org seed-ownership handoff).
 *
 * Pair with `@objectstack/plugin-security` for full multi-tenant RBAC +
 * RLS + Field-Level Security — plugin-security detects this plugin's
 * presence via `getService('org-scoping')` (the historical service name,
 * kept on purpose across both moves) and adjusts wildcard tenant policy
 * handling. Without a registrar, deployments are single-org (the open
 * member-management basics still work — plugin-auth, cloud ADR-0081 D1).
 *
 * ⚠️ Shipping this package is NOT yet the same as an open install raising the
 * wall. `objectstack serve` still resolves one hard-coded runtime spelling off
 * the tenancy posture and does not know this package exists; teaching it, and
 * running the open isolated-posture matrices against this registrar instead of
 * their hand-written posture stub, is #16137. Until that lands, this package is
 * the registrar an app wires by hand.
 *
 * ⛔ This package carries NO licence check of any kind and offers no hook for
 * one (ADR-0132 boundary 3).
 *
 * ## Why a private package in the commercial repo shares this name
 *
 * It is the mechanism, not a collision. The commercial multi-org entitlement
 * is a package of the same name that `extends OrganizationsPlugin` and calls
 * its own licence gate in its own constructor. Which one a deployment mounts
 * is decided by the manifest that DECLARES the name, never by this package:
 *
 *   - every commercial host declares `"@objectstack/organizations":
 *     "workspace:*"`, and pnpm's `workspace:` protocol resolves only to the
 *     local workspace package — it cannot fall through to the registry, and a
 *     missing one fails the install rather than substituting silently;
 *   - an open install declares the same name from npm and gets this package;
 *   - `objectstack serve` reaches it through the host-anchored importer, which
 *     refuses a package the served app has not declared at all (#4719), so the
 *     resolution base is always the app's own manifest.
 *
 * ⛔ Two consequences for anyone editing this package. It must never be added
 * as a dependency of another framework package — that would put an ungated
 * copy inside the framework tree a commercial app links, where a bare import
 * could reach it (`no-framework-dependents.pin.test.ts` holds this). And it
 * must never gain a way to detect or announce which of the two it is.
 */

export { OrganizationsPlugin } from './organizations-plugin.js';
export type { OrganizationsPluginOptions } from './organizations-plugin.js';
// Aliases matching the package name — the historical spelling this code
// shipped under before its round trip through the closed runtime, and the one
// the service name still reads as.
export { OrganizationsPlugin as OrgScopingPlugin } from './organizations-plugin.js';
export type { OrganizationsPluginOptions as OrgScopingPluginOptions } from './organizations-plugin.js';
export { claimOrphanOrgRows } from './claim-orphan-org-rows.js';
export { claimOrgSeedOwnership } from './claim-org-seed-ownership.js';
// ⛔ No donor-org clone is exported, and none may be re-added (cloud#1345).
// A new organization's rows come from the APP's own seed definitions
// (`seed-datasets` / `seed-replayer`, replayed per tenant) or the organization
// starts empty — never from another organization's data. The retired
// `cloneOrgSeedData` copied the FIRST organization's business rows into every
// subsequent one, which on a self-serve SaaS deployment handed customer #2 a
// copy of customer #1's records.
export {
  ensureDefaultOrganization,
  type EnsureDefaultOrganizationResult,
} from './ensure-default-organization.js';
export {
  organizationsObjects,
  organizationsPluginManifestHeader,
  ORGANIZATIONS_PLUGIN_ID,
  ORGANIZATIONS_PLUGIN_VERSION,
} from './manifest.js';
// Walled-posture MEMBERSHIP-POLICY gate (cloud#1092). A deployment that puts up
// the organization wall must DECLARE what a new user joins (`invite-only`, or
// `auto` knowingly accepted); running `auto` merely because nobody configured it
// refuses the boot. Enforced from this plugin's own boot hook — hosts do not
// call it — but the pieces are exported so a host can re-report the refusal
// structurally (`isWalledMembershipPolicyError`) rather than by string match.
export {
  assertWalledMembershipPolicyDeclared,
  isWalledMembershipPolicyError,
  readMembershipPolicyDeclaration,
  walledMembershipPolicyFatalMessage,
  WalledMembershipPolicyError,
  MEMBERSHIP_POLICY_ENV,
  MEMBERSHIP_POLICY_ERROR_CODE,
  MEMBERSHIP_POLICY_SETTING,
  type MembershipPolicyAuthSurface,
  type MembershipPolicyDeclaration,
  type MembershipPolicyProbe,
  type MembershipPolicySettingsSurface,
  type MembershipPolicySource,
} from './membership-policy-gate.js';
