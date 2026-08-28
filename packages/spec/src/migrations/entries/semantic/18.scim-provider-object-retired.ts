// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'scim-provider-object-retired',
  surface:
    'the `sys_scim_provider` platform object (`SysScimProvider` in '
    + '`@objectstack/platform-objects/identity`, re-exported from the package '
    + 'root) and its name in `PLATFORM_PROVIDED_OBJECT_NAMES` '
    + '(`@objectstack/spec/system` constants). The rc.1-era `@better-auth/scim` '
    + 'connection row: one row per SCIM bearer connection, written only by the '
    + 'retired `/scim/generate-token` endpoint.',
  replacement:
    '(removed — no direct replacement row. The stable `@better-auth/scim` '
    + '1.7.x line (#3653, PR #12726) derives no `scimProvider` model: SCIM '
    + 'state lives in the seven stable platform objects '
    + '(`sys_scim_connection_binding`, `sys_scim_group`, '
    + '`sys_scim_group_member`, `sys_scim_identity_tombstone`, '
    + '`sys_scim_projection_grant`, `sys_scim_subject`, `sys_scim_user`) and '
    + 'connection credentials in the ObjectStack-owned '
    + '`sys_scim_connection_credential`, minted/verified by '
    + '`scim-connection-service.ts` behind the application-owned '
    + '`verifyBearerToken`. A SCIM-enabled deployment re-registers its '
    + 'connections on the stable surface; rc.1 token digests are not portable '
    + 'on any path, so the IdP reissues its token — a migration-day operator '
    + 'action, not a code rewrite.)',
  reason:
    'Maintainer ruling 2026-08-24 on #11693 (verbatim: 「11700 11693 不需要考虑'
    + '历史数据，其他按照你的建议继续」) — disposition A: retire, with no '
    + 'data-migration path owed for existing rows (reaffirmed 2026-08-25: SCIM '
    + 'has no real customers; the binding constraint is a smooth upgrade). '
    + 'Executed as #11757 after the stable-1.7.1 migration landed (#3653 / '
    + 'PR #12726): the installed library derives no `scimProvider` model, so '
    + 'the object backed nothing — nothing could write a row to it any more. '
    + 'Retiring it also removes its `provider_id` unique index, whose '
    + 'stricter-than-upstream uniqueness was flagged on #3653 and parked '
    + 'pending exactly this retirement.',
  acceptanceCriteria:
    'No code imports `SysScimProvider` from `@objectstack/platform-objects` '
    + '(TS2305 after upgrade); `isPlatformProvidedObjectName(\'sys_scim_provider\')` '
    + 'returns false, so a stack referencing the name is flagged as a probable '
    + 'typo rather than resolved; plugin-auth provisions no `sys_scim_provider` '
    + 'object and `AUTH_MODEL_TO_PROTOCOL` carries no `scimProvider` entry; the '
    + 'spec registry conformance test (`platform-object-names.test.ts`) pins '
    + 'the absence bidirectionally — re-adding either the object file or the '
    + 'registry name alone reds `registry group "platform-objects" is out of '
    + 'date` (measured both ways on #11757). Existing `sys_scim_provider` '
    + 'tables in deployed databases are left in place untouched, by ruling — '
    + 'no backfill, no reaper, no migrate command.',
};
