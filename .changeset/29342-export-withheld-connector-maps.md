---
'@objectstack/runtime': patch
'@objectstack/cloud-connection': patch
'@objectstack/spec': patch
---

feat(runtime): a package export names each connector map it withheld, and both install modes of install-local name each one as incomplete

Clause-②: yes (widening)
Metadata-protocol: none

`GET /api/v1/packages/:id/export` writes served items, and the served read withholds four connector maps whole: `providerConfig.headers`, `providerConfig.defaultHeaders`, `providerConfig.transport.headers` and `providerConfig.transport.env`. An exported connector used to arrive with such a map simply absent, so an import could not tell a withheld map from one the package never had. Now:

- **The export lists each one.** The manifest's `withheldMaps` (declared on `PackageExportManifestSchema`) holds `{ type: 'connector', name, path }` for every map withheld. Each exported connector's stored body is judged by the same `connector` redactor the served read ran, read through the protocol's by-name execution face. Only the position leaves that read: no header or variable name, and no value. A package that withheld nothing carries no key. An export that cannot judge (a protocol without `getMetaItemForExecution`, or a connector that read answers no body for) fails rather than omitting the key, because from an exporter that writes it, an absent key means nothing was withheld.
- **Both install modes name each one.** `POST /api/v1/marketplace/install-local`, managed and unmanaged, accepts the package and answers `withheldMaps`, the list as the export wrote it, plus one `warn` line naming every map. The key is left out when the body carries no list, so that answer's key set is unchanged.
- **One narrowing, at the door.** A `withheldMaps` value the export's declaration refuses is now answered `PLUGIN_MANIFEST_INVALID` (400 for an inline manifest, 502 for a cloud snapshot) before any write, in either mode, the way an invalid `installModes` already is. Before this change the door ignored the key, whatever its value. No export wrote the key before this release, so only a hand-written list can be refused. Fix: send the list exactly as the export wrote it, or drop it.
- **Spec.** The `[PLANNED — not yet served]` marker is dropped from `withheldMaps`' describe, and the docblocks now say the key is served.
