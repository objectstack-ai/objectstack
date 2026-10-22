---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: the raw-SQL read scope (`getReadFilter`) answers the deny sentinel for a delegated context the operation prologue refuses — the delegator's membership must back the organization the read runs in, on a walled posture

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the read scope the security service answers an in-process caller that builds an on-behalf-of execution context in an organization the delegator does not belong to; the remedy is to build that context in an organization the delegator is a member of, never a rewrite of a package source or a stored row. -->

**BREAKING** (the security service's read scope narrows for one context shape). ADR-0021 D-C makes the raw-SQL read scope the find path's scope, and the provider's own contract is agreement with the engine middleware. Under `isolated` or `group`, the delegated-principal prologue already refuses every operation of an on-behalf-of context whose active organization the delegator's membership does not back (ADR-0090 D10, `vetOrganizationClaim`). `getReadFilter` did not ask that question, so for the same context it answered a composed read scope where the find path refuses. It now asks it, once, beside the dangling-delegator refusal it already mirrored.

- **FROM:** under `isolated` or `group`, `getReadFilter` for an execution context carrying `onBehalfOf` and an active organization the delegator is not a member of answered a read scope composed from the two principals' layers, where the engine's find refuses the same context.
- **TO:** it answers `RLS_DENY_FILTER` itself (the spec's sentinel, by reference), so a door that bypasses the engine reads zero rows for that context, as the engine's find refuses it.
- **Unchanged:** the `single` posture, an on-behalf-of context with no active organization, an on-behalf-of context in an organization the delegator is a member of, a context without `onBehalfOf`, a dangling delegator (still the deny sentinel) and system contexts. The `/mcp` OAuth door, the one producer of an on-behalf-of context in the platform, vets the request's organization against the same membership, so the contexts it builds keep their scope.
- **The fix for an in-process producer:** code that builds an `ExecutionContext` with `onBehalfOf` by hand and hands it to the security service or to the analytics service must set its `tenantId` to an organization the delegating user is a member of, or leave it unset.
