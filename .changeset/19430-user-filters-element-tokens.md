---
'@objectstack/platform-objects': patch
---

Keep the `userFilters` element tokens English in the translated metadata-form tooltips

`metadataForms.view.fields.userFilters.helpText` names the legal values of `UserFiltersSchema.element`, a strict `z.enum(['dropdown', 'tabs', 'toggle'])`, and it is the only place the `view` panel names them at all. All three translated catalogs rendered those tokens as ordinary words — 下拉 / 标签页 / 开关, ドロップダウン / タブ / トグル, desplegable / pestañas / interruptor — so an author working in a translated locale was shown a value the schema refuses.

The enum values are now verbatim English inside the translated sentence and the prose around them stays translated, matching the shape the `page` Interface panel already uses for its filter-mode labels. `user-filters-element-tokens.test.ts` pins the repaired leaf in the three locales, with the tokens checked against `UserFiltersSchema` itself and a still-translated control so the assertion cannot be satisfied by copying the English sentence back in.
