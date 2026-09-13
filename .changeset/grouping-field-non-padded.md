---
"@objectstack/spec": minor
---

fix(spec)!: `grouping.fields[].field` refuses a padded field name instead of handing three renderers a lookup that always misses (#17360, ruling C on objectui#7347)

<!-- adr-0087: registered ui-list-view-grouping-field-padded-refused -->

**BREAKING** — an accept-set narrowing on a published authoring surface. `GroupingFieldSchema.field` was a bare `z.string()`, so `'  business_unit  '` was valid authored metadata; it is now refused at parse. Shipped as `minor` under the repo's launch-window convention for accept-set narrowings. Stored metadata carrying a padded grouping name now fails validation and must be re-authored — the hand-migration prescription is registered under protocol major 18 as `ui-list-view-grouping-field-padded-refused`.

## What was wrong

The padded name never failed anywhere. It failed to *group*.

Measured on objectui (M1–M11, with live controls): the projection harvester `collectGroupingFieldRefs` **trims** the name when it builds `$select`, while **three** renderers bucket rows by the **raw** name — plugin-grid `usableGroupingFields`, plugin-list `ObjectGallery.groupedItems`, plugin-kanban `effectiveSwimlaneField`. So the server answers under `business_unit`, every per-row lookup asks for `'  business_unit  '`, reads `undefined`, and the view collapses into one `(empty)` group (grid, gallery) or one `Uncategorized` lane (kanban) holding every record.

That is a silent wrong answer that reads as a true statement about the data: a user looking at one giant `(empty)` group has no way to tell it apart from a dataset where the field genuinely is empty. Nothing weaker than a parse refusal is honest about it.

## What it does now

`grouping.fields[].field` carries a **non-padded** pattern — no leading and no trailing whitespace. The refusal lands at `grouping.fields[N].field` (the offending element's own key, not the view or the array) and names the offending spelling verbatim, so the whitespace an author cannot see in an editor is visible in the message, together with the trimmed name to write instead.

⛔ **Not a `.trim()`.** A trimming schema makes `'  a  '` and `'a'` silently equivalent, which is the consumer-tolerance direction AGENTS.md #0.1 refuses: the padded spelling is a mistake the author should be told about, not a dialect the producer quietly normalises away. objectui's harvester trim stays as defence-in-depth; nothing is removed there.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `grouping: { fields: [{ field: '  business_unit  ' }] }` | `grouping: { fields: [{ field: 'business_unit' }] }` |
| `grouping: { fields: [{ field: 'status\n' }] }` | `grouping: { fields: [{ field: 'status' }] }` |

The remedy is always the same: write the field name exactly as the object declares it and the server answers under. If a view has been silently showing one `(empty)` group, re-authoring the name is also the fix for that.

## Scope — what is deliberately NOT narrowed

- **The blank name is unchanged.** It is already refused loudly one layer down by `compileListViewGroupQuery`'s `grouping_field_blank` (`400`, path `['grouping','fields',N,'field']`). This narrowing exists for the **silent** case; the empty string still parses here exactly as before.
- **This is not the snake_case machine-name grammar.** `packages/spec` spells `/^[a-z_][a-z0-9_]*$/` inline for object, field and tool **names**, and this key deliberately does not take it: a grouping level is authored as a field **reference**, and a dotted relationship path (`owner.name`) is an in-tree spelling of one. The ruling asked for a non-padded pattern and this is exactly that — nothing wider, nothing narrower.
- **The sibling `groupByField` axis** (kanban / gantt / timeline) is symmetric and is **not** touched by this change.

## Who is affected, measured

Every `grouping.fields[].field` spelling in this repo parses unchanged: 50 literal occurrences under a `grouping:` key across 19 files, harvested with the TypeScript parser and cross-checked against a deliberately over-approximating second pass over 906 shape-exact `{ field, order?, collapsed? }` literals in `packages/**`. The single harvested spelling this refuses is `' '` in `view-grouping-query.test.ts` — a **negative** fixture handed straight to `compileListViewGroupQuery` with no parse on its path, pinning that same `grouping_field_blank` refusal. Nothing in the tree reddens.

Outside the repo, only metadata that was already grouping wrongly is affected: a padded name has never produced a correct grouped view on any renderer.

## Consumer

**objectui#7347 unblocks on the INSTALLABLE RELEASE of this package, not on merge.** Its side of the work — a pin bump plus a regression test that a padded name is refused before it reaches any renderer — needs a published `@objectstack/spec` to depend on, so it stays `pm:blocked` until this ships in a release a consumer can install. The gallery and kanban sites are covered by this one producer fix and get no cards of their own.
