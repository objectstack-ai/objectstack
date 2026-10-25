---
"@object-ui/app-shell": patch
"@object-ui/i18n": patch
---

Clause-②: yes
Metadata-protocol: none

The metadata designer's translation preview draws the `positions` and `permissions` groups that `@objectstack/spec` now declares on a translation bundle, each with its own card, count and sample, and counts them in the coverage bar. Before, the preview did not type-check against that spec, and a bundle that translated only position or permission-set labels read as empty.

`isSpecTranslationData` recognises a served translation document by those two groups as well, so a bundle that translates only positions or permission sets is namespaced under `app` like any other spec bundle instead of being returned untransformed.
