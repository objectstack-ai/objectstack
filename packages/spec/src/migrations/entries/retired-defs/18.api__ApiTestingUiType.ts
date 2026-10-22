// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #25159 — `api/ApiTestingUiType` (the viewer enum: `swagger-ui`, `redoc`,
// `rapidoc`, `stoplight`, `scalar`, `graphiql`, `postman`, `custom`) left with
// `api/ApiTestingUiConfig`, its only consumer, whose carrier
// `ApiDocumentationConfig.ui` is tombstoned in this same major. Zero readers
// outside `packages/spec` in this repo and in objectui at its pinned sha. See
// `18.api__ApiDocumentationConfig__ui.ts` for the retirement record.
export const entry = 'api/ApiTestingUiType';
