---
'@objectstack/objectql': minor
---

Load a release artifact's packages in dependency-topological order (ADR-0130 D5).

The `manifest` service now reads both artifact shapes ADR-0130 D4 declares — `packages: [...]` when present, and the singular `manifest` treated as a one-element list when absent — and registers the packages inside one artifact in dependency-topological order, resolved by `resolvePluginOrder`, the platform's single topological sorter (ADR-0116). A package that extends another package's object therefore registers after the package it extends, whatever slot the artifact's array put it in.

An existing single-`manifest` artifact takes the second branch, by reference and unrewritten, and its registration state is unchanged (ADR-0130 D7). New: `resolveArtifactPackageOrder` is exported so every other door that grows an artifact-loading seam reads both shapes and orders them the same way.
