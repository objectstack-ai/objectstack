---
"@objectstack/metadata": minor
---

fix(metadata): two files sharing one stem are refused with both paths named, instead of one being listed twice and served by extension precedence (#14921)

**BREAKING** accept-set narrowing on `FilesystemLoader`, shipped as `minor`
under the repo's launch-window convention for breaking changes. Ruled on
#14921 (2026-09-05, option 1 of three).

**Remedy: delete or rename the duplicate file.** The refusal names every
colliding path and the metadata type, so the fix is visible at the point of
failure.

`FilesystemLoader` derives a metadata name by stripping a flat file's
extension, and resolves a name back to a file under a FIXED extension
precedence (`.json` → `.yaml` → `.yml` → `.ts` → `.js`). Two files sharing a
stem therefore produced one name **twice** in `list()` while only the
first-precedence file was reachable through any name at all. With
`object/twin.json` and `object/twin.yaml` both present, `list()` answered
`['twin', 'twin']`, `twin.yaml` was addressable through nothing, and
`loadMany()` returned both bodies. `MetadataManager.listNames()` unions loader
output into a `Set`, which collapsed the duplicate and took the count
discrepancy with it — the file stayed unreachable either way, so a clean
`listNames()` was never evidence the collision had been absorbed.

The invariant that broke: **what is listed is what is loadable.** The listed
set and the addressable set stopped being the same set. The failure was silent
in the direction that matters for authoring — convert `twin.json` to
`twin.yaml` and leave the old file behind, or land one from each of two
packages, and the JSON one is served forever with no diagnostic anywhere,
while `admitLoaderItems()`'s documented "keep the first and say nothing"
absorbs the collision a second time.

`FilesystemLoader.list()` now throws `AmbiguousMetadataStemError`
(`AMBIGUOUS_METADATA_STEM`, HTTP 500) naming both paths and the type, and the
same refusal fronts the shared `loadMany()` / `loadManyKeyed()` walk, so the
two-body answer is gone rather than de-duplicated. `MetadataManager.listNames()`
and `list()` **propagate** it rather than absorbing it into their per-loader
degradation: an ambiguous stem is an authoring error no retry fixes, and
degrading it would drop every item the loader holds into a short-but-served
list while the server keeps reporting healthy. A real storage outage still
degrades exactly as before — the seams discriminate on a branded predicate,
`isAmbiguousMetadataStemError`, not on a blanket rethrow.

**Refused shape**, precisely: two or more files **directly under
`ROOT/TYPE/`** whose basenames differ only by an extension belonging to one of
**this instance's registered serializers**. Register `javascript` and
`dual.json` + `dual.js` becomes ambiguous; under the manager's default format
set (`typescript` / `json` / `yaml`) it is not, because `.js` derives no name.
Nested files are untouched — they are neither listed nor resolvable (#14486),
so `crm/solo.json` beside a flat `solo.json` is not a collision. The refusal is
scoped to the type directory that holds it: a clean `view/` still lists while
`object/` refuses.

New exports from the package root entry: `AmbiguousMetadataStemError`,
`isAmbiguousMetadataStemError`, `AMBIGUOUS_METADATA_STEM_CODE`,
`AMBIGUOUS_METADATA_STEM_STATUS`.

Measured migration cost, which is what makes this narrowing cheap: **no tree in
this repository carries the shape.** A walk of all 7,770 tracked files across
526 directories found zero stem collisions among `.json` / `.yaml` / `.yml` /
`.ts` / `.js`, confirmed independently by a `git ls-files` pass, and the repo
holds no `.yaml`/`.yml` metadata file at all outside CI and workspace config.
No existing tree goes red.

<!-- adr-0087: not-required (no-migration-prescription) An accept-set narrowing on a LOADER, not on any authorable key: no property of any spec schema is removed, renamed or re-shaped, so there is no tombstone and nothing for `objectstack migrate meta` to rewrite in a stored document. The affected artifact is a FILESYSTEM LAYOUT — two sibling files — which the ledger cannot address at all: a migration entry rewrites metadata bodies, and neither of the colliding files is wrong on its own. Which one an author wants kept is intent no entry can decide: they may have meant the conversion to `.yaml` to land and forgotten to delete the `.json`, or may have meant the opposite, and the two files carry no evidence of which. The refusal is the channel that reaches them, at the load site, naming both paths, the type, and the remedy. Measured in-repo population of affected trees is zero: a walk of 7,770 tracked files over 526 directories found no directory holding two files with one stem among the registered extensions, and there are no `.yaml`/`.yml` metadata files outside CI and workspace config. -->
