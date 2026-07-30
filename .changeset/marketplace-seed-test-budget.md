---
"@objectstack/cloud-connection": patch
---

fix(cloud-connection): align the marketplace seed test's timeout with its sibling (#3785)

`marketplace-install-local-state-machine-exempt.test.ts` failed under a
full-repo `pnpm test` at 30s, while passing every time the package ran alone.

Both marketplace seed tests drive `MarketplaceInstallLocalPlugin`, whose
seeding path dynamically imports the real `@objectstack/runtime` (unmocked on
purpose, twice: `recordSeedSummary` and `mergeSeedDatasetsIntoKernel`). That
cold import costs seconds by itself and multiples of that under a fully
parallel turbo run, and it is charged to whichever test triggers it first.

Its sibling `marketplace-install-local-seed-lookup.test.ts` was diagnosed as
exactly this — *"an import stall, not a hang"* — and raised to 120s. This file
was left at 30s and kept flaking the same way. The budget is now aligned, with
the rationale stated locally rather than only in the sibling.

The flaky set turns out to be exactly the intersection of "does not mock
`@objectstack/runtime`" and "actually drives seeding":

| test | mocks runtime | drives seeding | budget |
| :--- | :--- | :--- | :--- |
| `conflict`, `bundle` | no | **no** — never reaches the import | default |
| `reseed`, `heal` | **yes** | yes | default |
| `seed-lookup` | no | yes | 120s (already) |
| `state-machine-exempt` | no | yes | 120s (this change) |

So the two tests #3785 recorded are the only two that can hit this, and no
other file needs the same treatment. A genuine hang still fails — later.
