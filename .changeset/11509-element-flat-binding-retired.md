---
'@objectstack/spec': major
'@objectstack/lint': major
---

feat(spec)!: an element binds data through the node-level `dataSource` only — the flat `object` / `filter` / `sort` / `limit` of `element:record_picker`, `element:number` and `element:repeater`, and `object-grid.defaultFilters`, are retired (#11509)

Clause-②: no (narrowing: the ten element-layer flat data-binding keys and `object-grid.defaultFilters` leave the accept set, and the component-props gate's `dataSource.object` waiver becomes a refusal)

<!-- adr-0087: registered element-flat-data-binding-retired, object-grid-default-filters-retired -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `major` on the v18 line (`.changeset/pre.json` is open on `main` in `next` pre mode, so the release is `18.0.0-next.*`). `@objectstack/lint` is `major` with it: its component-props rule refuses what it used to waive.

**Why.** One page element carried two doors onto one query. Each of these flat keys was the same query as a key of the node-level `dataSource` binding (`ElementDataSourceSchema`), and the three renderers resolved them by three contradictory rules: the record picker let the binding win, `element:number` AND-combined the two filters, and the repeater read the flat keys alone and ignored the binding — while the component-props rule waived a missing flat `object` whenever `dataSource.object` was present, so a repeater bound only through `dataSource` passed `os validate` and drew "No records". The console moved all three elements onto the binding first (objectui#11880); from this release the binding is the one door. `object-grid.defaultFilters` was the legacy second spelling of `filter`, read only when `filter` lowered to nothing.

**What changes.**

- **`@objectstack/spec`.** `ElementRecordPickerPropsSchema` `object` / `filter` / `sort` / `limit`, `ElementNumberPropsSchema` `object` / `filter`, `ElementRepeaterPropsSchema` `object` / `filter` / `sort` / `limit` and `ObjectGridPropsSchema` `defaultFilters` are `retiredKey()` tombstones: each is refused at its key with the prescription, and its input type is `never`. The repeater's other spellings of its query keys (`objectName`, `where`, `orderBy`, `top`, …) now point at the binding. The `object-*` blocks keep their own keys, and the relationship-scoped blocks are unchanged.
- **`@objectstack/lint`.** `validate-component-props` (`component-props-invalid`, warning) reports an `element:record_picker`, `element:number` or `element:repeater` node with no `dataSource.object` at that path, instead of waiving the flat `object` for any type whose binding names one. A flat key is reported by its tombstone.
- **Conversions (stored rows, artifacts, `os migrate meta --from 17`).** `element-flat-data-binding-to-data-source` moves a flat key the binding lacks onto it, deletes one the binding already set where the binding won, and appends `element:number`'s flat filter to the binding's (they always AND-combined). It leaves for the author, as a TODO: a record-picker key beside a `dataSource.view` that sets no such key of its own, a repeater key the binding sets to a different value or beside a `view`, and an `element:number` filter pair that is not two rule arrays. `object-grid-default-filters-removed` moves `defaultFilters` onto an empty `filter` (absent, `null`, `[]` or `{}`) and deletes it beside a `filter` that has rules. Both run before `page-component-filter-record-to-rule-array`, which then converts a moved record-form filter at its new door. Both are retired from the load path: an author is refused at the parse.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `{ type: 'element:record_picker', properties: { object: 'deal', limit: 20, labelField: 'name' } }` | `{ type: 'element:record_picker', dataSource: { object: 'deal', limit: 20 }, properties: { labelField: 'name' } }` |
| `{ type: 'element:number', properties: { object: 'deal', aggregate: 'count', filter: [...] } }` | `{ type: 'element:number', dataSource: { object: 'deal', filter: [...] }, properties: { aggregate: 'count' } }` |
| `{ type: 'element:repeater', properties: { object: 'deal_note', sort: [...], titleField: 'subject' } }` | `{ type: 'element:repeater', dataSource: { object: 'deal_note', sort: [...] }, properties: { titleField: 'subject' } }` |
| `object-grid` `properties: { defaultFilters: [...] }` (no `filter`) | `properties: { filter: [...] }` |
| `object-grid` `properties: { filter: [...], defaultFilters: [...] }` | `properties: { filter: [...] }` — the fallback was never read beside a `filter` with rules |

**The one-line fix: move each key from `properties` to the node's `dataSource` (a sibling of `type`), unchanged; rename `defaultFilters` to `filter` where `filter` is empty, and delete it where it is not.**

**For a consumer that pins both repositories:** its objectui pin moves past objectui#11880 no later than its objectstack pin moves past this release — the converted shape is one only that objectui reads.

**Who is affected, measured.** This repository authors none of the eleven keys: its one element-layer author (the showcase record picker) already binds through `dataSource`, and a tree-scoped absence pin (`packages/spec/src/ui/element-flat-binding-retirement.test.ts`) keeps it that way. Other repositories and deployed metadata were not measured here.

### The retirement kit

- `RETIRED_KEYS_BY_MAJOR[18]`: `ui/ElementRecordPickerProps:object|filter|sort|limit`, `ui/ElementNumberProps:object|filter`, `ui/ElementRepeaterProps:object|filter|sort|limit`, `ui/ObjectGridProps:defaultFilters`. D3 entries `element-flat-data-binding-retired` and `object-grid-default-filters-retired`, each with a step-18 rationale fragment. They absorb the three protocol-18 narrowings of the same keys to the rule array (`element-number-filter-rule-array`, `element-record-picker-filter-rule-array`, `object-grid-default-filters-rule-array`), whose keys are gone in the same major; `page-component-filter-record-to-rule-array` drops the retired doors from its reach.
- Generated: `authorable-surface/ui.json` (11 rows `[RETIRED]`) and the `ui/component` reference page. Hand-edited ledger: `dropped-refinements.baseline.json` loses the three rows whose only dropped refinement was a retired `filter`.
- Pins: the tombstones, the binding, both conversions and the tree-scoped absence walk in `element-flat-binding-retirement.test.ts`; the missing-binding refusal and the repeater trap in `validate-component-props.test.ts`; the docs gate's twin in `check-yaml-examples.ts --self-test`.
