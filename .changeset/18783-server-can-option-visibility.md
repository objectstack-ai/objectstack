---
'@objectstack/objectql': minor
'@objectstack/plugin-security': minor
'@objectstack/core': minor
'@objectstack/plugin-hono-server': patch
---

feat: the server answers `current_user.can(object, verb)` in an option's `visibleWhen` (#18783)

A `select` / `multiselect` / `radio` / `checkboxes` option can gate itself on the acting subject's grants:

```ts
stage: Field.select({
  label: 'Stage',
  options: [
    { value: 'open', label: 'Open' },
    { value: 'escalated', label: 'Escalated', visibleWhen: "current_user.can('crm_account', 'edit')" },
  ],
}),
```

`@objectstack/formula` answers `can` from `EvalContext.permissions` and refuses loudly when none is passed — and until now nothing on the write path passed one. Every authenticated write that picked such an option took the evaluator's fail-open branch: the value was admitted, one `warn` said the predicate "failed to evaluate", and the gate was never enforced for anyone.

**What changes.** The write path now evaluates the predicate with the subject's effective object permissions — on `insert` (single and batch), by-id `update`, bulk `update`, and the `validate()` preview. A subject whose map withholds the verb is refused with `VALIDATION_FAILED` and a field error `invalid_option` on that field; a subject who holds it is admitted. Options whose `visibleWhen` never calls `can` are unaffected.

**Where the map comes from — one producer.**

- `@objectstack/plugin-security` implements `ISecurityService.getEffectiveObjectPermissions` (declared optional in `@objectstack/spec`) and registers the same method on the engine.
- `@objectstack/objectql` gains `registerEffectiveObjectPermissionsResolver(fn)`. The engine asks it at most ONCE per write (an N-row bulk update is one resolution), only when a picked option's predicate calls `can`, never for a write with no acting user, and never keeps the answer past the write. The answer goes through formula's `toEvalPermissions`, so a map that is not the published shape is refused rather than answered from.
- `@objectstack/core` exports `buildEffectiveObjectPermissions`: the most-permissive merge plus the super-user seed, wildcard fold, managed-write clamp and `apiOperations` annotation. `/auth/me/permissions` builds its `objects` slot with it and the new security method returns it, so the console and the server's own `can()` read the same map. The four folds (`foldWildcardSuperUser`, `clampManagedObjectWrites`, `seedSuperUserRestrictedObjects`, `annotateEffectiveApiOperations`) and the `ManagedSchemaLike` / `ApiExposureSchemaLike` types moved from `@objectstack/plugin-hono-server` to `@objectstack/core`; `@objectstack/plugin-hono-server` re-exports them under the same names, so no import changes. The `/auth/me/permissions` response is byte-identical for the same resolved sets (measured on five fixtures against the previous build).

**Failure stance.**

- If the security service cannot resolve the map, a write that needs it is refused with the resolution's own error — fail closed. It is never read as "no grants".
- With no security plugin, or an engine older than the seam, there is no permission data. The gate stays unevaluable and the value is admitted with the same `warn` as before, which names the missing input. The security plugin logs one `warn` at start when the engine lacks the seam.

**Known gap, not changed here.** `can()` reads only the per-object entries of the map, and `/auth/me/permissions` lists an object for a `'*'` wildcard grant only when that grant carries a super-user bit. So a subject whose access to an object comes only from a plain wildcard — for example `organization_admin_no_bypass`, which a deployment without an organization wall grants to organization owners and admins — gets `false` from `current_user.can('<that object>', …)`, although the data plane admits the write. Before this release such a gate was never enforced for anyone; after it, that population is refused on a `can`-gated option. Any client that answers `can()` from the same `/auth/me/permissions` map gets the same `false`.

**No spec key, route or config key is added or removed.**
