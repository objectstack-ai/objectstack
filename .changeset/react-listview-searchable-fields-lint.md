---
"@objectstack/lint": minor
---

feat(lint): `<ListView searchableFields>` on a react page is checked against
the bound object's fields (#4329)

#4328's `searchable-field-unknown` gates a stale `searchableFields` entry on
the metadata surfaces — an object's own ADR-0061 declaration, its built-in
named list views, and a `defineView` aggregate's default `list` / named
`listViews`. It did not cover the react page surface: `ListView` declares
`searchableFields` as a dataProp, so a `kind:'react'` page could write
`<ListView searchableFields={['renamed_field']}>` and nothing resolved the
name. The failure is the one #4328 documents — the engine's
`resolveSearchFields` silently filters the stale name out, so the search scans
a narrower set than the page asked for, or (once every entry is stale) falls
through to the auto-default and scans a wider one; and once the REST read path
validates the `$searchFields` override (#4254), the prop objectui echoes
verbatim becomes a `400 INVALID_FIELD` on that list.

The check lives in `validate-react-page-props` — the gate that already parses
the page's real JSX — and runs on `<ListView>` usages whose `objectName` and
`searchableFields` are static literals, under the same rule id and severity
(`searchable-field-unknown`, `error`) as the metadata surfaces. It is not a
re-implementation: `validate-searchable-fields` now exports its core
(`indexObjectSearchTargets` + `checkSearchableFieldList`), and the react gate
runs that, so the two surfaces agree on what counts as a field by construction
— same three skips (an object this stack does not define, an object with no
authored field map, registry-injected system columns derived from the spec's
own declarations), same dotted-path strictness (search matches the field map
by exact string, so `owner_id.name` is flagged, not exempted).

JSX-specific seams follow the gate's existing rules: a value that comes from a
variable, a call, or a spread is not knowable at build time and is skipped
silently — an unresolvable binding is not a wrong one (ADR-0072 D1).
