---
'@objectstack/spec': minor
---

feat(spec)!: the docs-viewer keys are retired — `ApiDocumentationConfig.ui` (with `ApiTestingUiConfigSchema` / `ApiTestingUiType`) and the REST API plugin config's `openApi.uiPath` / `openApi.uiFramework` are refused with a prescription naming the OpenAPI document (ADR-0049)

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered api-docs-viewer-keys-retired -->

**BREAKING** — an accept-set narrowing on a published authoring surface, shipped as `minor` under the repo's launch-window convention for accept-set narrowings.

Three keys declared an HTML API documentation viewer, and nothing ever read any of them: `ApiDocumentationConfig.ui` (a viewer type such as `swagger-ui`, `redoc` or `scalar`, served at `ui.path`, default `/api-docs`), and on the REST API plugin config `openApi.uiPath` (default `/api/docs`) with its viewer selector `openApi.uiFramework` (default `swagger-ui`). Since the docs viewer page was taken offline, the API origin serves no HTML viewer at all, only the machine-readable OpenAPI document, so none of the three could be honoured. They are retired under ADR-0049 enforce-or-remove, with no staged window.

**What is refused:** each key is a `retiredKey()` tombstone. Authoring it is a `tsc` error at the site, and a parse error at the key's path whose message is the prescription, for every former value including the old defaults. The value schemas `ApiTestingUiConfigSchema` and `ApiTestingUiType`, with the `ApiTestingUiConfig`, `ApiTestingUiConfigParsed` and `ApiTestingUiType` types, are no longer exported: they had no consumer once `ui` was gone.

**What stays accepted:** every other key of `ApiDocumentationConfigSchema`, `OpenApiGenerationConfigSchema` and `RestApiPluginConfigSchema`, byte-identically, defaults included. The mounted REST surface is unchanged: none of the three keys ever reached it.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| `ui: { type: 'swagger-ui', … }` on an `ApiDocumentationConfig` | nothing: delete the key |
| `openApi: { uiPath: '/api/docs' }` on a REST API plugin config | nothing: delete the key |
| `openApi: { uiFramework: 'redoc' }` on a REST API plugin config | nothing: delete the key |
| `import { ApiTestingUiConfigSchema, ApiTestingUiType } from '@objectstack/spec/api'` | nothing: no replacement exists |

The one-line fix: delete `ui`, `uiPath` and `uiFramework`, and point any viewer or client generator you run yourself at the OpenAPI document, `GET /api/v1/openapi.json` under the REST server's default `api.basePath` and `api.version` (the path follows both), mounted while `api.enableOpenApi` is on.

## Who is affected, measured

- **objectstack** at `b93c750c7`: zero readers and zero authorings outside `packages/spec`. The only identifier hits were a local `uiPath` variable for the unrelated `/ui/view` route in `packages/rest`; nothing in the tree parses the three schemas outside their own unit tests. A tree-scoped absence pin now holds that zero.
- **objectui** at the console pin `.objectui-sha` `56cf4d8e89`: zero hits for any of the keys or exported names, so the console build at the pin is unaffected.
- **Deployed configuration** was not measured.

## The ADR-0087 disposition

- `RETIRED_KEYS_BY_MAJOR[18]` gains `api/ApiDocumentationConfig:ui`, `api/OpenApiGenerationConfig:uiPath` and `api/OpenApiGenerationConfig:uiFramework`; `RETIRED_DEFS_BY_MAJOR[18]` gains `api/ApiTestingUiConfig` and `api/ApiTestingUiType`.
- The D3 semantic entry `api-docs-viewer-keys-retired` and its step-18 rationale fragment carry the prescription to `os migrate meta`, the upgrade guide and `spec-changes.json`.
- No D2 conversion: neither config is a stack collection member or a stored row, so no conversion seam would ever see one. `uiPath` and `uiFramework` carried Zod defaults, but nothing parses the REST API plugin config into a stored or built artifact, so no emitted default needs tolerating.

The retirement kit:

- the three tombstones and their retirement records (`packages/spec/src/api/documentation.zod.ts`, `packages/spec/src/api/plugin-rest-api.zod.ts`); the two value defs deleted; `REST_API_PLUGIN.md`'s example and feature list no longer name a viewer
- pin test `docs-viewer-keys-retirement.test.ts`: `code`, `path` and the prescription at each door (each schema and `RestApiPluginConfigSchema.openApi`), the `tsc` channel, the live controls, zero holders for the retired names, the ADR-0087 registration, and a tree-scoped absence walk
- generated artifacts follow the schema: `authorable-surface/`, `authorable-defaults/`, `json-schema.manifest/`, `api-surface/`, `export-origins/`, `declaration-map/`, the strictness-ledger counts and the reference pages for `api/documentation` and `api/plugin-rest-api`
