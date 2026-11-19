---
'@objectstack/runtime': patch
'@objectstack/cloud-connection': patch
---

fix(runtime, cloud-connection): an upgrade replaces the package's seed datasets on the shared replay list

Clause-②: no
Metadata-protocol: none

The shared `seed-datasets` list that per-organization seed replay reads was append-only. After a package was upgraded in a running process, the superseded version's datasets stayed on the list until a restart, so every organization founded in between replayed the old and the new version's seed sets. When the upgrade changed an object's `fallback: true` set, the two marked sets refused that object's fallback choice, and a dataset declaring `dependsOn` that object refused the whole load for an organization whose locale no set lists.

`mergeSeedDatasets(ctx, datasets, owner?)` takes an optional `owner`. Given, the owner's earlier entries are replaced on the same live array (in their place) instead of kept beside the new ones; an empty `datasets` takes them off. Omitted, the datasets are appended as before, which is what a config app's boot merge still does. The install-local door merges under the package id on install, upgrade, reinstall, reseed and rehydrate, so the list holds the installed version only: reinstalling the same version adds no duplicate, and a version that ships no seed data takes its predecessor's datasets off the list.
