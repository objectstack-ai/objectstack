---
"@objectstack/spec": minor
---

feat(spec): strict element schemas for `Field.inlineColumns` and `Field.relatedListColumns` (#9227)

**BREAKING** accept-set narrowing on a published authoring surface, landing
after the v17.0.0 cut (the lockstep launch-window convention ships it as
`minor`, the #9221/#9250 precedent).

Both keys were `z.array(z.any())`: every column object validated — right keys,
wrong keys, misspelled keys, empty objects — so a mis-keyed column published
clean and surfaced only in the browser, as a grid with the right row count and
every cell blank (the objectui#3951 failure, reachable from the authoring side).

- `inlineColumns` entries are now `InlineGridColumnSchema` (exported): a
  strict, `name`-keyed column mirroring the objectui inline-grid renderer's
  measured reads — `name` (required), `label?`, `type?`, `width?`, `required?`,
  `options?`, `prefix?`, `step?`, `reference?`, `displayField?`, `idField?`,
  `multiple?`, `accept?`, `defaultHidden?`, `computed?`, `expr?`, `scale?`,
  `autofill?`, `readonlyWhen?`, `requiredWhen?`. Unknown keys are a named
  rejection at publish time; the retired `field` spelling is refused with the
  prescription naming `name` (objectui#3951 aligned the widget to `name` with
  deliberately no tolerant alias). `expr` is the grid evaluator's BARE
  arithmetic string — a CEL envelope there is refused. Identity-only entries
  (`{ name: 'quantity' }`) remain the recommended form: objectui's
  `hydrateColumns` fills everything else from the child object's fields.
- `relatedListColumns` entries are now child FIELD-NAME STRINGS (e.g.
  `['name', 'status']`) — the only authored form in-repo and the only form the
  related-list renderer hydrates fully (labels, cell types and formatting
  derive from the child object's field definitions); the page-block sibling
  `record:related_list.columns` is the same strings-only shape. A column
  object is refused with a prescription pointing at the child fields.

Migration: respell `{ field: 'x' }` inline-grid columns as `{ name: 'x' }`;
replace related-list column objects with the child field name string. The one
in-repo usage (`examples/app-showcase` invoice line items) is migrated in this
change.
