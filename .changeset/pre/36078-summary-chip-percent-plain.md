---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the record header's summary chip honours `percentDisplay: 'plain'`

Clause-②: no
Metadata-protocol: none

The `summaryFields` chip beside the record title drew its progress bar for every `percent` field and every `formula` whose `returnType` is `percent`, even when the field declares `percentDisplay: 'plain'` — the face `@objectstack/spec` describes as "the percentage as text alone, with no bar", which the list cell already honoured. The chip now reads `percentDisplay` off the same merged field it reads `scale` and `max` from (the view's entry over the object schema): `plain` shows the percentage text alone, while an absent `percentDisplay` or `bar` keeps the bar. The text, its accessible name and the stored value are unchanged.
