// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #20295 (family `rest-api-retire`, rank 9 of the #18900 census; triage graded
// it RETIRE by the maintainer's criterion) — the D3 entry of the family (ruling
// B on #17152: one D3 entry per retirement family). Registered keys:
// `api/RestApiConfig:responseFormat` and `api/RestApiConfig:documentation.enabled`
// — four ledger keys, since `responseFormat` retires whole with its three
// members. No D2 conversion: a `RestServerConfig` is plugin TS configuration,
// never a stack collection member or a stored row (the #14691 precedent on the
// four sibling sub-objects), so this entry is where the prescription reaches
// `os migrate meta`, the upgrade guide and `spec-changes.json`.
export const entry: SemanticMigration = {
  id: 'rest-api-config-dead-keys-retired',
  surface: 'restServer.api.responseFormat / restServer.api.documentation.enabled',
  replacement:
    '(removed — delete each key; neither had an effect to preserve. Whether the server publishes its '
    + 'OpenAPI document and the docs viewer is `api.enableOpenApi`, the switch the mount already reads. '
    + 'The response envelope is fixed — `BaseResponseSchema` in `@objectstack/spec/api` — and is not a '
    + 'server-wide option, so there is no replacement for `responseFormat`.)',
  reason:
    'The `rest_api` liveness census found every member of these two keys `dead`: `normalizeConfig` '
    + 'parsed them, applied their defaults and copied them into the REST server\'s config, and no site '
    + 'ever read them back. So `responseFormat.envelope: false` unwrapped no response, '
    + '`includeMetadata` and `includePagination` gated nothing, and `documentation.enabled: false` '
    + 'turned no document off — the document\'s existence was, and is, decided by `api.enableOpenApi` at '
    + 'the mount. Enforce-or-remove (ADR-0049) resolved both to REMOVE: mainstream data APIs keep a '
    + 'fixed response envelope that no administrator toggles server-wide, a configurable envelope would '
    + 'fork the one shape the client SDK and the served /openapi.json describe, and `documentation.enabled` '
    + 'duplicates a switch that is already enforced. `RestApiConfigSchema` and its inline `documentation` '
    + 'block are non-strict `z.object()`s, so each key is a `retiredKey()` tombstone and its ledger row '
    + 'stays `dead` with a REMOVED note. No stored or built artifact carries either key, so no emitted '
    + 'default needs to be tolerated as residue: the config is a construction argument that is parsed and '
    + 'consumed in the same process. The consumer still owes the judgment because a host that WROTE '
    + '`envelope: false` or `documentation.enabled: false` believed its clients saw a different shape or '
    + 'no document, and only that host knows which clients were built on the belief.',
  acceptanceCriteria:
    'No `RestServerConfig` value passed to the REST plugin carries `api.responseFormat` or '
    + '`api.documentation.enabled` — a config that does now fails `RestServer` construction (and so '
    + 'the REST plugin\'s `start`) with the retirement prescription, naming the key and '
    + '`RestApiConfigSchema`, instead of being accepted and ignored; `tsc` refuses the key at the '
    + 'authoring site (`never`). A host that meant "serve no OpenAPI document" sets `api.enableOpenApi: '
    + 'false` and sees `GET /openapi.json` and `GET /docs` unmounted. Every client that parses REST '
    + 'responses reads the declared envelope. Every LIVE key of the `api` block — including `documentation`\'s '
    + 'other members — parses byte-identically to before, and the mounted REST surface is unchanged: '
    + 'neither key ever reached it.',
};
