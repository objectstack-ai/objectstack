---
"@objectstack/lint": minor
---

fix(lint): ask the provenance question at the fifth blanket-`SYSTEM_FIELDS` read site — `searchableFields` (#8404)

`validate-searchable-fields.ts` judged a declared `searchableFields` entry
against the object-independent `SYSTEM_FIELDS` union, exactly as the four
filter/page-binding rules did before #8340 wired them to the per-object index.
Both of its gates were correct about EXISTENCE and structurally blind to
PROVENANCE: `:345` keeps `searchable-field-unknown` silent for any name in the
union, and `resolveAllowedSet` goes further — it manufactures a stub meta for
such an entry so it survives the resolution's existence filter exactly as it
does at runtime.

On an ADR-0015 `external` object the platform registers its injected anchors
(`owner_id`, `organization_id`, the audit family, …) and provisions no storage
behind them (#7865 / #8116), so:

```
searchableFields: ['name', 'owner_id']   // external object
```

linted clean, the stub kept the entry in the resolved allow-list, and the
view's `$searchFields` narrowing then scanned a column empty on every record —
#4830's own failure mode (a narrower search than declared, silently) reached by
a different route.

A new `searchable-field-unprovisioned` rule now warns on such an entry, on the
object's own canonical set and on a list view's narrowing alike, reusing
`unprovisionedAnchorCause` / `unprovisionedAnchorHint` so the sentence matches
the four #8340 rules verbatim rather than becoming a second copy (#4830). WARN,
never gating, per #4330's cost asymmetry: the remote schema is not visible to
this pass, so the finding describes a degradation rather than a refusal.

**The `:239` stub is KEPT.** It is not incidental — it is what makes the linter's
resolution agree with the runtime's, which resolves the declared branch against
the registry field map. Measured by disabling it: the existing "keeps runtime
parity when the object declares system columns searchable" test goes red
(`expected [] to have a length of 1 but got +0`), because the declaration
existence-filters to empty and resolution falls through to the auto-default.
Dropping it would have been a behaviour change dressed as a warning.

The warning is emitted per declared entry in the checker's entry loop, never
inside `resolveAllowedSet` — that helper reads the OBJECT's declaration and runs
once per narrowing, so warning there would repeat one object-level fact for
every view and attribute it to the view's path.

`checkSearchableFieldList` takes the index as an OPTIONAL trailing parameter,
the same shape #8340 gave `checkFieldRefs`: its absence means the caller did not
build the index and the provenance question goes unasked — the previous
behaviour, preserved for out-of-repo callers (cloud graph-lint, the AI authoring
path). Both in-repo callers pass it.
