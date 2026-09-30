---
'@objectstack/spec': minor
---

The `grouping` prop of the `object-grid` and `object-kanban` page blocks is now judged by the list view's own `GroupingConfigSchema`, so a padded grouping field name or a wrong-shaped value is refused on these blocks exactly as it is on `list-view` (#20831).

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-object-block-grouping-config-typed -->

**BREAKING**: `ComponentPropsMap['object-grid'].grouping` and `ComponentPropsMap['object-kanban'].grouping` were `z.unknown()`, so any value parsed. Both now take `GroupingConfigSchema` by reference: `{ fields: [{ field, order?, collapsed? }, ...] }`, at least one entry, each `field` the stored name with no leading or trailing whitespace. Both renderers already read exactly that shape: the grid groups by every `grouping.fields[i].field` and reads `order` / `collapsed`, and the kanban board takes `grouping.fields[0].field` as its swimlane field when no `swimlaneField` is authored. A value outside it validated green before and rendered one `(empty)` group on the grid, or one swimlane holding every card on the board, with no error.

What is refused now, and the one-line fix for each:

| Authored `grouping` | Refused as | Write instead |
| --- | --- | --- |
| `{ fields: [{ field: '  business_unit  ' }] }` | `custom` at `grouping.fields.0.field`, naming the received value | `{ fields: [{ field: 'business_unit' }] }` |
| `'business_unit'` (a bare string) | `invalid_type` at `grouping` | `{ fields: [{ field: 'business_unit' }] }` |
| `42`, `true`, or any other non-object | `invalid_type` at `grouping` | delete the key; it never grouped anything |
| `{ fields: [] }` | `too_small` at `grouping.fields` | delete the key |
| `{ fields: [...], showCounts: true }` (an undeclared key) | `unrecognized_keys` at `grouping` | delete the undeclared key |

On `object-kanban`, an authored `swimlaneField` still wins over `grouping`; when both are set, deleting `grouping` is the whole migration. A fully-spelled grouping parses byte-identically; a short entry `{ field }` parses clean and gains the list view's defaults (`order: 'asc'`, `collapsed: false`), which is how the grid already read it.

Where it surfaces: the component-props gate reports a refused value as a `component-props-invalid` finding at the offending path on `os validate`, `os build` and `os lint` (advisory, as every finding of that gate is). A page component's `properties` are not parsed on the metadata save path, so a stored page keeps loading and rendering as it does today until its source is fixed; the ADR-0087 semantic entry `ui-object-block-grouping-config-typed` carries the same table for `os migrate meta`.

The published JSON Schemas for `ObjectGridProps` and `ObjectKanbanProps` now describe the `grouping` shape; the non-padded field-name rule is a runtime refinement the JSON Schema does not express, recorded for both as `grouping.fields.element.field` in `dropped-refinements.baseline.json`, beside the same site on every list-view schema.
