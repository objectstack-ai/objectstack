---
"@objectstack/spec": major
---

refactor(spec)!: reconcile the SDUI component props with the renderers that serve them — 4 keys retired, 9 declared (#5775)

#5068 wired the first parse `ComponentPropsMap` ever had, and the corpus it
landed on diverged in **both** directions: keys objectui's renderers honour that
the schema never declared, and keys the schema declared — one of them
**required** — that no renderer has ever read. Maintainer ruling (2026-08-06),
direction A: the #5611 rule again, *the delivered and authorized shape is the
contract*.

The sharpest case is the record picker. It required `displayField`, which
appears in no renderer; `record-picker.tsx` resolves `props.labelField ?? 'name'`
and renders `row[labelField]`. So an author who followed the schema and wrote
`displayField: 'title'` got a dropdown listing `name`, with a success receipt and
no diagnostic anywhere — ADR-0078 exactly. Two spellings of one concept, of which
only the undeclared one was ever read.

**FROM → TO**

| was | now | fix |
|---|---|---|
| `element:record_picker` `displayField: string` (**required**) | `labelField?: string` | Rename the key; the value (a field name) is unchanged. Optional now — the renderer defaults to `name`. |
| `element:record_picker` `searchFields?: string[]` | *(removed)* | Delete the key. Use `filter` / `dataSource.filter` to restrict what the picker offers. |
| `element:record_picker` `multiple?: boolean` | *(removed)* | Delete the key. Multi-record selection is not implemented on this element. |
| `page:card` `body?: Component[]` | `children?: Component[]` | Rename the key; the value is unchanged. `footer` is a distinct slot and is untouched. |

`searchFields` and `multiple` go under ADR-0049 enforce-or-remove: the control is
a single-select `Select` with no search input, binding **one** record id into a
page variable — so `searchFields` narrowed nothing and `multiple: true` selected
nothing extra while reporting success. Either returns the day the capability is
implemented (#5021 / #4988 precedent); a declaration is not a roadmap.

Newly **declared**, because the renderers already honour them (nine keys, no
behaviour change — this is the schema catching up):
`element:record_picker` `labelField` / `valueField` / `label` / `emptyText`;
`record:path` `stages[].terminal` (`'won' | 'lost'`, honoured ahead of the
renderer's value/label token heuristic); `page:tabs` `items[].value` (the stable
`?tab=` URL token) and `items[].count`; `page:card` `children`; and `children` on
`page:section` / `page:footer` / `page:sidebar`, which were declared `EmptyProps`
— "zero props" — while all three renderers render a child list.

The retirement kit:

- Four `retiredKey()` tombstones in `ui/component.zod.ts`, each carrying its own
  prescription. `ComponentPropsMap`'s entries STRIP, so a bare deletion would
  have replaced one silent no-op with another; a tombstone types the key `never`
  (tsc at the authoring site) and raises the prescription at parse time.
- **ADR-0087 D2 conversions + D3 chain step** —
  `record-picker-display-field-to-label-field`, `record-picker-inert-keys-removed`,
  `page-card-body-to-children`, all `retiredFromLoadPath`, so `os migrate meta`
  rewrites sources and the loader stays loud. Region level is the reach, as for
  `page-header-subtitle-alias`: `PageComponentSchema` declares no children key, so
  a component nested inside another's `properties` is covered by the tombstone
  rather than the walk.
- `RETIRED_KEYS_BY_MAJOR[17]` entries for all four keys; baselines
  (`authorable-surface/ui.json`, `json-schema.manifest/ui.json`, `api-surface/ui.json`)
  and reference docs regenerated.
- Pins both ways: the prescription is asserted per key, and a clean parse is
  asserted not to materialize any of them.

Not in scope, deliberately: `page:card.visible` is a component-level visibility
predicate written into `properties` and hoisted by the renderer — a page to
rewrite onto the ADR-0089 `visibleWhen`, not a key to declare.

No runtime behaviour changes. The renderers already read the declared spelling of
every key, and the four retired ones never had an effect to lose.
