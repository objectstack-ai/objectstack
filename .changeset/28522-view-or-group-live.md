---
'@objectstack/spec': patch
---

docs(spec): the view filter any-of group is described as live, not planned

Clause-②: no
Metadata-protocol: none

The console now applies a view filter's any-of group `{ or: [rule, ...] }`: the list query lowers it to one `or` node ANDed with the filter's other elements, and the filter builder edits a filter that is exactly one group. Two author-facing texts still said otherwise and are corrected:

- `ViewFilterOrGroupSchema`'s description (what `/meta/types` and the generated reference show) no longer starts with `[PLANNED — not yet rendered]` and no longer says a view that stores a group is refused when it loads.
- The refusal for a MongoDB-style `$or` on a rule-array `filter` still prescribes the any-of group element, and no longer adds that no console applies it.

Nothing an author can write changes: the schema accepts and refuses exactly what it did.
