---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): install-local loads a composed bundle's translations and asks about its installation-wide uniques

Clause-②: no
Metadata-protocol: none

A composed bundle (`dist/objectstack.json` with `packages[]`, the ADR-0130 D4 publish shape) carries its `translations` and its `objects` inside each package body, with no top-level copy. Two readers of `MarketplaceInstallLocalPlugin` read the top level only:

- the install's side effects loaded no translations (`translationsLoaded: 0`, on install, reseed, upgrade and restart), so a composed app's labels never reached the i18n service and zh-CN users saw the source language;
- the ADR-0120 D5e ceremony on an `isolated` deployment listed none of the package bodies' installation-wide uniques (`unique: 'global'`, a declared index's `unique: 'global'`), so a composed app installed without the confirmation and with no attestation recorded.

Both now read through `resolveStackCollection` from `@objectstack/core`, the reader the seed datasets already use: the top-level list when the body carries one, otherwise each package body's, in the artifact's package order. A flat bundle, and a composed artifact that still carries its flattened top-level list, read exactly that list, once, as before. On an `isolated` deployment, a composed artifact whose `packages` the resolver refuses is answered at the ceremony with the resolver's refusal (`422`, its own code, such as `INVALID_ARTIFACT_PACKAGES`), and nothing is installed or written.
