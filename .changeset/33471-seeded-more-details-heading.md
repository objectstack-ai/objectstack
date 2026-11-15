---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(studio): a full record page Studio seeds for an object with no field groups heads its "More details" section with the translated heading, not the English text

Clause-②: no
Metadata-protocol: none

**The "More details" section on a Studio-seeded page.** The running record page draws an object's long-text fields under a collapsible "More details" section whose heading it translates (`detail.sectionMoreDetails`). A page Studio seeded for the same object wrote that heading as the plain English string, so every viewer of the saved page read "More details" unless the object's own bundle carried `_sections.details.label`. FROM: the seeded and converted page (Create page with kind full, and Convert to full page) wrote `{ name: 'details', label: 'More details', … }`. TO: `label` is the inline locale map of `detail.sectionMoreDetails` from every catalogue `@object-ui/i18n` ships (`en` "More details", `zh-Hans` 「更多详情」, and so on). `record:details` resolves that map for each viewer's language, and the section keeps its `name: 'details'`, so the object's own `objects.OBJECT._sections.details.label` still wins over the map, as it does on the running page.

**Unchanged:** the running record page and the slotted page preview (both draw the translated text already); objects with field groups; `@object-ui/plugin-detail`. No spec change: the inline locale map is a form `record:details` `sections[].label` already accepts. Pages saved before this change are not migrated: they keep the English string, which the object's `_sections.details.label` still overrides, and an author can change the heading in the page designer.
