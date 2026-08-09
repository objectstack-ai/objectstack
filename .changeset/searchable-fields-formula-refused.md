---
"@objectstack/metadata-protocol": patch
"@objectstack/spec": patch
"@objectstack/lint": patch
---

fix(spec,lint): a virtual `formula` field in `searchableFields` is refused loudly, not admitted verbatim (#6674)

#4254 closed the fail-open on the unknown-name axis: a `$searchFields` entry the
engine would not scan is `400 INVALID_FIELD`, never a silently widened search.
The same shape survived one axis over, on names that are perfectly real.

The declared branch of `resolveSearchFieldResolution` filtered entries by
EXISTENCE only, so a `formula` field declared in `searchableFields` entered the
allowed set — and the ingress gate, which reads that same set, accepted it for
exactly that reason. Measured on `origin/main`:

```
AUTO:          {"allowed":["name","project_name"],"source":"auto"}                formula excluded
DECL-FORMULA:  {"allowed":["name","project_name_formula"],"source":"declared"}    admitted verbatim
?search=Apollo&searchFields=project_name_formula  ->  200, 0 rows                 silent
```

Zero rows is the defect. A formula value is computed on read and no driver
materializes a column for it (`driver-sql` `fieldHasColumn`, driver-turso's
"Virtual — no column"), so the `$contains` the engine expands `$search` into has
nothing to scan: 0 rows on driver-memory (the property is absent from the stored
row) and 0 rows WITH NO ERROR on driver-sql/better-sqlite3. The declaration read
as search coverage and delivered none.

- **`@objectstack/spec` — the deciding face.** The declared branch now filters on
  existence AND scannability: an entry naming a virtual field is not admitted.
  New exports `SEARCH_VIRTUAL_TYPES` (exactly `formula`, pinned) and
  `isVirtualSearchField` — one judgment, so the resolution, the gate and the
  linter cannot drift about which types have a column. The resolution itself
  stays non-throwing: it is consulted on every search by internal callers that
  never pass an ingress, which is why #4254 put the loudness at the ingress.
- **`@objectstack/metadata-protocol` — `400 INVALID_FIELD` with its own reason.**
  Split out before the declared/auto branch, because both of those messages are
  wrong for it: "outside the declared set" is false when the entry IS in the
  list, and the auto-default's "declare `searchableFields` to choose the
  searchable set" would instruct the author to write the declaration being
  refused. The new message names the field, its type, that the value is computed
  on read and never stored, and the fix (mirror onto a stored text field).
- **`@objectstack/lint` — a build error at authoring time**, on the object's own
  `searchableFields` as well as a view's narrowing, under the existing
  `searchable-field-unsearchable` rule (no new rule id). This narrows the
  canonical surface, which #4830 had deliberately left existence-only.

The carve-out that made canonical existence-only is deliberately KEPT and pinned
by controls in all three packages: the dividing line is STORAGE, not search
quality. A `json` or `lookup` column declared in `searchableFields` is still the
author's choice and still executed — a `$contains` over the stored JSON text or
the stored foreign key. Narrow and rarely useful, but a scan that CAN match, so
it is neither a 400 nor a finding. Only "there is no column at all" is refused.

**Compatibility.** A corpus sweep of this repo plus `objectui` and `cloud` found
ZERO authored `searchableFields` naming a formula-typed field, so nothing in the
tree changes verdict. For an already-published object that does carry one:
loading is unaffected (no schema-parse change — `searchableFields` is still
`z.array(z.string())`, this is a resolution and enforcement rule); a plain
`?search=` keeps returning the SAME rows, because the dropped entry matched none
of them; only a request that NAMES the formula field flips from `200` with no
rows to `400 INVALID_FIELD` — including objectui's list search, which echoes the
declaration verbatim. An object whose `searchableFields` is ENTIRELY formula
entries filters to empty and falls through to the auto-default, exactly as an
all-stale declaration has since #4254; the linter reports the declaration rather
than leaving that swap silent.
