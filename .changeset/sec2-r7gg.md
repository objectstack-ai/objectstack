---
'@objectstack/core': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
'@objectstack/cli': patch
'@objectstack/spec': patch
---

fix(rest): every data door judges environment membership

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) nothing an author writes is retired or renamed; a request the host already refuses at its other door is now refused at this one too -->

On a host that places requests in environments, every door now applies the same environment-membership rule: a signed-in caller who is not a member of the environment the request resolved to is answered `403 PROJECT_MEMBERSHIP_REQUIRED`, in the envelope the runtime dispatcher already answers with. The rule is one function in `@objectstack/core` (`judgeEnvironmentMembership`), asked by the runtime dispatcher and the REST server alike, so the two doors of one host cannot answer the same caller differently; the dispatcher's own answers are unchanged.

It applies exactly where the dispatcher's does, and is off in the same two cases: the host sets `api.enforceProjectMembership: false` (ADR-0135 D9: a host whose environment-native auth is the membership), or no `sys_environment_member` object is registered. The switch is read through one function for both plugins (`resolveEnvironmentMembershipEnforcement`): an explicit `enforceProjectMembership` wins, else it is on exactly when environment scoping is on. `objectstack serve` hands the stack's `api.enforceProjectMembership` to both the REST and the dispatcher plugin.

Migration for a host that composes the plugins itself: pass the value you give `createDispatcherPlugin({ enforceProjectMembership })` to `createRestApiPlugin({ enforceProjectMembership })` as well. A host that opted the dispatcher out with `false` and does not pass it to the REST plugin will see REST judge membership whenever environment scoping is on and `sys_environment_member` is registered. A `RestServer` constructed directly judges nothing unless its new last constructor argument says `{ enforced: true }`.
