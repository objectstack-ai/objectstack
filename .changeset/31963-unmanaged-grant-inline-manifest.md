---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): an unmanaged grant of an organization's private package copies from the grant's own manifest

Clause-②: yes — a granted unmanaged copy of a private package that answered `404 CLOUD_FETCH_FAILED` now copies when the control plane's grant says which manifest it granted; every refusal of the copy stays, and a granted copy whose manifest is not the granted package and version is refused before any write.
Metadata-protocol: none

On a hosted environment, `POST /api/v1/cloud-connection/install` with `install_mode: 'unmanaged'` hands the copy to the environment's install-local door. That door fetched the granted version's manifest from the catalog with the environment's shared service key, which the catalog does not serve an organization's private manifest to, so nothing was copied.

- The grant's own `data.manifest` is now handed to the door inline when the answer says which manifest it granted: the requested `package_id` when that is itself a manifest id (`com.acme.crm`), otherwise the answer's `data.manifest_id` (the Console names the catalog record id, which is not a manifest id).
- The door copies that manifest only when it declares exactly that id and the granted `data.version`; otherwise it answers `502 PLUGIN_MANIFEST_INVALID`, copies nothing, and leaves the environment's `package_unmanaged_import` failure row. A grant carrying its manifest but no `data.version` answers `502 PLUGIN_INSTALL_FAILED` and copies nothing.
- Every check the fetched manifest gets runs on the inline one (the id rule, the walled catalog, the ADR-0087 protocol handshake, the ADR-0141 dependency check, the `installModes` gate, sample data and the copy's audit rows), with the fetched manifest's statuses (`502` where a caller's file import answers `400`).
- A grant answer with no `data.manifest`, or one that does not say which manifest it granted, keeps the catalog fetch, as before. The manifest comes only from the control plane's answer: a `manifest` in the caller's request body never reaches the door, and the `install-local` route's own file import is unchanged.

A private package named by its catalog record id copies end to end once the control plane echoes `data.manifest_id` in its unmanaged grant.
