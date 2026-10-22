// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #25159 — ADR-0049 enforce-or-remove on `OpenApiGenerationConfigSchema.uiPath`
// (authored as `RestApiPluginConfig.openApi.uiPath`; triage route A, no staged
// window, following the maintainer's ruling to take the docs viewer page
// offline). "URL path to serve documentation UI", default `/api/docs`, and no
// viewer was ever served from it: the only `uiPath` hits outside
// `packages/spec` are an unrelated local variable in
// `packages/rest/src/ui-routes.ts`, objectui at its pinned sha has none,
// measured at b93c750c7 against a lit control. Tombstoned with `retiredKey()`
// on the non-strict `OpenApiGenerationConfigSchema`; its `.default()` leaves
// no residue, because nothing parses this config into a stored or built
// artifact. No D2 conversion (a REST API plugin config is not a stack
// collection member, the `kernel/Manifest:loading` reasoning); the D3 semantic
// entry `api-docs-viewer-keys-retired` carries the prescription.
export const entry = 'api/OpenApiGenerationConfig:uiPath';
