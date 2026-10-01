---
'@objectstack/plugin-security': minor
'@objectstack/spec': minor
---

fix(plugin-security,spec)!: a non-system caller that carries a principal and resolves no permission set gets the deny baseline at object admission and at the row scope, and the security contract says so (#21079)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key, export, published type, stored shape or wire shape is removed or renamed, so objectstack migrate meta has nothing to rewrite. What moves is which callers object admission and the row scope accept: a caller that carries a principal and resolves no permission set is now refused, and the remedy is a grant decision (a permission set the deployment declares and assigns), not a rewrite of anything an author already wrote. -->

**BREAKING for callers who resolve no permission set.** Shipped as `minor` under the launch-window convention.

**What changed.** ADR-0056 D2 gives an unauthenticated principal the deny baseline, not "no checks", and ADR-0090 D9 gives a guest the `guest` position and nothing else. A non-system caller that carries a principal (a position, a named permission set or a user id) but resolves no permission set was instead admitted to every object no set grants, for reads and writes, and read with the record-sharing predicate as its only row scope. Now an empty set list grants nothing:

- **Object admission refuses it.** Every engine operation (find, findOne, count, aggregate, insert, update, delete) is refused with `403 PERMISSION_DENIED`, the same refusal any caller gets for an object its sets do not grant. `ISecurityService.canReadObject` and `canExport`, and the write preview's admission, answer `false` for it.
- **Its row scope is the deny filter.** `ISecurityService.getReadFilter` answers the filter that matches zero rows for it, as it already did on a resolution failure.
- **The second principal of a delegated request is held to the same answer.** An agent acting on behalf of a delegator who resolves no permission set was already refused by the engine; `canReadObject`, `canExport` and the write preview now refuse it too.

The field answers for this caller (`getReadableFields`, `getQueryableFields`, `getWritableFields`, `getMetadataReadableFields`) are unchanged: they are field-level answers, and the contract now says that object admission is not part of them. The `ISecurityService` docblocks in `@objectstack/spec/contracts` that stated the old zero-set admission (`canReadObject`, `canExport`, the metadata-plane field projection) and the deny cases of `getReadFilter` narrow to match. No method, parameter or return type changes.

**Who this reaches.**

- An unauthenticated request carried as the guest envelope, on a deployment that grants anonymous callers no permission set.
- A context that names only permission sets the deployment does not register.
- A signed-in user on an embedder that switches the baseline off (`fallbackPermissionSet: null`) and grants that user nothing.

A context that carries no principal at all (no position, no named set, no user id) is handed through as before; ADR-0096 stages it separately. A caller who resolves at least one permission set is decided by its sets, as before, and so is a system context. The public form submit is unaffected: its declaration-derived grant admits the create and its read-back ahead of object admission. Signed-in users of a stock `objectstack serve` deployment are unaffected: it applies the member baseline to every one of them, so none resolves an empty list.

**Migration.** A caller that resolves no permission set is refused object admission and reads nothing. An app-declared anonymous endpoint (`authRequired: false`) can no longer read or write objects until the `guest` anchor's bindings are resolved for anonymous callers (#21158). An embedder that sets `fallbackPermissionSet: null` must grant its signed-in users a set explicitly.

**For implementers of `ISecurityService`.** Answer `canReadObject`, `canExport` and the object-admission half of a write `false`, and `getReadFilter` with your deny filter, for a non-system caller that carries a principal and resolves no permission set; admit only the principal-less context.
