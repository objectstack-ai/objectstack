---
'@object-ui/i18n': patch
---

feat(i18n): the locale packs carry the `listConditions` namespace for the list's coming filter and sort controls

Clause-②: no
Metadata-protocol: none

Every pack gains `listConditions.*`: the words of the shared field list (search, the fields the view shows and the hidden ones), the quick filter's values and operators, the sort directions worded by field type (time, size, the alphabet) and the condition row under the view bar (add filter, reset, a locked chip's note). Nothing reads them yet; the list's filter and sort panels start using them in a later release. No existing key changes.
