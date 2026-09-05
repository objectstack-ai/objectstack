---
"@objectstack/lint": patch
---

No authoring rule throws on a non-record entry of any stack collection.

A collection is authored either as a list or as a name-keyed map, so every rule that reads one coerces `unknown` into an array of records first. That coercion had been hand-copied into 39 modules, and 23 of the copies spelled the array branch as an unchecked cast — every member was asserted to be a record. A YAML list item left empty deserialises to `null`, so a single stray `-` under `flows:`, `pages:`, `dashboards:`, `datasets:`, `apps:`, `permissions:`, `capabilities:`, `data:`, `hooks:`, `views:`, `actions:`, `translations:` (or a per-object `fields:` / `actions:` / `views:`) reached a property read on `null` and threw a stack trace out of `os lint` / `os validate` instead of reporting a finding. The rules are pure `(stack) => Finding[]` running on the raw path, so nothing upstream had judged the entry's shape.

Twenty-two of those readers now read through the shared, guarded `recordsOf`, which drops a non-record member of the array shape whole and keeps the author's key on the map shape. Nothing else about what the rules judge changes: a valid entry standing beside a junk one is still read, and still draws exactly the findings it drew before.

The remaining copies are pinned by a new source-text test in the package, so the predicate cannot be pasted back in: it asserts that `recordsOf` is the only collection coercion, that every module still holding a private one is named in a dated ledger that is exact in both directions, and that no coercion outside a dated single-file allowance casts its array branch unchecked.
