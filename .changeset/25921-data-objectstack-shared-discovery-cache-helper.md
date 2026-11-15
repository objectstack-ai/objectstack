---
'@object-ui/data-objectstack': patch
---

refactor(data-objectstack)!: retire the test-only `clearSharedDiscoveryCache` from the package entry

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/data-objectstack#clearSharedDiscoveryCache) the retired operand is a test-only function that empties the adapter's in-memory per-origin discovery cache; nothing in the workspace or in hotcrm calls it outside tests, and no packages/spec schema, registered node type, conversion surface or stored shape names it, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports `clearSharedDiscoveryCache` from `@object-ui/data-objectstack`. It reset module state between tests, and no code outside a test called it, in the workspace or in hotcrm, so the Console and every `@object-ui/*` package are unaffected. Nothing fetches or renders differently.

The per-origin discovery cache moves verbatim into the package's own module `sharedDiscovery.ts`. `ObjectStackAdapter.connect()` still reads through it, and `getSharedDiscovery` stays exported from the entry unchanged. Only the reset helper stops being published, the same way the package roots already keep `resetRuntimeConfigForTesting`, `resetInflightGetsForTesting` and `__clearRecordEditableCache` off their barrels. The workspace's own tests import it from the module.

What leaves, and what to write instead:

- FROM `clearSharedDiscoveryCache` TO no replacement. The helper was test-only; a host test that needs a fresh discovery read gives each case its own `baseUrl`, or stubs the fetch its adapter makes.
