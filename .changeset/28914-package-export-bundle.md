---
'@objectstack/spec': minor
---

feat(spec): `PackageExportBundleSchema` declares the whole-deployment export, every installed package as installable packages in one read

Clause-②: yes (widening)
Metadata-protocol: added

A tenant on ObjectOS Cloud or Enterprise can take its ontology to the Apache-2.0 runtime only one package at a time today (`GET /packages/:id/export`). This declares the contract of the read that answers all of it at once, `GET /packages/export`. The route, and a CLI command that calls it, follow in `@objectstack/runtime` and `@objectstack/cli`; no runtime serves it yet. Until a runtime mounts the route, the schema's description opens with `[PLANNED — not yet served]` (ADR-0049): the shape is the contract that door must answer, not a read a client can make today.

- **`@objectstack/spec`**: `PackageExportBundleSchema` (with `PackageExportBundle` and `PackageExportBundleParsed`) in `@objectstack/spec/api`. The answer is `{ packages }`: every package whose registry row's `source` is not `code` (the marketplace and authored packages, a `.custom` pair among them; a `code` package is registered by the deployment's own code and travels with that code, not with the bundle), enabled or not, each exactly as `GET /packages/:id/export` answers it. The bundle carries no enabled state, so every entry installs enabled. The entries are `PackageExportManifestSchema` itself, so the per-package export stays the one producer. A base's `.custom` pair is its own entry with its override declarations, and environment customizations stay under the package that owns them. The bundle carries no credential value: the per-package export withholds credential positions, and a `credentialRef` stays a reference.
- **Order**: dependencies first, the order a boot hydrates installed packages in (ADR-0141 D5). An entry comes after every entry its package's `manifest.dependencies` names, so a pair comes after its base. Install the entries in the order listed; a consumer never re-sorts them.
- The answer is strict at the top level; each entry stays open, as the per-package export is.
