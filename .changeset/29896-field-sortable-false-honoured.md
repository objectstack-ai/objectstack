---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/mcp': minor
---

fix(spec,metadata-protocol,mcp)!: a field marked `sortable: false` is no longer offered or performed as a sort — the sortability projection reports it unsortable, and the Data API and the stdio MCP `query_records` refuse a sort on it with `400 INVALID_SORT` (#29896)

Clause-②: yes (narrowing) — `GET /api/v1/data/:object` (and every request that reaches the same list door: `POST /api/v1/data/:object/query`, the export route, the RPC dispatcher, the record-page `related[].sort`) and the stdio MCP `query_records` refuse a sort on a field whose author declared `sortable: false`, which they used to answer sorted by the column; a stored list view `sort` or `record:related_list` `sort` naming such a field is now refused when it is read. The widening half: `@objectstack/spec/api` exports `FIELD_UNSORTABLE_AUTHOR_DECLARED`, and `FieldSortabilitySchema.reason` accepts `'author-declared'` beside `'virtual-type'`.
Metadata-protocol: narrowed
Skills-docs: none — `skills/**` names no `sortable` field key, and `content/docs/**` already teaches `sortable: false` as "do not allow sorting by this field" and `INVALID_SORT` as "the field must exist and have `sortable: true`", which is what the platform now does. The prescription ships in the refusal text and the upgrade-guide entry.

<!-- adr-0087: registered field-sortable-false-sort-refused -->

**BREAKING** accept-set narrowing at the Data API list door (`@objectstack/metadata-protocol`) and the stdio MCP `query_records` (`@objectstack/mcp`): a sort on a field marked `sortable: false` is refused.

- **Before.** An author who marked a field `sortable: false` (a long text, an unindexed column on a large table) got nothing for it. The sortability projection served on `GET /api/v1/meta/object/NAME` reported the field `{ sortable: true }`, so the list header and the Sort picker offered it, `GET /api/v1/data/NAME?sort=FIELD` answered 200 sorted by it, and so did the stdio MCP `query_records` with that `orderBy`.
- **Now.** The projection reports `{ sortable: false, reason: 'author-declared' }` for that field, so the grid header and the Sort picker, which read the projection, stop offering it. The Data API judges the sort by the same projection and refuses it with `400 INVALID_SORT` before any read, the answer a sort on a `formula` field already gets; the stdio MCP `query_records` refuses it the same way before the engine runs. Only the literal `false` counts: a field with no `sortable` key, or with `sortable: true`, sorts as before. A `formula` field also marked `sortable: false` keeps its `reason: 'virtual-type'` answer.
- **Stored sorts.** A list view whose `sort` names such a field, or a page `record:related_list` block whose `sort` does, used to load sorted and is now refused when it is read. Lint does not yet judge these at authoring. The upgrade-guide entry `field-sortable-false-sort-refused` lists them.
- **Not changed.** In-process callers that reach `ObjectQL.find` directly (hooks, flows) keep sorting by the stored column: the engine door judges only whether a column is stored, and `sortable: false` governs what the platform offers callers, not what its storage can do.

**The remedy.** Drop the sort on that field or sort by another one, in requests and in stored view and related-list sorts. An author who wants the field sortable removes `sortable: false` from it.
