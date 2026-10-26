---
"@object-ui/app-shell": minor
"@object-ui/types": minor
"@object-ui/plugin-detail": minor
---

Clause-②: no
Metadata-protocol: none

**Breaking:** test-only reset helpers are no longer on the package roots (objectui#13453): `resetRuntimeConfigForTesting` (`@object-ui/app-shell`), `resetInflightGetsForTesting` (`@object-ui/types`) and `__clearRecordEditableCache` (`@object-ui/plugin-detail`). They reset module state between tests and had no other reader. Declared `minor` per the version-alignment policy (a changeset never declares `major`).
