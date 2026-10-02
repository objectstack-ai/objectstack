---
'@objectstack/spec': minor
---

feat(spec)!: a `record:line_items` page block's props are a strict shape, and its columns are the inline grid column contract (#21142)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-record-line-items-props-closed -->

**BREAKING** — an accept-set narrowing on a published authoring surface: a new `ComponentPropsMap` row judges a props bag nothing judged before. Shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads the row: the component-props gate on `objectstack validate`, `objectstack build` and `objectstack lint`, which reports a failing key or column as an advisory `component-props-unknown-key` / `component-props-invalid` finding. A stored page still saves and loads, because a page component's `properties` is not parsed on the metadata save or load path.

**`@objectstack/spec`**

- **`ComponentPropsMap['record:line_items']`** — new row, `RecordLineItemsProps`. `record:line_items` was the one entry on the string-arm registration ledger (`STRING_ARM_REGISTERED_TYPES`, now empty), so the props gate skipped it as unregistered and any key rode through. The row declares the fifteen keys the console's `LineItemsPanel` reads: `childObject`, `relationshipField` (required), `columns` (required, at least one), `parentObject`, `parentId`, `recordId`, `amountField`, `totalField`, `title`, `readonly`, `minRows`, `maxRows`, `filter` (the ViewFilterRule array), `sort` (the SortItem array) and `limit` (a positive integer). `childObject` may come from the component-level `dataSource` binding instead. An unknown key is named. A near-miss gets its rename (`foreignKey` → `relationshipField`, `filters` → `filter`, …). The four keys of an `object-master-detail-form` detail entry that this block does not read (`addLabel`, `sortField`, `formFields`, `inlineMode`) are refused with the reason.
- **`columns`** references `InlineGridColumnSchema`, the strict, name-keyed column a relationship field's `inlineColumns` takes. The retired `field` spelling (and `fieldName`, `key`) is refused with the prescription naming `name`, and a column without `name` is refused. This block draws a column exactly as declared: it does not hydrate `label`, `type` or `options` from the child object's field, so `defineStack`'s identity-only column check does not reach it.
- **New types `RecordLineItemsProps` and `RecordLineItemsPropsParsed`.** They differ because a column's `readonlyWhen` / `requiredWhen` bare-string predicate normalizes to an Expression envelope at parse.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `columns: [{ field: 'title', label: 'Title' }]` | `columns: [{ name: 'title', label: 'Title' }]` |
| `{ childObject: 'invoice_line', columns: [...] }` with no `relationshipField` | `{ childObject: 'invoice_line', relationshipField: 'invoice', columns: [...] }` |
| `columns: []`, or no `columns` | at least one `{ name, label?, type?, … }` column |
| `addLabel`, `sortField`, `formFields` or `inlineMode` on the block | the block without that key |
| any other key the shape does not declare | the block without that key |

The one-line fix: key every column `name`, give the block its `relationshipField` and at least one column, and remove any key the shape does not declare.

## Who is affected, measured

On `origin/main` `1ecb871beb`: one authored `record:line_items` block in the examples, the showcase project detail page. All five of its columns were keyed `field`, so its Tasks grid rendered empty cells; they are keyed `name` in this change. No documentation example authors the block. Deployed metadata was not measured.
