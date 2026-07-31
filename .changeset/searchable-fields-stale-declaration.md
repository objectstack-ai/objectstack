---
"@objectstack/lint": minor
---

feat(lint): a `searchableFields` entry naming no field is caught at authoring
time, not at request time

`searchableFields` is `z.array(z.string())` in both `object.zod.ts` and the
list-view schema, so nothing ever checked that an entry resolves to anything.
Rename a field and the old name stays behind — Zod-valid, shipped, pointing at
a column that no longer exists.

The engine tolerates it, which is exactly what kept the drift invisible:
`resolveSearchFields` filters the declaration down to fields that exist
(`searchableFields?.filter((f) => all[f])`) and says nothing. The tolerance
fails in the direction nobody expects:

- **some entries stale** → `$search` scans a NARROWER set than the object
  declares. Records that should match do not, and the response is
  indistinguishable from "no such record";
- **every entry stale** → the filtered set is empty, so resolution falls
  through to the AUTO-DEFAULT (name/title + short-text fields). A declaration
  whose whole purpose is to CHOOSE the searchable set ends up selecting one the
  author never wrote — the "asked narrower, answered wider" inversion #4226
  closed on the projection axis.

It also stops being quiet downstream. Clients echo the declaration verbatim as
the `$searchFields` override (objectui's list search sends
`schema.searchableFields`), so once the REST read path validates that override
against the object (#4254), a stale entry the engine had been silently skipping
becomes a `400 INVALID_FIELD` on every list search for that object — a
request-time break whose cause is an authoring typo made long before.

**New rule — `searchable-field-unknown` (gating).** Wired into
`REFERENCE_INTEGRITY_RULES`, so it runs on `os validate`, `os lint` and
`os compile` with no CLI edit. It covers the object's own ADR-0061 declaration
and the list views that narrow it (`objects[].listViews`, a `defineView`
default `list`, and named `listViews`), resolving each entry against the bound
object's declared fields.

`error`, not the advisory level the other field-existence rules use
(`page-field-unknown`, `form-field-unknown`, `semantic-role-field-unknown` are
all warnings). Those describe a consumer that SKIPS an unknown name and renders
the rest; this describes a declaration that either selects the wrong set or
refuses the request outright — the same call `validate-flow-template-paths`
makes for a filter-position token, where the miss widens the query instead of
shrinking the page.

Existence only: a field that exists but is an odd search target (a `json`
column) is NOT flagged — an explicit `searchableFields` is authoritative, so
declaring one is a choice, not drift. Three skips keep false positives near zero
(ADR-0072 D1): an object this stack does not define, an object with no authored
field map (external / datasource-introspected), and registry-injected system
columns — the last derived from the spec's own `FIELD_GROUP_SYSTEM_FIELDS` and
`SystemFieldName` rather than hand-copied, since this package already carries
five slightly-different copies of that list.

Dotted paths are the one place this rule is stricter than its siblings. They
skip `owner_id.name` because the query engine resolves the traversal; search
does not — `resolveSearchFields` matches the field map by exact string, so a
dotted entry is dropped exactly like a typo, and it is the spelling most likely
borrowed from `select`/`sort`. It is flagged, with its own fix hint.
