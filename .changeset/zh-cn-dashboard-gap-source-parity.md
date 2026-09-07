---
"@objectstack/platform-objects": patch
---

fix(platform-objects): the zh-CN `dashboard.gap` help text says what its source now says

`metadataForms.dashboard.fields.gap.helpText` in `zh-CN.metadata-forms.generated.ts`
read 「栅格间距（Tailwind 单位）」. That was a faithful translation of the source it was
extracted against, `Grid gap (Tailwind units)` — but the source has since been rewritten
to `Space between widgets, in steps of 0.25rem (4 = 1rem)`, which deliberately drops the
CSS framework unit an app author never chose and cannot act on, and adds the magnitude
the author can size a dashboard with.

The leaf kept the retired vocabulary and never gained the magnitude, because bundle merge
fills gaps only: a present-but-stale leaf is not a gap, so no amount of re-extraction
corrects it. It now reads 「组件之间的间距，每级 0.25rem（4 = 1rem）」 — `widgets` is
「组件」 as it is everywhere else in this bundle, the grid framing is gone exactly as it is
upstream, and the conversion is carried so a zh author can size `gap` without reading the
English.

One leaf. `columns` is unchanged upstream, so 「栅格列数（默认 12）」 stays accurate, and
the other five leaves of this subtree were corrected separately.
