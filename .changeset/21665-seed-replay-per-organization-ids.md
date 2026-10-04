---
"@objectstack/metadata-protocol": patch
---

A per-organization seed replay now gives each organization its own row identity. On a walled deployment, every organization created after the first used to start without the app's fixed-id seed rows. The showcase's `sys_business_unit` tree is one example. The replay inserted each authored `id` again, every insert was refused as a duplicate on the global primary key, and the parent references into those rows stayed unresolved.

Clause-②: no

- A row authored with an `id` keeps that id while no row holds it. The first organization a seed is replayed into is unchanged: it gets exactly the ids the seed authors.
- When another organization (or an organization-less row) already holds the authored id, the row gets an id derived from the authored id and the organization. A second replay into the same organization finds that row again, so it is not inserted twice.
- References in the same replay that name the authored id follow the row to its new id, in pass 1 and in pass 2. This includes a UUID-shaped authored id, which used to be kept verbatim and would have linked to another organization's row.
- The replay logs one `info` line per dataset that it re-identified.
- The rule lives in `SeedLoaderService`, so every load that names an organization follows it: the per-organization replayer, and package apply, draft publish and marketplace install into an organization.
- Boot seeding without an organization, dry runs and rows without an authored `id` are unchanged.
- ⛔ No schema, export, accepted input or error code changes.
