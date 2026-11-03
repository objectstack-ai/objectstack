---
'@object-ui/core': patch
---

refactor(core)!: take the test-only `resetActionKeyWarnings` off the package entry

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/core#resetActionKeyWarnings) the retired operand is a test seam that clears a warn-once memo; nothing in the workspace or in hotcrm imported it from the package entry, and no packages/spec schema, registered node type, conversion surface or stored shape names it, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports `resetActionKeyWarnings` from `@object-ui/core`. It cleared the once-per-key memo behind the unknown-action-key warning and existed for tests; core's own tests reach it through the module that declares it. The other ten names of that module (`ACTION_DEF_KEYS`, `SPEC_ACTION_KEYS`, `NAVIGATION_ALIAS_KEYS`, `HOST_DISPATCH_ACTION_KEYS`, `RETIRED_ACTION_KEYS`, `KNOWN_ACTION_KEYS`, `classifyActionKeys`, `warnOnUnknownActionKeys`, `hasDeprecatedObjectParams`, `warnOnDeprecatedObjectParams`) stay exported unchanged, and the warning itself still fires once per key.

- FROM `resetActionKeyWarnings()` in a test TO a fresh module instance per test (`vi.resetModules()` before importing `@object-ui/core`), or no reset at all when the test asserts the first warning only.
