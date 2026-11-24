---
'@object-ui/components': patch
'@object-ui/plugin-list': patch
---

fix(components, plugin-list): the sort builder and the phone sort sheet word a number, percent, progress or currency direction as size

Clause-②: no
Metadata-protocol: none

A sort level on a numeric field read "A → Z" / "Z → A" in the sort builder (the list's "All sort levels" panel) and in the phone sort sheet's levels, while a date read "Oldest → Newest". Numeric, percent, progress, currency, rating and boolean levels now read "Low → High" / "High → Low" (zh: 「小 → 大」 / 「大 → 小」), date, datetime and time levels read as time, and text keeps the alphabet, on both surfaces. The words come from the `listConditions.sort.*` rows every locale already carries.
