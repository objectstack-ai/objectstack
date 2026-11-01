---
"@objectstack/service-automation": patch
---

fix(service-automation)!: a connector stored in the environment never reads the host's files

A provider-bound connector saved through the metadata door (`PUT /api/v1/meta/connector/:name`, Studio), environment-wide or into a package created in the environment (`POST /api/v1/packages`, an `authored` package), had its package-relative refs resolved against the HOST's root, as if the host's own stack had declared it. A stored definition is no package's declaration and has no directory on disk, so a relative ref it names is now refused, the way an installed package's has been since #28534.

Clause-②: no (narrowing) — a stored connector entry (environment-wide, or in an `authored` package) is refused its package-relative file and path refs, which it was handed before against the host's root. Nothing is widened.

Metadata-protocol: narrowed (a stored connector's `providerConfig` may no longer name a package-relative file, and a stored stdio `mcp` transport is refused)

<!-- adr-0087: not-required (no-migration-prescription) No key is added, removed or renamed and the stored shape is unchanged: the same `providerConfig` is accepted at the save door, and what is refused is the host's root being read on the stored entry's behalf. No conversion can carry a file the environment never held; the refusal names the entry, its package if it has one, the ref and the remedy. -->

**BREAKING** behaviour narrowing for stored connectors (`@objectstack/service-automation`), shipped as `patch`.

- **Before.** A stored entry's package-relative refs (an `openapi` spec path, a stdio `mcp` transport's working directory) resolved against the host's root.
- **Now.** Every such ref is refused for a stored entry, naming the entry, its package if it has one, and the ref: a configuration fault, so the instance is not materialized and the reconcile logs the refusal. Only an entry the host's stack declares reads the host's root: one a package registration filed with the same provider binding, or one the host's own artifact carries. A stored row is never read as the host's, whatever `_packageId` its body carries.
- **Unchanged.** A stored entry carrying its document inline or as an `http(s)` URL, every entry of the host's own stack, and an installed package's entries (refused as before).
- **Who sees it.** A connector saved in the environment whose `openapi` spec is a package-relative path, or whose `mcp` transport is stdio.

**The remedy.** Carry the document inline in the definition, or name it by an `http(s)` URL; reach an MCP server from a stored entry over `http`.
