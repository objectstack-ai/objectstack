---
'@objectstack/spec': minor
---

feat(spec): the package export manifest declares `withheldMaps`, the maps it withheld whole, and an unmanaged import accepts it

Clause-②: yes (widening)
Metadata-protocol: added

`GET /packages/:id/export` writes each item as a served read returns it, so a connector's header and environment-variable maps are already withheld whole by the connector redactor and the exported item simply lacks them. An import elsewhere could not tell such a map from one the package never had. The export contract now has a place to say so:

- **`PackageExportManifestSchema` gains an optional fixed key `withheldMaps`**, a list of `{ type, name, path }`: `type` is `connector`, `name` is the connector item's name, and `path` is one of the four positions the redactor withholds whole, spelled as it reports them: `providerConfig.headers`, `providerConfig.defaultHeaders`, `providerConfig.transport.headers`, `providerConfig.transport.env`. Positions only: no header or variable name is listed, and an entry carrying any other key is refused. Absent when the export withheld nothing. The export does not write it yet; the runtime half follows.
- **`UNMANAGED_INSTALL_KEY_DISPOSITIONS` classifies `withheldMaps` as `door`**, so an unmanaged import accepts an export that carries it instead of refusing the whole package for an unrecognised key. The door reads it; the new base never carries it.
- **The export's `label` is classified `door` too.** The export contract has always declared it, but the table never classified it, so an unmanaged import refused any export that carried one. The base's install manifest declares no `label`, so the base is named by the request's `targetName` or the source `name`, as before.

The table's totality test now reads the export's fixed keys as a third schema a package body is read with, beside `ManifestSchema` and the stack definition, so a fixed key the export gains reddens a spec test on the PR that adds it.
