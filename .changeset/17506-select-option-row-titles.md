---
"@objectstack/spec": patch
---

`SelectOptionSchema`'s six row properties carry a JSON Schema `title`, so Studio's property panel stops printing raw machine keys as the column headers of a field's `options` table (#17506).

Clause-②: no

Studio renders a `type: 'repeater'` form field as a table whose column headers read `items.properties[k].title ?? k` off the JSON Schema derived from the metadata type schema. `SelectOptionSchema` carried no `title` on any row property, so the fallback arm ran and the maker saw `label` / `value` / `description` / `color` / `default` / `visibleWhen` inside an otherwise translated panel — **in every locale, English included**. Titles are hard-coded English by design: `system/translation.zod.ts` states that a row property renders from `items.properties[k].title`, and `resolveMetadataFormSchemaTitles` only ever REPLACES a title that is already there, so an untitled property has no layer for a translation to overlay.

- **One edit clears two carriers.** `field:options` and `object:fields.options` resolve to the *same* `SelectOptionSchema` object — `FieldSchema.options` is `z.array(SelectOptionSchema)` and `object.fields` is a `z.record(..., FieldSchema)` of that same `FieldSchema` — verified by object identity (`===`) against the schemas `getMetadataTypeSchema('field')` and `getMetadataTypeSchema('object')` actually return, with `FormSelectOptionSchema` as the firing control that the probe can tell two schemas apart. Both entries are deleted from the shrink-only `repeater-item-titles` ledger in the same change; `object.zod.ts` needed no edit.
- **Nothing the schema accepts or refuses moved.** `.meta({ title })` is presentation metadata: the generated `authorable-surface/` artifacts are byte-identical, and the pinned accept/refuse suites for this shape (`editability-boundary`, `visible-when-alias-guidance`, `form-select-option`, `evaluated-slot-population`) pass unchanged.
- **The form-view face inherits the titles for free.** `FormSelectOptionSchema` is a shape-level Omit that reuses the same property schema instances, so the five keys it keeps arrive titled too, and its `default`-refusal is untouched.
