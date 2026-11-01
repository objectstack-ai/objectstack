---
"@objectstack/service-automation": patch
---

fix(service-automation)!: an installed package's connector entry never reads the host's files

A connector entry declared by a package that was installed into the runtime (`os package install`, `POST /api/v1/marketplace/install-local`; the package registry's `source: 'marketplace'`) was handed `loadPackageFile` / `resolvePackagePath` anchored at the HOST's root, whichever package declared it. An installed package has no directory on the runtime it is installed into, so a relative ref resolved against another package's files: an installed `openapi` connector naming `./src/system/connectors/status-openapi.json` materialized `ready` with the showcase's own document, and a stdio `mcp` connector naming `./scripts/mcp-fixture.mjs` spawned the showcase's own fixture in the showcase's directory.

Clause-②: no (narrowing) — a connector entry that is not the host's own (an installed package's, or one whose stamp no registration records) is refused its package-relative file and path refs, which it was handed before against the host's root. Nothing is widened.

Metadata-protocol: narrowed (an installed package's connector `providerConfig` may no longer name a package-relative file, and an installed package's stdio `mcp` transport is refused)

<!-- adr-0087: not-required (no-migration-prescription) No key is added, removed or renamed and the stored shape is unchanged: the same `providerConfig` is accepted, and what is refused is the host's root being read on the installed package's behalf. No conversion can carry a file the install never held; the refusal names the entry, its package, the ref and the remedy, and a current `os build` already writes the document into the artifact. -->

**BREAKING** behaviour narrowing for installed packages' connectors (`@objectstack/service-automation`), shipped as `patch` beside the `minor` of `@objectstack/objectql` and `@objectstack/cloud-connection` that carries the same declaration.

- **Before.** An installed package's entry naming a package-relative file or location read the host's own file, or ran a stdio process in the host's directory.
- **Now.** Both members refuse every ref for such an entry, naming the entry, its package and the ref: a configuration fault, so the instance is not materialized and the reconcile logs the refusal. Whose entry it is comes only from what a registering door recorded (the package row's `source`, or the residual owner's door for an artifact residual), never from the entry's own words: an entry stamped with a package no registration records is refused its refs as well.
- **Unchanged.** An entry carrying its document inline or as an `http(s)` URL, and every entry of the host's own stack, which keeps reading its files as before.
- **Who sees it.** An installed package whose connector names a package-relative `openapi` spec, or declares a stdio `mcp` transport.

**The remedy.** Rebuild the package with a current `os build`, which carries an `openapi` spec file into the artifact, or inline the document; an installed package reaches an MCP server over `http`, since a stdio transport needs a working directory inside the package.
