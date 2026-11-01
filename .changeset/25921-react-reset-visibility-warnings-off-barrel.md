---
'@object-ui/react': patch
---

refactor(react)!: take the test-only `__resetVisibilityPredicateWarnings` off the package entry

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/react#__resetVisibilityPredicateWarnings) the retired operand is a test seam that clears the once-per-predicate dedupe of the unresolvable-visibility report; no shipped code in the workspace or in hotcrm called it, and no packages/spec schema, registered node type, conversion surface or stored shape names it, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** for a host that imports `__resetVisibilityPredicateWarnings` from `@object-ui/react`. The double-underscore name already marked it as a test seam; the workspace tests that used it now import it from the module that declares it. `reportUnresolvableVisibilityPredicate`, `formatUnresolvableVisibilityMessage`, `UNRESOLVABLE_VISIBILITY_PREFIX`, `UNRESOLVABLE_ENABLEMENT_PREFIX` and the `PredicateScopeTier` type stay exported unchanged, and the report still dedupes per predicate.

- FROM `__resetVisibilityPredicateWarnings()` in a test TO a fresh module instance per test (`vi.resetModules()` before importing `@object-ui/react`), or a predicate source string unique to that test so the dedupe cannot hide its line.
