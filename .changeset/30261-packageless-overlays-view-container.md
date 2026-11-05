---
'@objectstack/metadata-protocol': patch
'@objectstack/cli': patch
---

fix(metadata-protocol,cli): `os migrate packageless-overlays` lists a package-less view container `cannot_declare` instead of `movable`, and `--apply` no longer attempts (and fails) it on every run

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/metadata-protocol`: the census gains the disposition `cannot_declare`** (`PackagelessOverlayDisposition`, reachable through the exported `PackagelessOverlayCensus`). A row lands there when the schema the save door judges its body by refuses an `overrides` key on it, so the declared save the move makes could never land. Of the five overlay types the ceremony moves, that is a view container (`list` / `listViews` / `form` / `formViews`): only a single view declares an override. Before, such a row was listed `movable` and every `--apply` reported it `failed` with `Unrecognized key(s) on this view container: overrides`, leaving the row where it was. Now `migratePackagelessOverlays` does not attempt it: no outcome, no failure, no pair ensured for it.
- **The two closes read the same answer.** The package-less write close (`packagelessCloseSubject`) closes only what the ceremony moves, so a container's package-less save and delete stay open, as they were before the close: they are the one door such a row keeps. The close of a write naming the read-only base (`overlayPairFixAdmits`, the "the fix can be taken" predicate both closes ask) no longer names the pair as the fix for a container body, because that fix (a declared save into the pair) cannot be taken; that write keeps the answer it had before the close.
- **`@objectstack/cli`: `os migrate packageless-overlays`** prints the way out for a `cannot_declare` row under "left as they are": save each of the container's views into the pair as a single view named `<object>.<view>` (one the base ships declaring `overrides: { package, basedOn }`, a new one declaring nothing), then delete the container row with a delete naming no package (naming the base, for a row bound to it). In `--json`, the row carries `disposition: "cannot_declare"` and `outcome: "left"`, and `--apply` exits 0 for it.
