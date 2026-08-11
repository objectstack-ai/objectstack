---
"@objectstack/objectql": patch
---

fix(objectql): `expand` no longer silently no-ops when the nested `fields` omits `id` (#7537)

`expand: { account: { object: 'showcase_account', fields: ['name'] } }` answered
`200` with `account` still holding the **raw foreign-key id** — the expansion did
not happen, and nothing in the response said so. Adding `"id"` to the nested
projection made it work. The failing spelling is not an exotic one: it is the form
**prescribed verbatim** by two spec retirement messages,
`FIELD_NODE_OBJECT_FORM_REMOVED` and `QUERY_JOINS_REMOVED`, which both tell authors
migrating off the retired nested-select object form and off `query.joins` to write
`expand: { owner: { object: 'user', fields: ['name'] } }`. A caller who did exactly
what the error message instructed got a silent no-op.

**Cause.** `expandRelatedRecords` forwarded `nestedAST.fields` to the sub-read
verbatim and then keyed its lookup map on `rec.id`. A projection that did not name
`id` therefore produced rows with no `id`, an empty map, and an injection that fell
through `recordMap.get(String(val)) ?? val` — writing the original foreign key back.
Because the fallback is the caller's own id, "expanded" and "not expanded" were
indistinguishable in the response.

**Fix.** The join key is machinery, not a caller-chosen column, so it is now added to
the sub-read's projection unconditionally and **stripped back out** of the emitted
nested record when the caller did not ask for it. The prescribed spelling is made to
work rather than refused — refusing would turn two retirement messages' own migration
target into an error. `id` is the only join key there is: a reference field names a
target *object* (`referenceTargetOf`) and carries no target-column metadata, so the
batch filter is `{ id: { $in } }` by construction.

This covers every expand entry point (`find`, `findOne`, and recursive nested
expands), since all of them route through the one helper. The strip runs after the
recursive pass, which still needs the key to rebuild its map.

**Visible change beyond the fix.** A nested projection that omits `id` now emits a
nested record without `id`, matching the columns the caller named. Previously the
result depended on the driver: `SqlDriver` honours a projection exactly
(`builder.select(query.fields)`) and produced the no-op above, while
`InMemoryDriver.projectFields` force-adds `id` to every projection and so returned an
expanded record that carried an unrequested `id`. Both now emit exactly the projected
columns. Callers that read `.id` off such a record should add `id` to the nested
`fields` — on any SQL-backed store there was nothing to read there before, since the
value was still a plain foreign-key string.
