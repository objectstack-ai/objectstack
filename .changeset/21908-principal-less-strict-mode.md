---
'@objectstack/plugin-security': minor
'@objectstack/metadata-protocol': patch
---

feat(plugin-security)!: a data-engine context that carries no principal and is not a system context is refused (ADR-0096 D5 strict mode)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export, type or stored shape is added, removed, renamed or re-shaped, and no stored row is read, rewritten or converted, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is a runtime admission: the security middleware refuses an engine operation whose context names no user, no position and no permission set and is not a system context, which it used to hand through. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no TypeScript declaration moves (not runtime-interface-only or type-surface-only). -->

**BREAKING** for in-process code: an accept-set narrowing of the data engine's security middleware, shipped as `minor` under the launch-window convention for breaking changes.

**What is refused now.** A data-engine operation whose execution context carries no principal (no user id, no position, no permission set) and is not a system context. That covers a call that passes no context at all, an empty one, one with only a tenant id, and one with only provenance fields. Every layer answers it the same way:

- the engine middleware throws `PermissionDeniedError`, `403 PERMISSION_DENIED`, for every verb (find, findOne, count, aggregate, insert, update, delete), before the operation runs;
- `canReadObject`, `canExport` and `canWriteObject` answer `false`;
- `getReadFilter` answers the deny filter (zero rows).

It used to be handed straight through, with no CRUD gate, no row-level security, no field mask and no tenant wall. That contradicted the published contract for an empty tool-execution context, "unauthenticated (RLS-on, sees-nothing)", which this change now keeps. The field projections (`getReadableFields` and its siblings) answer such a context as they answer any caller that resolves no permission set.

**What is unchanged.**

- A system context (`isSystem: true`) is admitted everywhere, as before.
- A context that carries a principal without a user id is decided by what it carries: a named permission set, the guest principal, or the public-form grant.
- An unauthenticated HTTP request is answered as before: a door that requires a session answers `401 UNAUTHENTICATED` before the engine is asked anything, and an endpoint an application declared open runs it as the guest principal.

**What to do.** Code that calls the data engine in-process must state who it acts for. FROM: an engine call with no context, or with a context that names nobody. TO: either

- pass the caller's execution context, so the caller's own permissions decide; or
- for platform plumbing whose own door already authorized the caller (a store read or write the platform owns), pass the explicit system opt-in, `context: { isSystem: true }`.

The one-line fix: give every in-process engine call a context, the caller's or `{ isSystem: true }`. The refusal message names both.

`@objectstack/metadata-protocol`: the protocol's own platform-store reads and writes behind the publish, history, audit, diff, commit, migration and code-only delete doors now pass the explicit system opt-in, like its other store calls. Nothing those doors answer changes.
