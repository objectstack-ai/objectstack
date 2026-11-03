---
'@objectstack/runtime': patch
'@objectstack/client': patch
'@objectstack/cli': patch
'@objectstack/spec': patch
---

feat(runtime,client,cli): export a deployment's whole ontology as installable packages in one read (`GET /packages/export`, `os package export`)

Clause-②: yes (widening)
Metadata-protocol: none

A tenant could take its ontology out of a deployment only one package at a time (`GET /packages/:id/export`). The whole-deployment export declared in `@objectstack/spec` (`PackageExportBundleSchema`) is now served.

- **`@objectstack/runtime`**: `GET /api/v1/packages/export` answers `{ packages }`: every installed package whose registry row's `source` is not `code` (the marketplace and authored packages, each base's `.custom` pair among them), disabled ones included, each exactly as `GET /packages/:id/export` answers it, dependencies first, so a pair follows its base. It reads with the per-package export's gate (`studio.access` or `setup.access`), refuses any query parameter `400 VALIDATION_ERROR` naming it, and is whole or absent: a package whose export cannot be assembled fails the read, naming that package. No credential value is carried: credential positions are withheld as on every served metadata read, and a connector's `credentialRef` stays a reference.
- **`@objectstack/client`**: `client.packages.exportAll()` calls it.
- **`@objectstack/cli`**: `os package export [--out DIR]` writes one directory per package, numbered in install order (`DIR/01-ID/objectstack.json`), each installable with `os package install`. A refusal is printed with its status and code and nothing is written; an `--out` directory that already holds files is refused.
- **`@objectstack/spec`**: the `[PLANNED — not yet served]` marker comes off `PackageExportBundleSchema`'s description, which now names the route and the command.
