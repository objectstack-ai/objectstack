// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #25159 — ADR-0049 enforce-or-remove on
// `OpenApiGenerationConfigSchema.uiFramework` (authored as
// `RestApiPluginConfig.openApi.uiFramework`), the viewer selector beside
// `uiPath`: `swagger-ui` / `redoc` / `rapidoc` / `elements`, default
// `swagger-ui`, read by nothing (zero hits outside `packages/spec` in this
// repo and in objectui at its pinned sha, measured at b93c750c7 against a lit
// control). It retires in the same change as `uiPath` because it is the same
// viewer declaration — a framework choice for a viewer the platform never
// serves. Tombstoned with `retiredKey()`; no residue, no D2 conversion, for
// the reasons on the `uiPath` entry. D3: `api-docs-viewer-keys-retired`.
export const entry = 'api/OpenApiGenerationConfig:uiFramework';
