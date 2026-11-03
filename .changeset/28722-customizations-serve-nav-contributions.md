---
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

feat(runtime): the customizations read serves the `nav` contributions: the navigation items other packages add to a base's apps

Clause-②: no
Metadata-protocol: none

`GET /packages/:id/customizations` now lists, in `contributions`, the navigation items other installed packages add to the base's apps, each naming the package that adds them. Studio can draw those menu entries greyed with their source, as it already can for contributed fields and flows (ADR-0029 D7 as amended by ADR-0146 D3).

- **One entry per item.** Every item of a package's `navigationContributions` entry that declares an `id`, contributed to an app the base ships, is a `nav` entry: `{ kind: 'nav', app, group?, name, packageId }`. `group` is the group the contribution targets, when it targets one. A separator without an `id` is not an entry, and a contributed group's children ride inside it.
- **The same answer the menu shows.** The entries come from the registry the served app's navigation fold reads, never a join on names. A disabled package's items are not listed, as the fold drops them, and they come back when it is enabled again. The base's own items and its `<base>.custom` pair's are not contributions, and no nav item gains a key.
- **Order and counts.** The `field` and `flow` entries come first as before, then the `nav` entries by app, group (no group first), name and package. `counts.contributions` counts them all.

The spec's `nav` arm drops its `[PLANNED — not yet served]` marker, and the member's descriptions no longer say the kind is unserved. The schema accepts exactly what it accepted before.

Nothing to do for existing metadata. A client that read `contributions` and assumed only `field` and `flow` entries now also receives `nav` entries, which the declared schema already allowed.
