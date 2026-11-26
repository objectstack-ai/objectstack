---
'@objectstack/core': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/cli': patch
'@objectstack/spec': patch
---

fix(rest)!: every data door judges environment membership

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) every data door judges environment membership; nothing an author writes is retired, renamed or re-shaped, so there is nothing for a migration to rewrite -->

**BREAKING** for a signed-in caller who is not a member of the environment a request resolved to: every data door now judges environment membership and answers that caller `403 PROJECT_MEMBERSHIP_REQUIRED`, in the envelope the runtime dispatcher already answers with.

Every data door judges environment membership. The rule is one function in `@objectstack/core` (`judgeEnvironmentMembership`), asked by the runtime dispatcher and the REST server alike; the dispatcher's own answers are unchanged.

It is off in exactly two cases: `api.enforceProjectMembership: false` (ADR-0135 D9: a host whose environment-native auth is the membership), or no `sys_environment_member` object registered. The switch is read through one function for every door (`resolveEnvironmentMembershipEnforcement`): an explicit `enforceProjectMembership` wins, else it is on exactly when environment scoping is on. `objectstack serve` hands the stack's `api.enforceProjectMembership` to the REST and the dispatcher plugin alike.

Migration: a host that composes the plugins itself passes the same `enforceProjectMembership` to `createRestApiPlugin` as to `createDispatcherPlugin`.
