---
'@objectstack/service-settings': patch
---

fix(service-settings): a select, radio or multiselect setting refuses every value when its option source answers an empty list

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no key of any schema is added, removed or re-shaped and no stored row is read differently: the narrowing is one runtime refusal at the settings save door and the OS_* env door, for a select-family key whose registered option source answers an empty list, and its remedy is a value the source offers once it offers one, so there is nothing for `objectstack migrate meta` to rewrite. A value already stored is not re-judged. -->

A select, radio or multiselect key whose options come from a registered option source (`registerOptionSource`) was judged against that list only when the list had entries. When the source answered an empty list, any value was saved and any `OS_*` override was put in force. Now no value is admitted then: the save door refuses it with `invalid_option` ("… offers no value to choose from right now."), and the env door logs the override as not in force, as #31422 made the `map` family judge its keys. This narrows what is accepted. During the boot, while the option verdicts are held (`holdOptionSourceVerdicts`, sealed at `kernel:bootstrapped`), an override is still taken in force and judged at the seal, so a list the boot is still filling refuses nothing early. A key with no source, or whose source cannot answer, is judged against its declared options as before. Also, the env door's "said once" record now keys a structured value by a stable serialisation, so a second, different bad map under one `OS_*` variable is reported too (before, every map counted as the same value).
