// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #25159 — ADR-0049 enforce-or-remove on `ApiDocumentationConfigSchema.ui`
// (triage route A, no staged window, following the maintainer's ruling to take
// the docs viewer page offline). The key declared an interactive documentation
// viewer (`swagger-ui` / `redoc` / `scalar` / …, at `ui.path`, default
// `/api-docs`) that nothing ever mounted: zero readers outside `packages/spec`
// in this repo and in objectui at its pinned sha, measured at b93c750c7 against
// a lit control, and the API origin serves no HTML viewer at all — only the
// OpenAPI document. Tombstoned with `retiredKey()`: the schema is a non-strict
// `z.object`, so a bare deletion would be a silent strip (ADR-0104). Its value
// defs `api/ApiTestingUiConfig` and `api/ApiTestingUiType` left with it
// (`RETIRED_DEFS_BY_MAJOR[18]`).
//
// Registered here but NOT in `src/conversions/registry.ts`, the
// `kernel/Manifest:loading` reasoning: an `ApiDocumentationConfig` is not a
// stack collection member and never a `sys_metadata` row, so a conversion
// would have no seam that ever runs. The D3 semantic entry
// `api-docs-viewer-keys-retired` carries the prescription.
export const entry = 'api/ApiDocumentationConfig:ui';
