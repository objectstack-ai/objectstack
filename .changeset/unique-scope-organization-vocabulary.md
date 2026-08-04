---
"@objectstack/spec": minor
---

feat(spec): `unique` scope vocabulary gains `'organization'` — scope is said, not positional (#4986, ADR-0120 D1/D6)

`UniqueScopeSchema` (field-level `unique` and `IndexSchema.unique`) widens from
`boolean | 'global'` to `boolean | 'global' | 'organization'`. Purely additive
in 17.x — no existing spelling changes meaning:

- **Field-level** `'organization'` is the explicit synonym of `true`
  (per-organization uniqueness, identical materialization through the driver
  predicates: `isUniqueDeclared` counts it, `isGlobalUnique` does not). Bare
  `true` stays valid indefinitely; official examples and scaffolding emit
  `'organization'` in new code (non-normative, ADR-0120 Resolved #2).
- **Declared-index** contract is now stated per word (ADR-0120 D1, amending
  #3696): `'global'` = today's verbatim behavior — materialized over exactly
  `fields`, no organization column injected; `'organization'` = the driver
  prepends the NULL-safe organization key part
  (`COALESCE(organization_id, '__global__')`, ADR-0120 D3) at registration —
  materialization lands with #5030's driver PR, which this change must follow;
  bare `true` = the deprecated positional spelling of `'global'` — warned in
  17.x by lint `unique/unscoped-declared-index`, rejected at protocol 18
  (#5082).
- **Rejected words carry the fix**: `'tenant'` and `'org'` are not accepted and
  are not aliases — the parse error names `'organization'` (ADR-0120
  §Terminology).
- New export `isOrganizationUnique` — detects the explicit `'organization'`
  spelling, single source of truth for the declared-index distinction across
  SQL/Mongo index sync.
- The `UniqueScopeSchema` doc block's false single-tenant exemption ("the
  tenant column is constant, so the composite index degenerates to the
  single-column one" — falsified by #5030: the constant is NULL and SQL UNIQUE
  is NULL-distinct) is replaced with the D3 truth (NULL bucket + COALESCE).
