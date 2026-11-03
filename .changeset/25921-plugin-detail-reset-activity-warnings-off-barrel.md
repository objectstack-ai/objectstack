---
'@object-ui/plugin-detail': patch
---

refactor(plugin-detail)!: take the test-only `resetUnknownActivityTypeWarnings` off the package entry

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/plugin-detail#resetUnknownActivityTypeWarnings) the retired operand is a test seam that clears the warn-once bucket of the unmapped activity-type diagnostic; no shipped code in the workspace or in hotcrm called it, and no packages/spec schema, registered node type, conversion surface or stored shape names it, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports `resetUnknownActivityTypeWarnings` from `@object-ui/plugin-detail`. It existed for tests; the one workspace test outside the package now imports it from the module that declares it. `ACTIVITY_TYPE_TO_FEED_TYPE`, `UNMAPPED_ACTIVITY_FEED_TYPE`, `activityRowToFeedItem` and `isRefusedFeedRead` stay exported unchanged, and the diagnostic still warns once per unmapped type.

- FROM `resetUnknownActivityTypeWarnings()` in a test TO a fresh module instance per test (`vi.resetModules()` before importing `@object-ui/plugin-detail`), or an activity type unique to that test.
