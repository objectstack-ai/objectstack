---
"@objectstack/spec": minor
"@objectstack/cli": minor
---

i18n label contract: inline locale maps are authorized, and filter-preset tabs get a translation slot

**`I18nLabelSchema` accepts two forms, not one (#5728).** It declared a plain
`z.string()` while three published platform pages authored 31 inline
`{ en, 'zh-CN', 'ja-JP', 'es-ES' }` maps that objectui resolves through
`pickLocalized` — so the authoritative document was the wrong one, and the
#5068 component-props gate reported 42 findings against the platform's own
pages. The schema is now a union of the default-language string and an inline
locale map. `ElementTextPropsSchema.content` was declared a bare `z.string()`
and therefore out of that union's reach; it moves onto `I18nLabelSchema` in the
same change, which is the other 8 of the 42. The gate now reports **0**.

This does not reverse #4667 / #5055. What those retired was the *key-reference*
dialect (`{ key, defaultValue }`) — a shape with **no resolver**, whose label
reached the screen as a raw key or not at all. What is authorized here is the
inline locale map, which has a live resolver and which the CLI's `i18n-extract`
already understands. Same "declared = enforced" principle, applied in both
directions: the map's keys are constrained to BCP-47 tags (plus `default`), so
`{ key, defaultValue }` stays a parse error rather than becoming "a locale map
whose locales are named `key` and `defaultValue`".

Zero breaking: every previously-valid label is still valid. The
translation-bundle channel remains the direction that scales and is unchanged.

**Filter-preset tab labels are translatable (#5377).** `ObjectTranslationData`
gains `_tabs`, addressed by `ViewTabSchema.name`, and `resolveTabLabel` reads
it — explicit `_tabs` translation, then the referenced view's `_views.*.label`
for a tab that carries `view` (the path that already worked, preserved), then
the authored literal. A tab carrying only a `filter` referenced nothing to
inherit from and had no key of its own, so its label rendered in the source
language above a fully localized grid with no authoring workaround. `os i18n
extract` scaffolds the new keys, so the slot, the resolver and the extractor
land together.

`I18nLabelSchema`'s description no longer claims "i18n keys are auto-generated
by the framework" — none are. `AriaPropsSchema.ariaLabel` now states that no
translation-bundle slot addresses it.
