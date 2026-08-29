---
'@objectstack/spec': minor
---

feat(spec): narrow the per-option `default` key OUT of the form-view options vocabulary — the object-field face keeps it enforced (#12868)

**BREAKING** accept-set narrowing on the published FormView vocabulary, shipped
as `minor` under the repo's launch-window convention for breaking changes.

<!-- adr-0087: registered form-view-option-default-removed -->

`SelectOptionSchema` serves two surfaces, and only one of them reads the
per-option `default` key:

- **Object-field options** (`Field.select.options`): ENFORCED and UNTOUCHED —
  `applyFieldDefaults` falls back to the option marked `default: true` when the
  field declares no `defaultValue`, `defaultValue` wins when both are declared,
  and the alias rows (`isDefault`/`selected` → `default`) stay.
- **Form-view options** (`FormFieldSchema.options` inside a FormView): the same
  key parsed clean and nothing read it — the engine's insert-path fallback
  consults the OBJECT definition's options, never a form view's, and no form
  renderer seeds a value from it. The maintainer-ruled disposition (2026-08-28,
  disposition 甲) narrows the key out of this face only. The ruled census
  measured ZERO occurrences of `default` (and the alias spellings
  `isDefault`/`selected`) inside form-view options across the tree, the example
  apps and the published `*.form.ts` corpus, with the instrument's positive
  control hitting the enforced object-field usages.

FROM → TO, and the one-line fix:

- FROM: `{ field: 'status', type: 'select', options: [{ label: 'Open', value: 'open', default: true }] }`
  inside a form view's `sections[].fields[]` (or nested `fields`) — parsed
  clean, did nothing.
- TO: delete the key from the form-view option. Declare the pre-selected choice
  on the OBJECT definition instead — field-level `defaultValue`, or
  `default: true` on that field's own `options` entry (both enforced there).
- The new `FormSelectOptionSchema` (an Omit-derivation of `SelectOptionSchema`
  minus exactly `default`) refuses the key with a tombstone prescription
  carrying this mapping; `isDefault`/`selected` get guidance pointing at the
  object definition instead of a rename toward a key the shape refuses.
- The protocol-18 conversion `form-view-option-default-removed` strips the key
  from stored sources (pure lossless delete — it never had an effect on this
  surface to lose). Run `os migrate meta --from 17` to list the mechanical
  edits for existing sources; apply them by hand.
