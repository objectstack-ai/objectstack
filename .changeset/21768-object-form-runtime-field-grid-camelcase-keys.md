---
'@objectstack/spec': minor
---

feat(spec): an inline `object-form` field declares the `grid` widget's eight camelCase field-level keys, and each snake_case spelling is refused naming its camelCase key (#21768)

Clause-②: yes (widening)

A widening of a published authoring surface: every value that parsed before still parses, and eight keys that were refused now parse. What reads the rows: the component-props gate on `objectstack validate`, `objectstack build` and `objectstack lint`.

**`@objectstack/spec`**

- **The runtime form field takes the `grid` widget's field-level keys.** An `object-form` `customFields` member, and the inline entry of an `object-form` or `object-master-detail-form` section's `fields`, now declare `minRows` and `maxRows` (numbers), `allowAdd`, `allowDelete` and `allowReorder` (booleans, on unless `false`), and `totalField`, `addLabel` and `sortField` (strings). These are the value types objectui's `GridFieldMetadata` declares. The `grid` widget reads each one off a `type: 'grid'` field: `minRows` stops Remove, `maxRows` stops Add, Duplicate and the blank entry row, `addLabel` labels the Add button, and `sortField` names the row field the grid stamps with each row's index, so a drag-reorder is saved. objectui renamed the eight from snake_case to camelCase, with no dual read, and the `.objectui-sha` pin `9dfaca654311` carries that rename.
- **`totalField` here is the CHILD column the grid sums into its footer.** On `record:line_items` and on an `object-master-detail-form` detail entry, the same spelling names the PARENT field the sum is saved to, and their child column is `amountField`. The describe states the difference. The other blocks' keys are unchanged.
- **The snake_case spellings are still refused, and each refusal now names its own replacement.** `min_rows`, `max_rows`, `allow_add`, `allow_delete`, `allow_reorder`, `total_field`, `add_label` and `sort_field` are each answered with "Rename the key to `minRows`" (and so on); the value stays the same. The old answer said the keys would come in once the widget read a camelCase spelling, and the widget now does. Two retired spellings on one field get one line each.
- **`record:line_items`' `sortField` refusal** now says no block takes an authored `sortField` *for child records*. An inline `grid` field takes one for the rows of its own value, so the unqualified sentence was no longer true.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `customFields: [{ name: 'items', type: 'grid', min_rows: 1, allow_add: false }]` | `customFields: [{ name: 'items', type: 'grid', minRows: 1, allowAdd: false }]` |
| `total_field: 'amount'` on an inline grid field | `totalField: 'amount'`, naming the child column summed |
| `add_label: 'Add line'`, `sort_field: 'position'` | `addLabel: 'Add line'`, `sortField: 'position'` |

The one-line fix: rename each key to its camelCase spelling, keeping its value. Nothing that parsed before is refused, so no ADR-0087 conversion or D3 entry is owed.

## Who is affected, measured

- **objectstack** at `75ddcd1b41` (this branch's base): no writer of either spelling on an inline form field in `examples/`, `skills/`, `content/docs/` or `apps/`. The spec's own pin is the only one: its `min_rows` refusal probe.
- **objectui** at the pin `9dfaca654311`: the camelCase writer is the schema catalog's `fields-grid/line-items-grid` example, a `grid` field carrying all eight keys, and it parses. No production source reads a snake_case spelling. The only snake_case occurrences left are objectui's own refusal faces: the TS tombstones, the zod alias refusals, and the widget's refusal.
- **hotcrm**, **cloud** and deployed metadata were not measured.
