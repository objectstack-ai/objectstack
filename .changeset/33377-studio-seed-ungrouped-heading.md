---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(studio): a full record page Studio seeds for an object with field groups heads its ungrouped fields with the translated "Other" heading, in the saved page and in the preview

Clause-②: no
Metadata-protocol: none

**The ungrouped bucket on a Studio-seeded page.** Since the running record page draws the fields no declared field group claims under their own translated "Other" heading, a page Studio seeded for a grouped object still wrote that bucket as an untitled section, so after saving it the fields read as members of the group above them again. FROM: the seeded and converted page (Create page with kind full, and Convert to full page) wrote `{ columns, fields }` with no heading, and the slotted page preview drew it the same way. TO: the bucket is written `{ label, columns, fields }`, where `label` is the inline locale map of `common.ungroupedSection` from every catalogue `@object-ui/i18n` ships (`en` "Other", `zh-Hans` 「其他」, and so on). `record:details` resolves that map for each viewer's language, so the saved page stays translated; the slotted preview heads the bucket with the translated text the running page draws. The group references (`{ group, columns }`) are unchanged.

**Unchanged:** an object with no field groups (the seed's primary section stays flat, with no heading); the running record page; `@object-ui/plugin-detail`'s `buildDefaultPageSchema`, which still writes the bucket untitled for a caller with no heading to give. No spec change: the inline locale map is a form `record:details` `sections[].label` already accepts. Pages saved before this change are not migrated and keep their untitled bucket; an author can add a heading to that section in the page designer.
