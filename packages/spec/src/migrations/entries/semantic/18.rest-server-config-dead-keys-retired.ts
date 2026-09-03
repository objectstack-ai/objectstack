// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'rest-server-config-dead-keys-retired',
  surface: 'restServer.crud.patterns / restServer.crud.objectParamStyle / restServer.metadata.cacheTtl / '
    + 'restServer.metadata.endpoints.schema / restServer.batch.operations.upsertMany / '
    + 'restServer.batch.defaultAtomic / restServer.routes.includeObjects / restServer.routes.excludeObjects / '
    + 'restServer.routes.nameTransform / restServer.routes.overrides',
  replacement:
    '(removed — delete each key; none had an effect to preserve. Per-object API exposure is declared on '
    + 'the object: `enable.apiEnabled: false` hides it from the REST data surface (404) and '
    + '`enable.apiMethods` whitelists its operations (405). The data base path is `crud.dataPrefix`, '
    + 'deployment-wide. An endpoint on a custom path or method — or one that needs its own `summary` / '
    + '`description` / `cacheTtl` — is a declarative `api` endpoint (`type: \'object_operation\'`). '
    + 'Batch atomicity is the per-request `options.atomic` (ADR-0119 D4); upsert is an operation type of '
    + 'the generic `POST /data/:object/batch` endpoint, gated by `batch.enableBatchEndpoint`.)',
  reason:
    'The #14369 liveness census enrolled the four `RestServerConfig` sub-objects and found 15 of their '
    + '32 rows `dead`: parsed, defaulted and normalized into the REST server\'s config by `normalizeConfig` '
    + '(#11984) and never read back. `crud.patterns` and `routes.overrides` described route customization '
    + 'the server mounts from fixed pairs; `routes.includeObjects` / `excludeObjects` and `overrides.enabled` '
    + '/ `operations` duplicated the object\'s own enforced exposure keys; `nameTransform` and '
    + '`objectParamStyle` were enums validated and then ignored; `metadata.endpoints.schema` and '
    + '`batch.operations.upsertMany` gated routes that were never built; `metadata.cacheTtl` fed no cache '
    + 'and no header; `batch.defaultAtomic` would have silently overridden a per-request contract ADR-0119 '
    + 'D4 had deliberately set. Enforce-or-remove (ADR-0049) resolved every family to REMOVE because each '
    + 'promised capability either already exists at its proper seat (the object, the declarative endpoint, '
    + 'the batch request) or would contradict a fixed contract (the client SDK, the discovery document and '
    + 'the served /openapi.json all describe the mounted CRUD paths; the object `name` is the REST path '
    + 'segment). All four schemas are non-strict `z.object()`s, so each key is a `retiredKey()` tombstone '
    + 'and its ledger row stays `dead` with a REMOVED note; `api/CrudEndpointPattern`, the value def of '
    + '`crud.patterns`, leaves with it. No D2 conversion: a `RestServerConfig` is plugin TS configuration, '
    + 'never a stack collection member or a `sys_metadata` row (the `openApi31` precedent, #4579). Cloud '
    + 'sweep #14796 @9b6abe0f2fd5: zero hits, structural — cloud never authors a `RestServerConfig`. #14691.',
  acceptanceCriteria:
    'No `RestServerConfig` value passed to the REST plugin (or `plugin-hono-server` `restConfig`) carries '
    + 'any of the ten keys — a config that does now fails `new RestServer(...)` / `createRestApiPlugin().start()` '
    + 'with the retirement prescription (naming the sub-object, the key and the declaring schema) instead of '
    + 'being accepted and ignored; `tsc` refuses the key at the authoring site (`never`). Every LIVE key of the '
    + 'four sub-objects parses byte-identically to before: `crud.operations.*`, `crud.dataPrefix`, '
    + '`metadata.prefix` / `enableCache` / `maskObjectFields` / `endpoints.types|items|item`, '
    + '`batch.maxBatchSize` / `enableBatchEndpoint` / `operations.createMany|updateMany|deleteMany` keep '
    + 'their defaults and their mounts. The mounted REST surface is byte-identical before and after — none '
    + 'of the ten keys ever reached it. No code imports `CrudEndpointPattern(Schema)` from '
    + '`@objectstack/spec/api` (TS2305 after upgrade).',
};
