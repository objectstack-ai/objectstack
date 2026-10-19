---
'@objectstack/rest': minor
---

fix(rest)!: `/history`, `/audit` and `/diff` answer a disabled package's item with the plain read's absence, never past the per-caller gate

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) the narrowing is the served set of three runtime read doors for an item whose owning package is disabled: no stored metadata changes shape, no spec key, export or error code is added or removed, and nothing must be rewritten; re-enabling the package restores the read -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The by-name read now answers a disabled package's item as absent. The event and diff doors judge the item the plain read would judge, and they read "no item" as "nothing behind the name": events served whole, and a view's or dashboard's diff served whole, to a caller the item's own gate refuses.

- **Absent now, `404 RESOURCE_NOT_FOUND`:** `GET /meta/:type/:name/history`, `/audit` and `/diff` for an `app`, `view`, `dashboard`, `doc` or `book` the plain read withholds while its layers still resolve, which is a disabled package's item. No events and no diff are read.
- **Unchanged:** an item that is really gone (every layer null, such as a deleted item) keeps its answer: its events, and its diff as before. Items of enabled packages keep the per-caller gate as before.

What changes for you: re-enable the package to read its items' history, audit trail and diff again.
