---
"@objectstack/cli": patch
---

fix(cli): match `i18n-extract`'s per-component walk to `translatePage`'s (#13109)

`pages.PAGE.components.ID.KEY` resolves for a component nested in a
container's declared `properties.children` (the resolver was widened to the
face it already served). `collectExpectedEntries` — behind `os i18n extract`
and `os i18n coverage` — still iterated `regions[].components[]` and stopped,
so the extractor OMITTED keys the resolver reads: a translator extracting a
page whose copy lives in nested components got a skeleton with no entries for
them and had to know the keys to hand-write them.

`PAGE_COMPONENT_COPY_KEYS`' JSDoc names that failure pair, and the shared key
list closes only half of it: the KEY list has one definition both sides
import, while the WALK is written twice. This matches the second half, and
matches it EXACTLY rather than widening — roots `regions[].components[]` only,
descent `properties.children` only, same depth cap, same cycle guard, same
ruled collision arbitration (a region-level id wins outright; among nested
components document order decides). `@objectstack/lint`'s `walkPageComponents`
was the cheaper reuse and is deliberately not used here: it is wider than the
resolver in four ways (`slots.SLOT`, `properties.items[].children`,
`properties.body`, `properties.footer`) and narrower in one (it skips
source-authored pages), so adopting it would have recreated the pair's other
half — offering keys the resolver ignores.

Coverage denominators move with it, deliberately and measured: nested copy
previously counted as neither translated nor missing. In this repo that is
`examples/app-showcase`, whose untranslated-declared-string count went
393 to 403 (six command-center KPI labels, four pricing CTA labels — all real
copy the extractor could not see); the ten are translated in the same change,
so the frozen ratchet baseline is unchanged at 393.
