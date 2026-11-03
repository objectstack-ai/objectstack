---
'@objectstack/skills': patch
---

docs(skills): the objectstack-data field-types rule states a percent field's storage scale

Clause-②: no
Metadata-protocol: none

The `percent` row of the field-type table no longer says "Percentage values (0-100)". It states the storage rule the platform applies: a `percent` field stores a fraction (0-1) unless it declares `max` above 1 (for example `max: 100`), in which case it stores whole percentage points; seeds, defaults and API values use that stored scale. An author who followed the old text seeded `25` on a field without `max` and read back `2500%`. Paid inside the file's token ceiling by deleting the `Vector (AI Embeddings)` example, whose one fact (`dimensions` is the flat key) the Enhanced Types row already states.
