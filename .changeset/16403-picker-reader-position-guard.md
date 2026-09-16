---
"@objectstack/lint": patch
---

`filter-preset-comparand` enters its `publicPicker` object-binding reader by SCHEMA POSITION rather than by key name, so a node that merely spells `publicPicker` no longer takes its whole filter subtree out of the field-typed arm (#16403).

`bindAncestors` walked out through a filter's ancestors and matched `if (key === PUBLIC_PICKER_KEY)` on the property NAME. `walkAuthoredFilters`/`scanForFilters` recognise a filter by key at ANY depth on all eight scanned collections, so that reader was reachable from any node named `publicPicker`, anywhere. Its unresolvable exit is `undefined` — no bound object, so arm 2's field-type oracle answers `false` for every key and the subtree is judged by nobody.

- **No live defect today**: `publicPicker` is declared exactly once as a schema key, on `FormFieldBaseSchema` (`packages/spec/src/ui/view.zod.ts`), and there the reader is correct. What changed is the failure mode the day a second schema declares the same name: it would have inherited this branch silently. Under-reporting is this rule's only permitted failure direction, so the hole would never have VIOLATED that invariant — it would have quietly spent it, where no test asking "was the invariant violated?" could see it.
- **The guard is on the entry, not the exits**: the branch now requires the enclosing ancestor to be a form field (`field`, required on `FormFieldBaseSchema`) — the same read the branch already had to make one line later, so no new coupling between the lint package and the form-view schema. The three exits `#16106`'s review pinned (the `picker.object` override, the `reference` resolution, and the `undefined` no-fall-through) are byte-for-byte unchanged.
- **The `#16106` B1 false refusal stays closed**, measured: a form field's picker filter over a referenced `select` column that shares its name with a parent `date` column still reports nothing, and the positive control — the same filter where the REFERENCED object declares the field as a `date` — still reports at `views[0].sections[0].fields[0].publicPicker.filter[0].value`.
