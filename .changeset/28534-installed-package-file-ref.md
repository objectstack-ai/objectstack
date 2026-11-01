---
"@objectstack/service-automation": patch
---

Clause-②: no
Metadata-protocol: none

fix(service-automation): an installed package's connector entry never reads the host's files

A connector entry declared by a package that was installed into the runtime (`os package install`,
`POST /api/v1/marketplace/install-local`; the package registry's `source: 'marketplace'`) was handed
`loadPackageFile` / `resolvePackagePath` anchored at the HOST's root, whichever package declared it. An installed
package has no directory on the runtime it is installed into, so a relative ref resolved against another package's
files: an installed `openapi` connector naming `./src/system/connectors/status-openapi.json` materialized `ready`
with the showcase's own document, and a stdio `mcp` connector naming `./scripts/mcp-fixture.mjs` spawned the
showcase's own fixture in the showcase's directory.

Both members now refuse every ref for such an entry, naming the entry, its package and the ref: a configuration
fault, so the instance is not materialized and the reconcile logs the refusal. Fix by rebuilding the package with a
current `os build`, which carries an `openapi` spec file into the artifact, or by inlining the document; an
installed package reaches an MCP server over `http`, since a stdio transport needs a working directory inside the
package. An entry carrying its document inline or as an `http(s)` URL is unaffected, and so is every entry of the
host's own stack, which keeps reading its files as before.
