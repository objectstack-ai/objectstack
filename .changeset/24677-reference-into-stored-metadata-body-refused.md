---
'@objectstack/lint': minor
'@objectstack/spec': patch
---

fix(lint)!: a `lookup` or `master_detail` field whose `reference` is a stored-metadata-body table is refused where it is declared

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No spec key, stored shape or authorable spelling is added, removed or renamed. The expression rule's object pass now refuses one field declaration it accepted before: a `lookup` or `master_detail` whose `reference` is `sys_metadata` or `sys_metadata_history`, which the engine never hydrates. Nothing stored is rewritten, so there is nothing for `objectstack migrate meta` to convert; the `@objectstack/spec` change is the text of the `reference` describe only. -->

**BREAKING** (an authoring narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A `lookup` or `master_detail` whose `reference` names a table of the stored-metadata-body family (`STORED_METADATA_BODY_OBJECTS`: `sys_metadata`, `sys_metadata_history`) is an error. The engine never hydrates such a field: `$expand` keeps the stored id and never nests the row, a formula or a validation rule never reads through it, and a master-detail child's `parent` root stays unbound, so every write a `parent` rule judges is refused. `os validate`, `os build` and the object save door (`PUT /api/v1/meta/object/:name`, and a draft's promotion) run the same pass, under the existing `EXPRESSION_INVALID` rule, located at the field's `reference`.

- FROM: `meta: { type: 'lookup', reference: 'sys_metadata' }` (or a `master_detail`, or `sys_metadata_history`) saved with a 200 and built with exit 0, and then only ever showed an id. TO: refused, with `422 INVALID_METADATA` at the save door and an error at `os validate` / `os build`. The message names the field, its type and the target, and ends on the family's one prescription.
- A reference to any other table, platform tables such as `sys_user` included, is unchanged.
- The refusal of a formula or a validation rule that reads through such a field is unchanged, and is still reported at that expression.
- A stored object row that already declares such a field keeps loading: no authoring rule runs when a stored row is rehydrated, and the engine guards keep refusing every relationship read into the family. Its next active save, or a draft's promotion, through the metadata API is refused until the field is removed or retargeted. The engine guards stay, for every path that runs no authoring rule.
- `@objectstack/spec` (`patch`): the `reference` describe states the convention, so the generated field reference says it too.

What to do. Remove the field, or retarget it. To point a record at a metadata item, store the item's type and name in `text` fields and read the item through the metadata API (`GET /api/v1/meta/:type/:name`), where its body is projected.
