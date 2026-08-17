---
'@objectstack/cloud-connection': patch
---

Marketplace install-local now registers the per-organization seed replayer alongside its dataset merge, so organizations founded after an install are no longer empty.

Installing a package merged its `data` blocks onto the kernel's shared `seed-datasets` service but never registered the `seed-replayer` service that consumes them. That replayer is registered in `AppPlugin`'s seeder path, so a host runtime declaring no seed data of its own — `objects: []`, no `data`, which is exactly the shape a marketplace install targets — ended up with datasets present and no replayer. On a walled (`isolated` / `group`) deployment the org-scoping middleware then found the datasets, found no replayer, and did nothing: every organization founded after the install received zero rows of the installed app, while the installer's own organization looked correct because it had been seeded inline at install time.

`applySideEffects` now calls the runtime's `registerSeedReplayerOnce` next to the merge, on both the install and the rehydrate path. Registration is register-once by construction, so a host that already has a replayer keeps it and is unaffected; the incumbent re-reads the same shared list and replays the newly installed datasets too.
