---
'@objectstack/spec': minor
---

**`ISecurityService` gains the effective-object-permission reader.**

`getEffectiveObjectPermissions(context?)` answers the server-resolved effective object-permission
map for a caller — object name -> `EffectiveObjectPermission` — which is the `objects` slot of the
published `/auth/me/permissions` response (`GetEffectivePermissionsResponseSchema`): the caller's
permission sets merged most-permissively, the super-user folds applied, each entry annotated with
its effective API-operation set. Purely additive: the member is OPTIONAL, nothing is renamed,
narrowed or removed, and a security service that omits it still satisfies the contract.

Clause-②: yes (widening)

**Why it is a reader on the service rather than a merge each consumer does.** The existing
`resolvePermissionSetsForContext` deliberately leaves the merge to the caller, because two consumers
legitimately project *different* subsets of the same sets. This map is the projection two consumers
need to be *identical*: the effective map `/auth/me/permissions` serves is also the map the
permission predicate `current_user.can(object, verb)` reads through `EvalContext.permissions`, and
that consumer cannot tell a wrong map from a right one. `@objectstack/formula` already states the
hazard at its own door — a hand-built permission map "has no shape of its own to be wrong against:
it parses, `can()` answers from it, and the answer is a confident silent denial". One producer
removes the second copy before it is written.

**Three properties of the contract, each load-bearing:**

- **The WHOLE map, with no object parameter.** An entry the map omits reads as "no grant" and
  answers `false`, which is indistinguishable from a measured denial — so a caller may not narrow
  the map to the objects it expects to be asked about. A predicate names its objects in its own
  source; the site assembling the context does not know them.
- **It THROWS on resolution failure and never degrades to `{}`.** An empty map is a *real* answer
  here (this subject holds nothing), so a failure returning it would publish a denial of everything
  as a measured fact. Callers fail closed on the throw, exactly as they must for
  `resolvePermissionSetNames` and `resolvePermissionSetsForContext`.
- **Absence is a defined state.** Consumers feature-detect
  (`typeof svc.getEffectiveObjectPermissions === 'function'`), and the fallback is NOT an empty map
  and NOT a locally merged one: a caller that cannot get this answer passes no permission data at
  all, leaving a permission-gated predicate loudly unevaluable instead of quietly denied.

Request-scoped: resolve it once per request, never per evaluation (the map is pinned data an
evaluator re-reads for free) and never cached across requests (a grant may since have been revoked).

**This is the declaration only.** The engine-side threading — populating `EvalContext.permissions`
from this reader at each `current_user`-bound predicate evaluation site, and the
`packages/objectql` / `plugin-security` wiring — lands separately under the same maintainer ruling,
which orders a census of those sites first.
