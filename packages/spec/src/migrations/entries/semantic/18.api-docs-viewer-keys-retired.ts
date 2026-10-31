// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #25159 — the D3 entry of the docs-viewer retirement family (one D3 entry per
// retirement family). Registered keys: `api/ApiDocumentationConfig:ui`,
// `api/OpenApiGenerationConfig:uiPath`, `api/OpenApiGenerationConfig:uiFramework`;
// registered defs: `api/ApiTestingUiConfig`, `api/ApiTestingUiType`. Its own
// family rather than a member of `rest-api-config-dead-keys-retired`: those
// keys sit on `RestApiConfigSchema` (the REST server's construction argument)
// and were dead in the `rest_api` liveness census, while these three sit on two
// other schemas and retire because the docs viewer itself was taken offline —
// different surface, different ruling, and that landed entry's meaning is not
// edited here. No D2 conversion: neither config is a stack collection member or
// a stored row, so this entry is where the prescription reaches
// `os migrate meta`, the upgrade guide and `spec-changes.json`.
export const entry: SemanticMigration = {
  id: 'api-docs-viewer-keys-retired',
  surface:
    'ApiDocumentationConfig.ui / RestApiPluginConfig.openApi.uiPath / '
    + 'RestApiPluginConfig.openApi.uiFramework',
  replacement:
    '(removed — delete each key; none had an effect to preserve. The platform serves no HTML API '
    + 'documentation viewer: the API origin publishes the machine-readable OpenAPI document only, at '
    + '`GET /api/v1/openapi.json` under the REST server\'s default `api.basePath` and `api.version` '
    + '(the path follows both), mounted while `api.enableOpenApi` is on. A viewer or client generator '
    + 'you run yourself reads that document. The value schemas `ApiTestingUiConfigSchema` and '
    + '`ApiTestingUiType` and their types have no replacement.)',
  reason:
    'ADR-0049 enforce-or-remove; triage route A with no staged window, which follows the maintainer\'s '
    + 'ruling to take the docs viewer page offline. Three keys declared an HTML documentation viewer: '
    + '`ApiDocumentationConfig.ui` (a viewer type such as `swagger-ui`, `redoc` or `scalar`, served at '
    + '`ui.path`, default `/api-docs`, with theme, try-it-out, CORS and layout switches), and on the '
    + 'REST API plugin config `openApi.uiPath` (default `/api/docs`) with its viewer selector '
    + '`openApi.uiFramework` (default `swagger-ui`). Nothing ever read any of them. Measured at the '
    + 'retirement base (origin/main b93c750c7): outside `packages/spec`, the only identifier hits are '
    + 'a local `uiPath` variable for the unrelated `/ui/view` route in `packages/rest/src/ui-routes.ts`; '
    + 'objectui at its pinned sha has none; both searches carry a lit control on the same instrument; '
    + 'and nothing in the tree parses `ApiDocumentationConfigSchema`, `OpenApiGenerationConfigSchema` or '
    + '`RestApiPluginConfigSchema` outside their own unit tests. Since the viewer page '
    + '`GET {basePath}/docs` was retired, the API origin serves no viewer at all, so the keys could not '
    + 'be honoured either; a declaration of a viewer that is never served is the false capability '
    + 'ADR-0049 removes. Bookkeeping: the three KEYS are `retiredKey()` tombstones on non-strict '
    + '`z.object()`s (RETIRED_KEYS_BY_MAJOR[18]); the value DEFS `api/ApiTestingUiConfig` and '
    + '`api/ApiTestingUiType` leave whole, orphaned once `ui` is gone (RETIRED_DEFS_BY_MAJOR[18]). '
    + '`uiPath` and `uiFramework` carried Zod defaults, but nothing parses the REST API plugin config '
    + 'into a stored or built artifact, so no emitted default exists to tolerate as residue. It is a '
    + 'SEMANTIC entry rather than a D2 conversion because there is no source to rewrite: neither config '
    + 'is a stack collection member or a `sys_metadata` row (the `kernel/Manifest:loading` '
    + 'disposition). The consumer still owes the judgment because a host that wrote one of these keys '
    + 'believed a viewer was being served at a path, and only that host knows who was sent there.',
  acceptanceCriteria:
    'No `ApiDocumentationConfig` carries `ui`, and no REST API plugin config\'s `openApi` block '
    + 'carries `uiPath` or `uiFramework`: authoring any of them is now a tsc error at the site (the '
    + 'tombstone types the key never) and a parse error carrying the retirement prescription at the '
    + 'key\'s path, for every former value including the old defaults `/api/docs` and `swagger-ui`. '
    + 'Code importing `ApiTestingUiConfigSchema`, `ApiTestingUiConfig`, `ApiTestingUiConfigParsed` or '
    + '`ApiTestingUiType` from `@objectstack/spec` or `@objectstack/spec/api` is TS2305 after upgrade, '
    + 'with no replacement to point at. Anyone sent to a viewer path is sent to the OpenAPI document '
    + 'instead, which `GET /api/v1/openapi.json` answers under the default base while '
    + '`api.enableOpenApi` is on. Every other key of both configs parses exactly as before, and the '
    + 'mounted REST surface is unchanged: none of the three keys ever reached it.',
};
