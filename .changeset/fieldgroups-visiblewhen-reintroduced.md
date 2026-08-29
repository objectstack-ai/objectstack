---
"@objectstack/spec": minor
---

feat(spec): re-introduce `fieldGroups[].visibleWhen` — the section predicate slot, this time with its enforcement (#12715)

Accept-set **widening** (one new optional key); additive, no existing metadata
changes meaning.

`fieldGroups[].visibleWhen` existed briefly and was REMOVED under ADR-0085 /
ADR-0049 enforce-or-remove because no surface evaluated it. The consumer now
exists: the objectui section-gating contract renders a fieldGroups-derived
group behind a `section-divider` that carries a membership claim and gates the
whole group — header included — on its own visibility verdict. The maintainer
ruled (2026-08-28, #12715) the slot re-declared together with that enforcement,
closing the enforce-or-remove loop in both directions.

- **`visibleWhen`** on `ObjectFieldGroupSchema` — CEL via
  `ExpressionInputSchema`, the ADR-0089 canonical spelling shared with field,
  action and row predicates (bare string shorthand normalizes to the
  `{ dialect: 'cel', source }` envelope). FALSE, or a faulting predicate
  (fail-closed), hides the whole group; TRUE or absent shows it.
- **`deriveFieldGroupLayout` passes the predicate through** to the derived
  `FieldGroupSection` verbatim (string or envelope, tolerant of un-parsed
  metadata like its collapse-alias handling); evaluation stays the renderer's.
- The `visibleOn` spelling stays rejected, its guidance now pointing at the
  real slot instead of a removal notice; the `visibleWhen` tombstone row is
  retired (the key is real again).

<!-- adr-0087: not-required (additive-widening) A new optional key on an existing shape: nothing is removed, renamed or re-shaped, no tombstone exists, and `objectstack migrate meta` has nothing to rewrite. Existing metadata parses byte-identically; only metadata that opts into the new key gains behaviour, and that behaviour is enforced by the consuming renderer from day one. -->
