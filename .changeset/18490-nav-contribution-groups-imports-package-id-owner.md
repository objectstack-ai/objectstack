---
"@objectstack/cli": patch
---

`os build` / `os validate` name an artifact package the same way the runtime fold does when its `manifest.id` and `manifest.name` are both empty — `nav-contribution-groups.ts` no longer carries its own copy of the artifact package-id rule and imports the declared owner instead (#18490).

Clause-②: no

`packages/cli/src/utils/artifact-packages.ts` declares itself the sole owner of "which package is this", and says why in its own header: *"⛔ A second copy is the one that must not happen. … Two readers computing 'which package is this' slightly differently is how one entry comes to judge a different set of packages than the other while both look right."* `nav-contribution-groups.ts` exported a second implementation, `artifactPackagesOf`, which differed from the owner in one guard — a non-empty check on `manifest.name` — and the two had already drifted on a real input.

- **The divergent input is reachable, measured rather than assumed.** `ManifestSchema` requires `id` and `name` as strings and constrains neither to be non-empty, so `{ manifest: { id: '', name: '', … } }` parses green through the same `normalizeStackInput` + `ObjectStackDefinitionSchema` chain both commands run. For that package the owner answered `''` and the deleted copy answered `` `packages[<index>]` ``.
- **Importing the owner chose `''`, and `''` is the answer this path needs.** `ObjectQL.registerApp` derives the id it registers a navigation contribution under as `manifest.id || manifest.name`, with no positional fallback, so the read-time fold names that package `''` and prints `Package "" contributes …`. The build used to print `Package "packages[0]" …` for the same artifact — two doors naming one package differently, which is the divergence the shared `checkNavContributionGroups` predicate exists to prevent, one field over.
- **What an author sees change**: for an artifact package with an empty `id` *and* an empty `name`, the `packageId` on a `nav_contribution_group_missing` warning — and the package name inside its message — is now `''` instead of `packages[<index>]`, in both `os build` and `os validate`, matching what the runtime already reports at boot. Every package with a non-empty `id` or `name` is unaffected: both rules answered identically there, measured on the control legs.
- **The id is carried and printed, never keyed on.** Two packages that both resolve to `''` still produce two findings rather than collapsing into one — pinned, because that failure mode would present as a report going quiet rather than as an error.

`artifactPackagesOf` is removed. It was never reachable through this package's `exports` map (`.`, `./console`, `./hook-body`), so no consumer import can break; the removal is internal to `dist`.
