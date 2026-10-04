---
'@objectstack/spec': minor
---

feat(spec)!: an `object-grid` page block's `exportOptions` is the list view's export options object, and a bare format array is refused (#21229)

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-object-grid-export-options-closed -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings. What reads the row: the component-props gate on `objectstack validate`, `objectstack build` and `objectstack lint`, which reports a refused value as an advisory `component-props-invalid` / `component-props-unknown-key` finding. A stored page still saves and loads, because a page component's `properties` is not parsed on the metadata save or load path.

**`@objectstack/spec`**

- **`ComponentPropsMap['object-grid'].exportOptions`** was `z.unknown()`, so any value passed. The console's `ObjectGrid` reads `exportOptions.formats`, `.maxRecords`, `.includeHeaders`, `.fileNamePrefix` and `.streaming`, and lifts nothing: a bare format array — legal on a list view, which lifts it to `{ formats }` at parse — showed the export menu with its csv/json default and dropped the author's list without a report. The row now takes the list view's own five-member export options object, by identity and not the list view's union, so the legacy spelling does not spread to the grid:
  - a bare array is refused with the object form named (`{ formats: ['csv', 'xlsx'] }`);
  - a format outside `csv` / `xlsx` / `json` is refused at its index, and `pdf` keeps its retirement text;
  - a key the object does not declare is named, with the rename a near-miss gets (`maxRecord` → `maxRecords`);
  - `null` and other non-object values are refused.
- **`ObjectGridProps['exportOptions']`** (and `ObjectGridPropsParsed`) is the object type `{ formats?, maxRecords?, includeHeaders?, fileNamePrefix?, streaming? }` instead of `unknown`.
- The list view's `exportOptions` accepts and lifts exactly what it did. One message changed there, nested only: when a bare array also fails the array arm (a format outside the enum), the object arm's branch of the union now names the object form instead of zod's `expected object, received array`.

## FROM → TO

| you wrote on an `object-grid` | write instead |
|:--|:--|
| `exportOptions: ['csv', 'xlsx']` | `exportOptions: { formats: ['csv', 'xlsx'] }` — the grid now offers exactly those formats; write `{}` to keep the csv/json default it has been offering |
| `exportOptions: { formats: ['csv', 'pdf'] }` | `exportOptions: { formats: ['csv'] }` |
| `exportOptions: { formats: ['csv'], maxRecord: 100 }` | `exportOptions: { formats: ['csv'], maxRecords: 100 }` |
| `exportOptions: null` | omit `exportOptions` |

The one-line fix: write `exportOptions` on an `object-grid` as the object `{ formats?, maxRecords?, includeHeaders?, fileNamePrefix?, streaming? }`, with `formats` drawn from `csv`, `xlsx` and `json`.

## Who is affected, measured

On `origin/main` `f148852752`: zero `object-grid` blocks authoring `exportOptions` in the examples, the package fixtures, the documentation and the published skills, against ten authored `object-grid` blocks through the same census (nine in TypeScript, one in a YAML documentation example) and four list-view `exportOptions` authorings as the key's control. No conversion is registered: nothing on the metadata load path refuses the shape, and a bare array has no rewrite that both keeps what the grid shows today and honours the author's list. Deployed metadata was not measured.
