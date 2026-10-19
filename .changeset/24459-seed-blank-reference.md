---
"@objectstack/metadata-protocol": patch
---

fix(metadata-protocol): a seed reference written blank (`''` or whitespace-only) is no reference, by the engine's own `isMissing`

Clause-②: no (no published accept set or surface moves: the row was already written, and only the false "unresolved" report and its `success: false` go away; owes the seat's `TIER_DEFAULT` review of record before the queue)

- **What changed.** The seed loader skipped a reference only when its value was `undefined` or `null`, so a lookup written `''` was resolved as a natural key, missed, deferred, and reported after pass 2 as `Deferred reference unresolved … = '' → … not found`: `errored` counted it and the load answered `success: false` for a row that had landed. A replay reported the same error again. Every site that decides whether a reference has a value now asks `isMissing` from `@objectstack/core`, the rule the engine's insert door and required check already use: a single reference, each element of a `multiple: true` reference in pass 1 and in pass 2, and the id half of a `referenceVia` pointer pair (which already skipped `''` and now also skips whitespace-only).
- **A blank single reference** is not resolved and not reported. Its value is left as written, so the engine decides it: an optional lookup's row lands with the field empty and a replay skips it clean; a required lookup is refused by the engine's own required check (`book is required`), and no longer also reported as an unresolved reference.
- **A blank element of a `multiple: true` reference** is dropped like a `null` hole, and the other elements resolve. Before, the blank element made the whole field defer and fail, so the row landed with none of its associations.
- **What stays the same.** A real natural key resolves as before, and one that names no row is still reported. No export, error code, configuration key or result shape changed. Nothing to do for a consumer.
