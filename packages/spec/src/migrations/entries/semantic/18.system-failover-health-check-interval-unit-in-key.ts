// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'system-failover-health-check-interval-unit-in-key',
  surface: 'FailoverConfig.healthCheckInterval, the disaster-recovery health-check period '
    + 'whose name carried no unit (system/disaster-recovery.zod.ts)',
  replacement: 'healthCheckIntervalSeconds — rename the key; the value and the 30 default '
    + 'are unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'It stands alone because its file has exactly one offender left — and because the key '
    + 'directly beside it is the counter-example that shows where the line falls. '
    + 'FailoverConfig.dns.ttl is also a bare-named duration in seconds, and it is NOT renamed: '
    + 'it carries an externalVocabulary marker because it mirrors the DNS resource-record TTL '
    + 'field (RFC 1035 section 4.1.3), spelled ttl by every provider API the value is '
    + 'forwarded to (Route 53, Cloudflare). healthCheckInterval mirrors nothing outside this '
    + 'repo, so the exemption does not reach it. Tombstoned with retiredKey(); the shape is '
    + 'not strict, so a bare deletion would strip in silence. Why a semantic entry and not a '
    + 'D2 conversion: stack.zod.ts declares no disasterRecovery collection and a failover '
    + 'config is host configuration, never a stored sys_metadata row. #15679, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every FailoverConfig author spells healthCheckIntervalSeconds; authoring '
    + 'healthCheckInterval fails to compile (input type `never`) and fails to parse with the '
    + 'rename prescription. Behaviour is unchanged: healthCheckIntervalSeconds: 30 probes '
    + 'every thirty seconds exactly as before, and an omitted key still defaults to 30. The '
    + 'migration is proved correct when dns.ttl is still spelled ttl — a sweep that renamed '
    + 'it too has over-applied the rule and stripped a declared exemption.',
};
