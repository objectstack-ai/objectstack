---
"@objectstack/spec": patch
---

fix(spec): the `OS_EAGER_SCHEMAS=1` rollback no longer crashes the `@objectstack/spec/api` and `/data` entries at import

`OS_EAGER_SCHEMAS=1` is the documented emergency rollback of the lazy-schema
memory optimization. With it set, a process whose first spec import was
`@objectstack/spec/api` or `@objectstack/spec/data` threw at import: the bundles
failed with `Cannot read properties of undefined (reading 'optional')`, and the
source with `Cannot access 'FilterConditionSchema' before initialization`. The
default lazy path was not affected.

The cause was an import cycle. `shared/suggestions.zod` held a value import of
`FieldType` from `data/field.zod`, only to feed `suggestFieldType`, and
`shared/strict-object` (which nearly every closed schema imports) imports
`suggestions.zod`. So `data/filter.zod` pulled `field.zod` in before it had
finished loading, and `field.zod`'s eagerly built `FieldSchema` read
`FilterConditionSchema` too early.

`suggestFieldType` now lives in its own module, and `suggestions.zod` imports no
schema module. **Nothing an author or a consumer writes changes:**
`suggestFieldType` is still exported from `@objectstack/spec` and
`@objectstack/spec/shared` with the same signature and the same answers, and no
schema accepts or rejects anything differently. Every published entry now
imports cleanly as the first spec import under the flag, and a test pins that
for each subpath in the `exports` map.
