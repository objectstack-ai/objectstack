---
'@objectstack/spec': patch
---

A field-option docblock names both sibling issues by repository

The docblock on `SelectOptionSchema`'s `visibleWhen` in `src/data/field.zod.ts` cited a pair
of objectui issues as `objectui#6110 + #6111`, which reads the second number as
this repository's. It now qualifies each number on its own, so both point at the
objectui records the sentence describes. Comment only: no type, schema, export
or runtime behaviour changes.
