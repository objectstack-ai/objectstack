---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a record highlight chip with no translation is captioned by the field's declared label instead of nothing

Clause-②: no
Metadata-protocol: none

The highlight strip under a record's title drew an empty caption over every chip whose field had no entry in an i18n bundle and no label on the strip entry. That is every chip on a synthesized record page of an object without a bundle, which includes every AI-built app: the strip showed two bare values side by side with nothing saying which field each one was.

The chip caption now climbs the same ladder the record's details body uses: the bundle's translation, then the strip entry's own label, then the label the object declares for the field (an inline locale map is read in the session language), then the field name. A translated label and an authored strip label still win as before. The caption also updates when the object definition arrives after the record.

What to do: nothing.
