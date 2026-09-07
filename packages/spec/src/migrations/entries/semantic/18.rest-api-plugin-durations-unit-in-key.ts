// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'rest-api-plugin-durations-unit-in-key',
  surface: 'the three REST-plugin durations whose name carried no unit: RestApiEndpoint.timeout, '
    + 'RestApiEndpoint.cacheTtl and RestApiPluginConfig.performance.defaultCacheTtl '
    + '(api/plugin-rest-api.zod.ts)',
  replacement: 'timeoutMs (milliseconds), cacheTtlSeconds (seconds) and defaultCacheTtlSeconds '
    + '(seconds, default 300) — rename each key; every value is unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'RestApiEndpoint is this rule\'s clearest specimen after the founding one: `timeout` in '
    + 'MILLISECONDS and `cacheTtl` in SECONDS sat three lines apart on one shape, each unit named '
    + 'only in its describe, so the two numbers were indistinguishable at the authoring site and a '
    + 'value copied from one to the other was off by 1000x with no error anywhere. '
    + 'performance.defaultCacheTtl travels with them rather than in its own entry because it is '
    + 'the plugin-wide DEFAULT behind the per-endpoint override: renaming the override and leaving '
    + 'the default bare would have spelled one value two ways across one config. All three are '
    + 'retiredKey() tombstones — these shapes are not strict, so a bare deletion would strip the '
    + 'old key in silence, and defaultCacheTtl is a tombstone INSIDE the live `performance` block, '
    + 'whose siblings must keep parsing. Why a semantic entry and not a D2 conversion: a '
    + 'RestApiPluginConfig is the REST plugin\'s construction argument and a RestApiEndpoint is a '
    + 'route registration inside it — neither is a stack collection member or a stored row, so the '
    + 'chain has no seam that ever runs on them. That is the disposition '
    + 'api/RestApiEndpoint:handlerStatus already carries on this very shape '
    + '(rest-api-endpoint-handler-status-retired), and what ruling B prescribes for a key that is '
    + 'not authorable metadata. #15677, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every RestApiEndpointSchema.parse(…) and RestApiPluginConfigSchema.parse(…) site spells '
    + '`timeoutMs`, `cacheTtlSeconds` and `performance.defaultCacheTtlSeconds`; authoring any old '
    + 'spelling fails to compile (input type `never`) and fails to parse with the rename '
    + 'prescription naming the suffixed key. The built-in route tables shipped from this module '
    + '(DEFAULT_METADATA_ROUTES, DEFAULT_BATCH_ROUTES, DEFAULT_I18N_ROUTES, '
    + 'DEFAULT_ANALYTICS_ROUTES, DEFAULT_AUTOMATION_ROUTES, DEFAULT_DISCOVERY_ROUTES) author the '
    + 'new spellings at the same magnitudes they authored the old ones — a batch endpoint still '
    + 'gets 60000 ms and a discovery response is still cached for 3600 s.',
};
