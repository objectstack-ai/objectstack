---
"@objectstack/driver-mongodb": patch
---

docs(driver-mongodb): stop teaching the spec-refused `reference_to` in the published README, and stop promising a lookup index the driver does not build (#12252 / #13223)

The schema-sync example in this package's README — which ships to npm — declared
its lookup as `company_id: { type: 'lookup', reference_to: 'company' }` and
closed with `// Creates: … idx_company_id_lookup`. Both halves were wrong, in
opposite directions:

- `reference` is the only relationship spelling `@objectstack/spec` declares.
  `reference_to` is a **rejected alias**, answered by `FieldSchema` with
  `unrecognized_keys` and *"Did you mean `reference_to` → `reference`?"* — so
  the sample instructed authors to write a key the platform refuses, in the one
  place a reader is most likely to copy verbatim.
- The `// Creates:` line promised an index that a *correctly* spelled lookup
  does not get. `syncCollectionSchema`'s lookup arm gates on
  `field.reference_to`, so it cannot fire for a spec-conformant lookup. Fixing
  only the spelling would have left the sample promising an outcome the driver
  had just stopped producing.

The sample now uses `reference`, lists only the three indexes an authored object
actually gets, and the surrounding prose no longer claims lookup fields index
themselves — it names the defect and points at #13222, which owns the fix.

**No runtime behaviour changes here.** Whether the lookup arm learns to read
`reference` — which would index 57 relationship fields across the 44 exported
platform objects that get no join index today — is #13222's decision, not this
change's.
