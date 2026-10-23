---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection)!: a cloud-fetched marketplace install whose package ships a position, permission set or capability name an environment-authored item holds is refused before any write, as the file-import install already was

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any metadata schema is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. No export, type, flag or error code is added, removed or renamed: the refusal reuses the door's own `PLUGIN_REGISTER_FAILED` code and the registry's existing security-catalog sentence. What narrows is one install door's answer for a package the registry already refused to load; the remedy for a deployment that already took such an install is an operator one, stated below. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this door (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the install door's accept set narrows), shipped as `patch`: it refuses only installs that could never load.

`POST /api/v1/marketplace/install-local` fetching a package from the marketplace (`packageId` plus `versionId`) used to answer `200` with `hotLoaded: false` when the registry refused the package because an item authored in this system already holds a security catalog name the package ships, for example a customer's clone of a vendor permission set saved under a name the vendor's next version also uses. The door wrote the package to its install ledger anyway and said it would load at the next restart. It never could: the environment's item is loaded at every boot, so the restart met the same refusal. Measured on a real restart, the boot runs, logs `rehydrate failed for <package id>` with the security-catalog sentence, and the package is not loaded at all. On an upgrade, not even its earlier version loads, because the ledger entry that named that version was overwritten.

- **Now:** that install is refused `422 PLUGIN_REGISTER_FAILED` before anything is registered or written, with the registry's sentence naming each colliding name and its holder. The earlier version, on an upgrade, stays installed and loaded. This is the answer an install from an imported file (`manifest` in the body) already gave.
- **Unchanged:** an install with no such collision, fresh or upgrade. A cloud-fetched install the registry refuses for any other reason keeps its lenient `200` answer. A name another package or a built-in holds is not part of this change. `POST /api/v1/packages` cannot ship a catalog name at all: its body parse refuses a `positions`, `capabilities` or permission-set list before any write.
- **Who sees it:** under `single`, the administrator who installs packages. Under `group` and `isolated`, the platform operator, who alone reaches marketplace installs.

**If a deployment already took such an install.** Its boot log carries `rehydrate failed for <package id>` with `Security catalog name conflict`, and the package's apps, objects and permission sets are missing although `GET /api/v1/marketplace/install-local` lists it. Choose one of these:

- To stay on the earlier version, install that version again through the same door (`POST /api/v1/marketplace/install-local` with its `versionId`). It loads at once, and its ledger entry replaces the one that cannot load, so it also loads after a restart.
- To take the new version, first move the environment's item off the name. Save it again under a new name, point every assignment that named the old name at the new one, then delete the item under the old name. Then restart, or install the new version again. Only after that does the old name belong to the package, so an assignment left on the old name grants the package's definition from then on.
