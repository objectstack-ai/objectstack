---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
'@objectstack/lint': patch
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
'@object-ui/app-shell': patch
'@object-ui/types': patch
---

fix: descriptions and help text no longer say the default record page draws a key-field strip or a stage path

Clause-②: no
Metadata-protocol: none

The default record page draws no key-field strip and no stage path: the stage is the status tag beside the record name. These texts said otherwise and now say what each key drives:

- `@objectstack/spec`: the `highlightFields` describe ("Drives default list and related-list columns, cards, hover cards, previews and the record picker; the default record page draws no strip from it") and its Studio help text. The `stageField` and `RECORD_HIGHLIGHTS_MAX` doc comments say the header's status tag reads the stage and the count cuts only a strip a page places in its `highlights` slot. The upgrade-guide entry `field-group-shadowed-six-highlights` no longer tells authors to move highlights: the warning now judges the record title alone, and no action is owed.
- `@objectstack/platform-objects`: the `highlightFields` help text in every metadata-form locale.
- `@objectstack/lint`: the `os explain` text of `object-field-ref-unknown` and `semantic-role-field-unprovisioned` names the hover card and the record picker in place of the strip.
- `@object-ui/plugin-detail`: the `record:details` `hideFields` description no longer says the default page fills it. The key is still accepted.
- `@object-ui/i18n`: Studio's lifecycle-field help (`stageField`, and its "None" choice) talks about the status tag, not a progress bar.
- `@object-ui/types`: the page `highlights` slot doc says it places a strip the synthesized default does not draw.
- `@object-ui/app-shell`: on a phone the default record page no longer hands the synthesizer a highlight list it never read. The page looks the same, and the subtitle under the record name is unchanged.
