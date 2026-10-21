---
'@objectstack/plugin-security': minor
---

fix(plugin-security)!: a delegated operation runs only in an organization the delegator is a member of, on a walled posture

ADR-0090 D10 bounds an on-behalf-of operation by the delegator's scope. The operation runs in the live principal's active organization, and the delegator context is resolved in that same organization, on the stated assumption that the agent and its delegator are in the same organization. Nothing checked that assumption. The delegated-principal prologue (`resolveOperationPrincipals`) now checks it with `vetOrganizationClaim`, the one rule for "a membership backs this organization": under `isolated` or `group`, when the on-behalf-of context carries an active organization the delegator is not a member of, every operation is refused before any gate runs.

Clause-②: no (narrowing) — on a walled posture, an operation of an on-behalf-of context whose active organization the delegator's membership does not back is refused `403 PERMISSION_DENIED`, where it used to run.

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer the security middleware gives an in-process caller that builds an on-behalf-of execution context in an organization the delegator does not belong to; the remedy is to build that context in an organization the delegator is a member of, never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the security middleware's accept set narrows), shipped as `minor` under the launch-window convention for breaking changes.

- **FROM:** under `isolated` or `group`, an operation (read, insert, update or delete) of an execution context carrying `onBehalfOf` and an active organization the delegator is not a member of ran, answered by the gates the middleware composed for the two principals.
- **TO:** the same operation is refused `403` with `code: 'PERMISSION_DENIED'` before any gate runs. The message names the organization and the delegator.
- **Unchanged:** the `single` posture, an on-behalf-of context with no active organization (it keeps the ADR-0123 D2 answers), a context without `onBehalfOf`, a dangling delegator (still refused as before), and system contexts. The `/mcp` OAuth door, the one producer of an on-behalf-of context in the platform, vets the request's organization against the same membership, so the contexts it builds are never refused by this rule.
- **The fix for an in-process producer:** code that builds an `ExecutionContext` with `onBehalfOf` by hand (a plugin, a service, an agent runtime) must set its `tenantId` to an organization the delegating user is a member of, or leave it unset.
