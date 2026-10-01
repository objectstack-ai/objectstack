---
'@objectstack/spec': minor
---

feat(spec)!: an analytics dataset dimension's and measure's `field` is a column reference — a SQL expression there is refused at parse, as it already is on the cube members a dataset compiles to (#21220)

Clause-②: yes (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner, the `(narrowing)` arm above and the ADR-0087 disposition below,
never by the level).

`DatasetDimensionSchema.field` and `DatasetMeasureSchema.field` — the `field` of
every entry in an ADR-0021 dataset's `dimensions` and `measures` — admit a column
reference only: a field of the dataset's object (`amount`), or a relationship path
of bare identifiers ending in one (`account.amount`, `account.owner.region`); a
measure also admits `'*'` for a count, and a count may still omit `field`. Any
other value — an arithmetic, an aggregate, a `CASE`, a subquery, a function call,
a quoted or `$`-prefixed spelling, a padded or empty string, a broken path — is
refused at `dimensions.N.field` / `measures.N.field` with a prescription, and so
is `'*'` on a dimension.

Why: the dataset layer was declared to take no raw SQL (ADR-0021 "zero raw SQL /
zero raw expressions") and `field` was documented as a field or a relationship
path, but it was a bare string and parsed anything. The analytics dataset door
already refused a non-column `field` on every query (`PERMISSION_DENIED` / 403,
inline or saved), so such a dataset could be saved and never answered — declared,
never enforced (ADR-0049). The accept set is the one the cube members a dataset
compiles to already hold: the dataset compiler copies `field` into the member's
`sql` verbatim, and both now read one shared declaration. `'*'` is refused on a
dimension because grouping by every column is no axis — both analytics strategies
answered such a dimension `500`. The rule is a `pattern` in the published JSON
Schema too, so a document validated against `json-schema/**` is judged as the
parse judges it.

## FROM → TO

```
FROM  defineDataset({ name: 'task_metrics', label: 'Task Metrics', object: 'task',
        dimensions: [{ name: 'priority', field: 'priority' }],
        measures: [
          { name: 'task_count', aggregate: 'count', field: '' },
          { name: 'done_points', aggregate: 'sum',
            field: "CASE WHEN status = 'done' THEN points ELSE 0 END" },
        ] })
      -> parsed; the dataset door refused the expression on every query
TO    -> ZodError at measures.0.field and measures.1.field (invalid_format):
         `measures[].field` is a column reference: a field of the dataset's object …

      defineDataset({ name: 'task_metrics', label: 'Task Metrics', object: 'task',
        dimensions: [{ name: 'priority', field: 'priority' }],
        measures: [
          { name: 'task_count', aggregate: 'count' },
          { name: 'done_points', aggregate: 'sum', field: 'points', filter: { status: 'done' } },
        ] })
```

A conditional count or sum is a measure with its own structured `filter`; a
ratio, sum, difference or product of measures is `derived: { op, of: [...] }`
over measures named in the same dataset. **Mind the scale:** a `derived` ratio is
a 0–1 fraction, so an expression that multiplied by 100 returned percentage
points — pair the ratio with a `%` numeral pattern. A dimension that bucketed a
column with an expression has no expression form: group by the column itself, or
keep the bucket as a field of the object and name that field.

**The one-line fix:** parse each dataset; every refusal at `…field` is one member
to change — name the column, omit `field` on a plain count (never `field: ''`),
or move the computation to a measure `filter` or a `derived` measure.

**What an author who still writes it sees.** `DatasetSchema`, `defineStack({
datasets })` (`STACK_SCHEMA_INVALID` / 422), the `dataset` write door and
`POST /api/v1/analytics/dataset/query` (which parses every dataset it is handed,
inline or saved, and now answers `400 VALIDATION_FAILED` at the path where it
answered `403 PERMISSION_DENIED` before) refuse the member at its `field` path
with the prescription. `tsc` does not: the key's type is still `string`.

## The retirement kit

- **Schema.** `ui/dataset.zod.ts` holds both keys to the pattern; the pattern is
  declared once, in the non-public `data/analytics-column-reference.ts`, and the
  cube layer's `CUBE_MEMBER_SQL` is that same `RegExp`. A dimension's pattern is
  the same column path without the `'*'` arm. A column reference parses
  byte-identically to before.
- **ADR-0087.** The D3 entry `dataset-member-field-expression-refused`, with its
  step-18 rationale fragment. No D2 conversion — an expression has no mechanical
  rewrite into a column — and no `RETIRED_KEYS_BY_MAJOR` row: no key left the
  shape, so the authorable-surface, api-surface and JSON-schema manifest ratchets
  are unchanged.
- **Liveness.** The `dataset` ledger rows `dimensions.field` and
  `measures.field` stay `live`, re-verified, with the narrowing recorded.
- **Docs.** The `ui/dataset` reference page is regenerated.
- **Runtime.** Unchanged: the analytics dataset door's refusal stays as defence
  in depth for a dataset that reaches the service without meeting the parse — a
  row stored before this change, which the build probe hands over as read.

## Reach, measured

- This repository: no authored dataset carries a non-column `field` — the
  examples, `platform-objects`, the hand-written docs and the published skills
  were read. Two test fixtures that sent an expression `field` on purpose were
  re-pinned: the service door's test builds them unparsed, and the REST route's
  test now expects the route's `400`.
- Studio's dataset inspector (objectui) seeds a new dimension or measure row with
  `field: ''`; a measure left that way as a plain count is now refused at save
  with the prescription to omit the key. It parsed before; its query answered
  `500` on the ObjectQL path (SQLite's native-SQL path happened to accept the
  `COUNT()` it compiled to).
- Out-of-repo authored datasets: NOT MEASURED.

<!-- adr-0087: registered dataset-member-field-expression-refused -->
