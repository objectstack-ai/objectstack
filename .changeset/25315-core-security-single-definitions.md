---
'@objectstack/core': patch
'@objectstack/plugin-auth': patch
'@objectstack/plugin-security': patch
'@objectstack/service-settings': patch
---

refactor(core, plugin-auth, plugin-security, service-settings): one definition each for the `admin_full_access` anchor rule and the organization-reach rule, exported from core security

Clause-②: yes (widening)
Metadata-protocol: none

Two security rules were each spelled more than once. A change to one copy could leave the other behind. Each now has one definition in `@objectstack/core`'s security module, and every reader calls it. No behaviour change: every reader answers exactly as before.

- **The anchor rule (ADR-0131 D5).** New export: `organizationAnchorsPlatformStanding(grantOrganizationId, { walled, defaultOrganizationId })`, with the type `PlatformStandingAnchorFacts`. It decides which `admin_full_access` grant anchors platform-admin standing:
  - behind a wall, no grant does;
  - under `single`, the grant owned by the Default Organization does;
  - an organization-less grant never does, and neither does any grant when no Default Organization can be named.

  Three readers call it:
  - the authorization resolver passes the memoised Default Organization;
  - the last-administrator guard in `@objectstack/plugin-auth` passes the Default Organization as the pending write would leave it;
  - the first-user promotion's holder scan in `@objectstack/plugin-security` passes the Default Organization it promotes into, and keeps its own system-user exclusion.

  Each reader keeps its own normalizer for a grant row's organization.
- **The organization-reach rule (ADR-0131 D8/D9).** New exports:
  - `resolveOrganizationReach({ callerOrganizationId, wallStands, deriveOrganization })`;
  - `organizationReachAdmits(reach, rowOrganizationId)`;
  - `organizationReachRowOwner(reach)`;
  - `organizationIdOf(value)`;
  - `UNOWNED_ORGANIZATION_REACH`;
  - the types `OrganizationReach` and `OrganizationReachFacts`.

  The rule decides whose `sys_setting` rows a caller may draw on:
  - the caller's own organization;
  - for a caller naming none where no wall stands, the organization D9 derives;
  - nothing behind a wall;
  - rows with no organization, only in a composition that registers no organization object.

  `SettingsService` and the resolver's direct localization fallback both call it. Each still supplies its own facts:
  - the service: the posture in force (the `tenancy` service), with a failed read propagated to its caller;
  - the fallback: the requested posture (`OS_TENANCY_POSTURE`), with a failed read degraded to the built-in defaults.

  These two differences are kept by design: they make the fallback, which runs only when the service has failed, the stricter reader.

No configuration, metadata or HTTP behaviour changes. Code that does not import the new exports needs no action.
