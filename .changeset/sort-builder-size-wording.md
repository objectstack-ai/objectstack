---
'@object-ui/components': patch
'@object-ui/plugin-list': patch
'@object-ui/i18n': patch
---

fix(components, plugin-list): the sort builder and the phone sort sheet word a number, percent, progress or currency direction as size

Clause-②: no
Metadata-protocol: none

A sort level on a numeric field read "A → Z" / "Z → A" in the sort builder (the list's "All sort levels" panel) and in the phone sort sheet's levels, while a date read "Oldest → Newest". Numeric, percent, progress, currency, rating and boolean levels now read "Low → High" / "High → Low" (zh: 「小 → 大」 / 「大 → 小」), date, datetime and time levels read as time, and text keeps the alphabet, on both surfaces. The words come from the `listConditions.sort.*` rows every locale already carries.

What else a reader sees change:

- The four `sortBuilder.ascending`, `sortBuilder.descending`, `sortBuilder.oldestFirst` and `sortBuilder.newestFirst` rows are no longer read by either surface; the rows stay in the packs. A host that overrode them to reword a sort direction now overrides `listConditions.sort.alphabet_asc` / `alphabet_desc` / `time_asc` / `time_desc` (and `size_asc` / `size_desc` for numbers) instead.
- Because the words now come from `listConditions.sort.*`, the date and text wording changes in some locales: Japanese and Korean dates read 「古い → 新しい」 / 「오래된 순 → 최신 순」 instead of 「古い順」 / 「오래된 순」, Russian dates read "Старые → Новые" instead of "Сначала старые", and Russian text reads "А → Я" instead of "A → Z".
- Arabic: the `listConditions.sort.alphabet_asc` / `alphabet_desc` pair now reads "A → Z" / "Z → A". A run of two Latin letters stays left to right on a right-to-left page, so the old "A ← Z" showed ascending as Z to A.
