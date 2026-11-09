---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(app-shell): the Setup packages page shows a disable refused for a dependent validation rule whole, and its confirm dialog says such a refusal can happen

Clause-②: yes (widening)
Metadata-protocol: none

When `PATCH /api/v1/packages/:id/disable` answers `409 PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE` (an active validation rule of an enabled package reads a field the package adds through `objectExtensions`), the package sheet now draws a heading in the reader's language over the server's whole sentence: every blocking rule as package · object · rule, then the remedy. Before, the message was cut to its first sentence and the remedy sat behind "More". Every other refusal is drawn as before. The Disable confirm dialog gains one line saying that such a rule can still refuse the disable, because the served `disableable` verdict says what the package allows and does not read rules elsewhere. Two new keys in the `@object-ui/i18n` `studio` namespace (`en` and `zh`): `engine.packages.detail.disableRestricted` and `engine.packages.detail.disableMayBeRefused`.
