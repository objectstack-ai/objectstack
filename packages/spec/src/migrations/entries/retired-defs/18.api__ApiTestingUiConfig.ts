// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #25159 — `api/ApiTestingUiConfig` (the documentation-viewer config: type,
// path, theme, try-it-out, CORS and layout switches) left with its one carrier,
// `ApiDocumentationConfig.ui`, tombstoned in this same major
// (`RETIRED_KEYS_BY_MAJOR[18]`). With the key gone it had no consumer, and an
// exported value schema with no consumer reads as a capability. Measured
// before removal: zero readers of `ApiTestingUiConfigSchema` outside
// `packages/spec` in this repo and in objectui at its pinned sha. See
// `18.api__ApiDocumentationConfig__ui.ts` for the retirement record.
export const entry = 'api/ApiTestingUiConfig';
