---
'@objectstack/platform-objects': patch
---

fix(platform-objects): every locale's Studio help for related-list field groups and inline columns states the field-group rule

Clause-②: no
Metadata-protocol: none

A master-detail child table appears on the parent's create and edit forms, and at a place on its record page, when a field group of the parent names it (`fieldGroups[].relatedList`); `inlineEdit` alone no longer does that. The English and Simplified Chinese Studio help already said so. The Arabic, German, Spanish, French, Japanese, Korean, Portuguese (Brazil), Russian and Traditional Chinese help for two keys still gave the old rule. The inline columns help said the columns are used only when the field sets `inlineEdit`, and the field group help said the record page does not draw the placement yet. Both now match the English text.
