---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): a record page that places no component explains itself instead of opening a blank panel, and Studio creates a full record page it cannot copy as slotted, so the first save is accepted

Clause-②: no
Metadata-protocol: none

- **`@object-ui/app-shell`, the record view:** the spec refuses a `kind: 'full'` record page that places no component in its `regions` when it is saved, validated or built (`checkPageRecordPlacesComponent`, `@objectstack/spec/ui`). A page stored before that refusal, or one a package registers flat, still reached the record view, which drew it as written: the breadcrumb and an empty panel for every record of its object. The record view now asks the spec's own check and, where it refuses the page, draws a panel in place of the page body. The panel names the page and says how to fix it in Studio: add components to a region, make the page `slotted` to show the default record page, or delete the page so the default record page shows. The default record page is not drawn in the page's place, because a page shows what its author composed. The record drawer shows the same panel. A record that is missing, or that the reader may not open, still shows that state first. Pages that place a component, `slotted` pages, and `html` or `react` pages draw as before.
- **`@object-ui/app-shell`, Studio's New page form:** a record page created with `kind: 'full'` starts as a copy of the object's default record page regions. Four paths had nothing to copy: no object chosen, an object read that came back empty, a synthesized page that placed no component, and a read that failed. On those paths the page saved with empty `regions`, which the spec now refuses with `422`. Each of them now starts the page as `kind: 'slotted'`, which is the object's default record page on the day it is created, so the first save is accepted. The designer's "Convert to full page" still turns it into a `full` page once the object can be read. Whether a copy places a component is judged by the same spec check.
- **`@object-ui/i18n`:** `empty.recordPagePlacesNoComponent` and `empty.recordPagePlacesNoComponentDescription` are added to all eleven locale packs, with zh-Hant regenerated from zh-Hans.
