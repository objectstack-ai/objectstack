---
'@object-ui/i18n': patch
---

fix(studio): Interfaces lists a package's pages, dashboards, reports and views whether or not a navigation entry names them

Clause-②: no
Metadata-protocol: none

- Studio › Interfaces used to list only what the app's navigation names, so a list view off the menu, a record page, or any item of a package with no app could not be opened in Studio at all. Under the navigation tree the rail now has one section per type ("Not in navigation": Pages, Dashboards, Reports, Views) listing the package's items no entry opens, published and draft, and each row opens its item in the same canvas and inspector, read-only on an installed package. A package with no app keeps its "no app yet" notice and lists what it ships under it. An item a navigation entry opens keeps its row in the tree and is not listed again.
- The `studio` namespace gains the six `engine.studio.if.offNav.*` strings, in `en` and `zh`. No export changes.
