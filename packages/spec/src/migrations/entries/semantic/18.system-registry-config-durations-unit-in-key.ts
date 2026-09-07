// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'system-registry-config-durations-unit-in-key',
  surface: 'the three package-registry durations whose name carried no unit: '
    + 'RegistryUpstream.syncInterval, RegistryUpstream.timeout and RegistryConfig.cache.ttl '
    + '(system/registry-config.zod.ts)',
  replacement: 'syncIntervalSeconds, timeoutMs and cache.ttlSeconds — rename each key; every '
    + 'value, the 30000 timeout default and the 3600 TTL default are unchanged',
  reason:
    'Maintainer ruling B on #14478 (2026-09-02, decision batch #43): the unit of a duration-shaped z.number() lives in the key NAME or in a unit-carrying value, never only in the describe prose, and no existing offender is grandfathered. '
    + 'The three are one entry because they are one file and, for the first two, one object: '
    + 'RegistryUpstream declared a SECONDS interval and a MILLISECONDS timeout twenty-five '
    + 'lines apart, both bare. That pair carries the clearest demonstration in this card of '
    + 'why a bound is no substitute for a name — timeout is min(1000), which reads as one '
    + 'second under the right unit and as sixteen minutes under the wrong one, and both '
    + 'readings satisfy the validator. The cache TTL is the same defect one schema over, '
    + 'beside a maxSize measured in bytes. All three are retiredKey() tombstones; the shapes '
    + 'are not strict, so a bare deletion would strip in silence. Why a semantic entry and '
    + 'not a D2 conversion: stack.zod.ts declares no registry collection, and a registry '
    + 'config is host configuration read at startup rather than a stored sys_metadata row, so '
    + 'the conversion chain has no seam that would see it. #15679, #14478, ADR-0087.',
  acceptanceCriteria:
    'Every upstream declaration spells syncIntervalSeconds and timeoutMs, and every registry '
    + 'cache block spells ttlSeconds. Authoring any old spelling fails to compile (input type '
    + '`never`) and fails to parse with the rename prescription. Behaviour is unchanged: '
    + 'syncIntervalSeconds: 300 syncs every five minutes exactly as syncInterval: 300 did, an '
    + 'omitted timeoutMs still defaults to 30000, an omitted ttlSeconds still defaults to '
    + '3600, and the min-60 / min-1000 / min-0 bounds ride along with the renamed keys so a '
    + 'too-small interval or timeout is still refused. The pair on RegistryUpstream is the '
    + 'one to check by hand rather than by search-and-replace: after the migration a reader '
    + 'can tell at the authoring site that 300 and 30000 are not the same kind of number.',
};
