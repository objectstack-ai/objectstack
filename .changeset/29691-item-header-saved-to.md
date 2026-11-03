---
'@object-ui/app-shell': patch
---

feat(app-shell): the Studio item header says where a customization of a read-only base is saved

Clause-②: yes (widening)
Metadata-protocol: none

ADR-0146 D3 saves every edit of a read-only base into its `.custom` pair. The Studio item header now says so, in the pending-changes sheet's own words: "Saved to BASE's customizations" (zh: 保存到 BASE 的定制). It shows on one line under the title row, above the tabs. It appears on Interfaces for an item the pair adds, overrides or has been unlocked by Customize; on Data for an object the pair adds or a base object the pair's extension already extends; and on Automations for a flow the pair adds, overrides or has been unlocked. Access is unchanged, since its chip already names the base.

`StudioItemHeader` takes an optional `note` prop, drawn outside the title row so the objectstack#29693 fold never measures it. The sentence moves to its own module, `preview/savedToCustomization.tsx`, beside a new `SavedToCustomizationNote` element, so the header does not depend on the pending-changes sheet's module; `DraftChangesPanel` still exports `savedToCustomizationText`. No i18n key is added, and nothing is removed or narrowed.
