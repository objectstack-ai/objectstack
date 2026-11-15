---
'@objectstack/objectql': patch
'@objectstack/lint': patch
---

fix(objectql, lint): on a `managedBy: 'synced'` object, the stripped-`apiMethods` warning and the `object/managed-api-method-unaffordable` finding no longer tell the author to open a verb through `userActions`, which the parse refuses there (ADR-0153 D4, #32134)

Clause-②: no
Metadata-protocol: none

- `reconcileManagedApiMethods` (`@objectstack/objectql`): on a write-locked bucket (`MANAGED_BY_WRITE_LOCKED_BUCKETS`, today `synced` alone) the warning's remedy now reads "userActions cannot open a write on this bucket (ADR-0153 D4): remove [VERBS] from enable.apiMethods and send writes through a declared action (ADR-0153 D5)." Every other bucket keeps "Declare userActions to open a verb the object legitimately takes from a user context." The strip itself is unchanged.
- `object/managed-api-method-unaffordable` (`@objectstack/lint`): on `synced` the verdict says `userActions` cannot open a write there instead of "(needs userActions …)", and the fix line offers only the removal and a declared action. `os explain object/managed-api-method-unaffordable` gains a paragraph saying so. Every other bucket's verdict and fix line are unchanged, and the rule id, severity, `path` and what the rule refuses are unchanged.
