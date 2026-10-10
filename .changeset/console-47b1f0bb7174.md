---
"@objectstack/console": patch
---

Console (objectui) refreshed to `47b1f0bb7174`. Frontend changes in this range:

Derived from the changesets objectui declared over the range — 13 releasing of 14 changesets added across 14 non-merge commits; omitted: 1 release-nothing changeset (they ship no package code).

- **patch** — The console's sign-in page no longer reads `/api/v1/i18n`, and the application's translations and locale list load with the session's credentials once signed in (objectui#12034). (objectui `47b1f0bb7`)
- **patch** — The record approvals panel draws its decision-progress tally through one module-internal indicator, `DecisionProgressIndicator` (objectui#12033, part of objectui#2763). The tally… (objectui `ba9e82026`)
- **patch** — The Studio header's *More* trigger keeps its own name (objectui#11794). While *Access*, the pillar it holds, was open, the trigger renamed itself to "Access", which hid the word t… (objectui `8de8ba280`)
- **patch** — The embedded item editor ("Save into object", opened from a metadata item's Related drawer) now saves into the parent's draft (objectui#12027). (objectui `ea79b7777`)
- **patch** — A compact record-preview card for any `(object_name, record_id)` pair, kept inside the package for the approval surfaces to compose (objectui#12029, the first child of objectui#27… (objectui `049012bf0`)
- **patch** — Studio navigation details (objectui#11794): (objectui `8f815f4fe`)
- **patch** — Three more controls pick with the shared `Select`, the control the rest of the console picks with (objectui#11865, the list view and the chatbot): `ListView`'s "Color by field" an… (objectui `8f8f760fa`)
- **patch** — Studio saves one way on a package: the permission matrix and hooks autosave to the package draft like the other pillars, every create dialog says *Save as draft*, and the Changes… (objectui `6694abe75`)
- **patch** — Five of the Studio design surface's pickers use the shared `Select`, the control the rest of Studio picks with (objectui#11865, the design surface's part of that card): in the nav… (objectui `5382a865f`)
- **patch** — Four plugin controls pick with the shared `Select`, the control the rest of the console picks with (objectui#11865, the plugins' single selects): `SharedViewLink`'s "Expires after… (objectui `2063f7a96`)
- **patch** — A quick-filter value restored from the URL now gets its field's type once the object definition loads, when the field is declared without its type (objectui#12008). (objectui `16b9d440d`)
- **patch** — Four metadata-admin pickers use the shared `Select`, the control the rest of the console picks with (objectui#11865, the metadata-admin previews and inspectors' part of that card)… (objectui `f2bff5ce8`)
- **patch** — The Create View dialog, the AI build panel's Excel import bar and the API console's method selector pick with the shared `Select`, the control the rest of the console picks with (… (objectui `869d0bfdf`)

objectui range: `f0268ad78485...47b1f0bb7174`
