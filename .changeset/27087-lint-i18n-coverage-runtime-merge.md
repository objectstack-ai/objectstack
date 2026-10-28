---
'@objectstack/cli': patch
---

fix(cli): `os lint` and `os i18n check` merge a locale's translation bundles the way the runtime serves them

Clause-②: no
Metadata-protocol: none

A multi-package artifact carries one translation bundle per package, each naming the same locales. The runtime deep-merges them per locale, so `GET /api/v1/i18n/translations/LOCALE` serves every package's keys. i18n coverage folded them with a merge of its own that kept only `objects`, `globalActions`, `messages`, `metadataForms` and a later bundle's whole `apps.APP` entry. Every dashboard, dataset, page, flow, report and picklist a later package translated read as missing, and a later package that contributed navigation into an app dropped the app's own navigation labels. HotCRM measured 330 such warnings under `os lint --strict`.

Coverage now calls the runtime's own deep merge (`deepMerge` from `@objectstack/core`), so the lint reads exactly the served tree. Navigation labels merge per node id, because `apps.APP.navigation` is a map keyed by id. A single-bundle stack reads as before, and a key no bundle carries is still reported once.
