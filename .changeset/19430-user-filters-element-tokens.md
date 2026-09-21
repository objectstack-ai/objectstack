---
'@objectstack/platform-objects': patch
---

Keep the `userFilters` element tokens English in the translated metadata-form tooltips

`metadataForms.view.fields.userFilters.helpText` names the legal values of `UserFiltersSchema.element`, a strict `z.enum(['dropdown', 'tabs', 'toggle'])`, and it is the only place the `view` panel names them at all. All three translated catalogs rendered those tokens as ordinary words — 下拉 / 标签页 / 开关, ドロップダウン / タブ / トグル, desplegable / pestañas / interruptor — so an author working in a translated locale was shown a value the schema refuses.

The enum values are now verbatim English inside the translated sentence and the prose around them stays translated. The `page` Interface panel is a neighbour here, not a precedent: its tooltip keeps `None / Tabs / Dropdown` English too, but those are the `filter-mode` widget's UI mode names — capitalised, and `z.enum` is case-sensitive, so the enum refuses all three; `None` stands for the absence of the config rather than a value; and `toggle` is deliberately not offered there. What this change keeps verbatim is the enum's own tokens, which is the stricter requirement, because they are values an author types.

`user-filters-element-tokens.test.ts` pins the repaired leaf in the three locales. It derives the accepted set from `UserFiltersSchema` and asserts set equality against it, so a value added to the enum reddens instead of going unnamed; it requires each tooltip to name that set and nothing else; and it holds each translated sentence's prose at both ends, so the assertion cannot be satisfied by copying the English sentence back in.
