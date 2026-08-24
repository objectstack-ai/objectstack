---
'@objectstack/spec': patch
---

Document why `NoSQLIndexSchema.unique` stays a bare boolean instead of the ADR-0120 unique-scope vocabulary carried by `FieldSchema.unique` and `IndexSchema.unique`: the schema is a raw NoSQL driver-configuration descriptor below the tenancy seam — nothing materializes indexes from it, and the one NoSQL driver that creates indexes (driver-mongodb) consumes the object-level `indexes[]` surface (which already carries the vocabulary) and is explicitly single-tenant (#3724) — so a scope word here would be declarable-but-inert vocabulary (ADR-0078). The `describe()` and docblock now state the deliberate omission and the condition under which `UniqueScopeSchema` should be adopted, so the asymmetry with the other two `unique` surfaces is not mistaken for drift (#11215).
