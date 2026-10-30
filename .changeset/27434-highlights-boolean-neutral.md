---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the record highlights strip draws a boolean as one neutral chip, as the details body does

Clause-②: no
Metadata-protocol: none

The `record:highlights` strip drew `true` as a green "✓ Yes" chip and `false` as a warning-toned "× No" chip, whatever the field meant, so a case's "SLA Violated: No" read as a warning. The metadata does not say which value is the good one, and the details body draws the same field as a plain word, so both values now share one neutral chip: the locale's Yes / No word, with no state colour and no glyph.
