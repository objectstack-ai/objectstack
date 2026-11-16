---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): install-local seeds a composed bundle's package datasets on install, reseed, upgrade and restart

Clause-②: no
Metadata-protocol: none

A composed bundle (`dist/objectstack.json` with `packages[]`, the ADR-0130 D4 publish shape) carries its seed datasets inside each package body and has no top-level `data`. Every seed door of `MarketplaceInstallLocalPlugin` read the top-level `data` only, so such a bundle installed with no sample data: the install, the reseed and an upgrade reported `seeded: { mode: 'skipped', reason: 'no-datasets' }`, nothing was shared for the per-organization replay of new organizations, the restart heal had nothing to seed, the purge answered `NOTHING_TO_PURGE`, the sample-data count answered `0`, and the installed-apps listing answered `withSampleData: false`.

Every one of those doors now reads the seed datasets through `resolveStackCollection(body, 'data')` from `@objectstack/core`: the top-level `data` when the body carries one, otherwise each package body's, in the artifact's package order (the dependency order the packages register in). A flat bundle, and a composed artifact that still carries its flattened top-level `data`, read exactly that list, once, as before.

An upgrade seeds the incoming version's datasets into the organization the request acts in (or the single-tenant database), the same as a flat bundle's upgrade, so a package an upgrade adds gets its sample rows there. Organizations other than the caller's are not reseeded by an upgrade, for a flat bundle or a composed one.
