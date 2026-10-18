---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: the by-name `/meta` read answers a disabled package's item of every type but `object` and `package` as absent, as the list already omits it

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) the narrowing is the served set of a runtime read door, getMetaItem for an item whose owning package is disabled: no stored metadata changes shape, no spec key, export or error code is added or removed, and nothing must be rewritten; re-enabling the package restores the read -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

Disabling a package already took its apps, views, pages, dashboards, flows and every other item out of `GET /meta/:type`. The by-name read `GET /meta/:type/:name` still served them. It now answers such an item the way it answers a name with nothing behind it.

- **Absent now:** `getMetaItem({ type, name })` for an item whose `_packageId` names a disabled package, for every type except `object` and `package`. The active read and `previewDrafts` serve no `item`, which both transports answer `404 RESOURCE_NOT_FOUND`, byte for byte the answer for a missing name. The strict draft read (`state: 'draft'`) throws the missing draft's `404 NO_DRAFT`. The list read and the by-name read ask one predicate, so they hide the same items.
- **Kept:** the protection envelope (`lock`, `editable`, `deletable`, `version` and the rest) still reports the write doors' verdicts about the address, because a disable does not change how the lock gate judges a save there. Only `item` and a flow's `registration` are withheld.
- **Unchanged:** objects, which keep their `404 OBJECT_PACKAGE_DISABLED`; packages, which are never hidden, so a disabled package can still be read and re-enabled; items of enabled packages; and `getMetaItemLayered` (`?layers=true`, `/layers`) and `/published`, which still serve a disabled package's non-object item.

What changes for you: a client that read a disabled package's app, view, page or other item by name now gets `404 RESOURCE_NOT_FOUND`, as for a missing name. Re-enable the package to read it again.
