---
'@objectstack/lint': patch
---

Clause-②: no
Metadata-protocol: none

The dashboard and report advisories now carry a user-facing sentence in all 11 platform locales, for the save door's `userMessage` (the pattern the security-posture advisories already follow). Nine advisory rule ids gain one: the widget-binding rule's `widget-legacy-analytics-shape`, `dashboard-filter-field-unprovisioned`, `chart-field-unknown`, `chart-measures-missing`, `widget-measures-missing`, `chart-dimensions-missing` and `table-count-only`, and the chart-binding rule's `chart-measure-unknown` and `chart-axis-not-selected` on a report chart's `series[]` entry. Their findings carry the names the sentence interpolates as `userTextParams`, and `findingUserMessage` renders the sentence in the request's locale, else the workspace default, else English.

Rule ids, `message` and `hint` are unchanged, so `os validate`, `os lint` and every save response read exactly as before. `measure-aggregate-incoherent` and `page/visualization-without-binding` have no sentence: the publish door never returns them (the first is judged on a dataset that a dashboard write carries as context, the second on pages no per-write snapshot carries), so they stay on the English `message`.
