---
'@object-ui/core': patch
---

refactor(core): dashboard date presets read their bounds from the spec's window table

Clause-②: no
Metadata-protocol: none

`dashboard-filters` no longer keeps its own preset-to-bounds table. Each of the thirteen dashboard date presets now lowers to the window `@objectstack/spec` declares in `DATE_RANGE_PRESET_MACRO_WINDOWS`, so the preset list and its windows live in one place and cannot drift.

The emitted condition spells the current period with the bare macro aliases the spec uses (`{month_start}` instead of `{current_month_start}`, and the same for week, quarter and year). Both spellings name the same day, so a dashboard returns the same rows, and a compare-to widget keeps the same comparison window and trend label. A stored dashboard that writes the `{current_*}` tokens itself, as a custom range or as a date default, still filters as before.

Preset membership is now the spec's exact `isDateRangePresetName` check. A stored preset name that matched only an inherited object member (such as `constructor`) was dropped without a word; it is now dropped with the usual unknown-preset warning.
