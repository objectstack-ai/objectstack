---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): install-local connects a composed bundle's package-body datasources, judges their names before any write, and names their connector credentials

Clause-②: no
Metadata-protocol: none

A composed bundle (`dist/objectstack.json` with `packages[]`, ADR-0130 D4) carries its datasources, connectors and objects in each package body, and none at the top level. `POST /api/v1/marketplace/install-local` read those three from the top level only. A composed install answered 200, but `connectPackageDatasources` was handed no datasources and no objects, so a datasource declared in a package body was never registered or connected, and the objects bound to it had no driver. The install answer carried no `datasources` and no `credentialRefs`. The held-name check (step 2a) never saw a body's datasource names either.

Install, upgrade and the restart's rehydrate now read datasources and objects through `resolveStackCollection`, the reader the seed datasets and translations already use: the top-level list when the bundle carries one, otherwise every package body's, in package order. A composed bundle now hands the runtime the same lists as the same declarations in a flat bundle, and the answer lists the same `datasources` and `credentialRefs`.

Step 2a now judges every package body's datasource names. A composed install that declares a name another holder owns is refused `409 RESOURCE_CONFLICT` before any write, as a flat bundle declaring that name already was. Before this, such an install answered 200 and left the name with its holder. A `packages` the artifact resolver refuses is answered at this step with the resolver's own `422`, and nothing is written.

The side effects no longer read a top-level array `i18n` as extra translation bundles. `i18n` is a configuration object in the spec, and the boot path never read an array there.
