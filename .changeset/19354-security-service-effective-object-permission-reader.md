---
"@objectstack/spec": minor
---

feat(spec): `ISecurityService` gains `resolveEffectiveObjectPermissions`, the effective-object-permission reader (#19354)

Clause-②: yes (widening)

One new OPTIONAL member on the published `ISecurityService` contract. It answers the effective object permissions for one principal — object name to the server-resolved entry, merged across that principal's permission sets the way the enforcement path merges them. The type is the `objects` map of `GetEffectivePermissionsResponse`, i.e. the same bytes `/auth/me/permissions` already serves, named rather than restated so the two ends cannot drift key by key.

```ts
resolveEffectiveObjectPermissions?(
  context?: SecurityContext,
): Promise<Readonly<Record<string, EffectiveObjectPermission>>>;
```

- **Why the whole map, when every other reader on this contract takes an `object`.** The first consumer is the ObjectQL engine populating `EvalContext.permissions` for `current_user.can(object, verb)`, and the object name is chosen by the AUTHORED PREDICATE at evaluation time, not by the caller. A per-object reader would make the caller guess which objects a predicate names, and a guess that comes up short does not fault: an absent entry reads as "no grant" (`objectPermissionGrants`), so the missed object answers `false` and a correct predicate silently hides an option from someone entitled to it. `@objectstack/formula`'s `EvalPermissions` says the same thing from the consumer side — "pass the whole effective set the endpoint returned, never a hand-picked subset".
- **Why not a caller-side fold of `resolvePermissionSetsForContext`.** That method hands over its INPUT — the sets, unmerged, in resolution order — because two consumers legitimately project different subsets of them. The merge onto one entry per object is not one of those projections; it is a single rule with a measured history of being re-implemented and drifting (#7608, #7555, #6334), and ADR-0124 D4 puts it on the server.
- **Entries, not verdicts.** Values are the effective `allow*` + super-user entries, so the fold from entry to verdict stays in `objectPermissionGrants` — the one reading shared with `PermissionEvaluator.checkObjectPermission`. An implementation that pre-folded into per-verb booleans would be a fourth copy of that rule, and would drop the distinctions the fold depends on (`allowCreate` has no super-user bypass; `allowExport` is `grant ∧ read`).
- **Throws on resolution failure**, exactly as its two `resolve*` siblings do, and never degrades to an empty or partial map: `{}` is a real answer meaning "this subject holds nothing", so a failure wearing that costume is a silent denial of everything.
- **OPTIONAL, so nothing existing breaks.** A security service that predates the method still satisfies the contract and consumers feature-detect. The documented fallback for an absent method is to pass NOTHING downstream rather than to invent an empty map, which is what makes `can()` refuse loudly instead of denying quietly.

⛔ **Declaration only — no behaviour moves in this release.** No implementation is wired: `@objectstack/plugin-security` does not gain the method here, and the `packages/objectql` / `evaluateOptionVisibility` threading that would consume it stays on #18783, which declares `Blocked-by:` this card. Measured on this tree at the branch head: the diff is 2 files, both under `packages/spec/src/contracts/` — the declaration and its contract test — and the `security` service has zero implementations of the new member, so every deployment answers exactly as it did before.

No generated carrier moves. `api-surface/`, `export-origins/` and `declaration-map/` record exported DECLARATION names, and this change adds no exported symbol — it adds a member to an interface that is already listed in all three (`api-surface/contracts.json:151`, `export-origins/contracts.json:151`). Verified by running the repo's own checkers rather than by inspection: `check:api-surface`, `check:export-origins`, `check:declaration-map` and `check:generated` all report no drift, and `pnpm --filter @objectstack/spec gen:api-surface` + `gen:export-origins` + `gen:declaration-map` leave the tree byte-identical.
