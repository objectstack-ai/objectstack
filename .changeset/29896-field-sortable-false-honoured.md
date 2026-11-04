---
'@objectstack/spec': patch
'@objectstack/metadata-protocol': patch
---

fix(spec,metadata-protocol)!: a field marked `sortable: false` is no longer offered or performed as a sort — the sortability projection reports it unsortable and the Data API refuses a sort on it with `400 INVALID_SORT` (#29896)

Clause-②: yes (narrowing) — `GET /api/v1/data/:object` (and every request that reaches the same list door: `POST /api/v1/data/:object/query`, the export route, the RPC dispatcher) refuses a sort on a field whose author declared `sortable: false`, which it used to answer 200 sorted by the column. The widening half: `@objectstack/spec/api` exports `FIELD_UNSORTABLE_AUTHOR_DECLARED`, and `FieldSortabilitySchema.reason` accepts `'author-declared'` beside `'virtual-type'`.
Metadata-protocol: none
Skills-docs: none — `skills/**` names no `sortable` field key, and `content/docs/**` already teaches `sortable: false` as "do not allow sorting by this field" and `INVALID_SORT` as "the field must exist and have `sortable: true`", which is what the platform now does.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed or renamed, and no stored metadata is rewritten: field.sortable keeps its shape and its documented meaning, which the projection and the Data API now honour. A sort the door now refuses is a request, never a stored value, and no in-repo producer authors sortable false; the caller drops that sort, or the author removes sortable false. -->

**BREAKING** accept-set narrowing at the Data API list door (`@objectstack/metadata-protocol`): a sort on a field marked `sortable: false` is refused.

- **Before.** An author who marked a field `sortable: false` (a long text, an unindexed column on a large table) got nothing for it. The sortability projection served on `GET /api/v1/meta/object/NAME` reported the field `{ sortable: true }`, so the list header and the Sort picker offered it, and `GET /api/v1/data/NAME?sort=FIELD` answered 200 sorted by it.
- **Now.** The projection reports `{ sortable: false, reason: 'author-declared' }` for that field, so the grid header and the Sort picker, which read the projection, stop offering it, and a sort they already stored is dropped the next time the view writes its sort back. The Data API judges the sort by the same projection and refuses it with `400 INVALID_SORT` before any read, the answer a sort on a `formula` field already gets. Only the literal `false` counts: a field with no `sortable` key, or with `sortable: true`, sorts as before. A `formula` field also marked `sortable: false` keeps its `reason: 'virtual-type'` answer.
- **Not changed.** In-process callers that reach `ObjectQL.find` directly (hooks, flows) keep sorting by the stored column: the engine door judges only whether a column is stored, and `sortable: false` governs what the platform offers callers, not what its storage can do.

**The remedy.** A caller drops the sort on that field or sorts by another one. An author who wants the field sortable removes `sortable: false` from it.
