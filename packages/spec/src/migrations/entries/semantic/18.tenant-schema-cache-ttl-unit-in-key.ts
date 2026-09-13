// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'tenant-schema-cache-ttl-unit-in-key',
  surface: 'SchemaLevelIsolationStrategy `performance.schemaCacheTTL` (system/tenant.zod.ts)',
  replacement: '`performance.schemaCacheTtlSeconds` (default 3600) — rename the key; the value '
    + '(seconds) is unchanged',
  reason:
    'Director-seat ruling A on #15939, 2026-09-11, carrying the maintainer\'s 「同意」 (decision '
    + 'batch #115), executing the #14478 rule per file. The key carried its unit (seconds) in a '
    + 'source JSDoc only — "Schema cache TTL in seconds" — while `.describe()`, the text '
    + '`content/docs/references/**` publishes, said "Schema cache TTL" and named no unit at all. '
    + 'So the reader who most needs the unit, the reader of the published reference page, was the '
    + 'only reader who never saw it: 3600 is a plausible number of seconds and a plausible number '
    + 'of milliseconds, and nothing on the page decided it. Under the #14478 gate, moving the unit '
    + 'into the describe alone is itself a violation (unit in prose, none in the name), so the key '
    + 'is renamed and the describe is corrected in the same stroke. Spelled `Ttl` and not `TTL`: '
    + 'counted on this tree, the suffixed family already spells it that way in every member '
    + '(`cacheTtlSeconds` 11, `ttlSeconds` 3, `defaultCacheTtlSeconds` 1) and no key-position '
    + '`TtlSeconds` variant spells it otherwise. Tombstoned with `retiredKey()` because the nested '
    + '`performance` object is not strict, so a bare deletion would silently strip the key. Why a '
    + 'semantic entry and not a D2 conversion: `stack.zod.ts` declares no tenancy collection and a '
    + 'tenant isolation strategy is not a stored metadata row (it describes cloud tenancy '
    + 'configuration), so the chain has no seam that runs on it — the same reading '
    + '`tenant-timeouts-unit-in-key` recorded for the two sibling keys on this file. Measured on '
    + 'bd25e897dc: no in-repo runtime reads the key — outside `packages/spec/src/system/tenant.zod.ts` '
    + 'and its test the only occurrences are the four generated rows in '
    + '`content/docs/references/system/tenant.mdx`, which this rename regenerates; and the pinned '
    + 'objectui checkout (`.objectui-sha` 53ded82bf7a494f54e344e19099dbf00854b8694) spells it 0 '
    + 'times across 6409 tracked files, against lit controls `TTL` 112 and `tenant` 819 on the '
    + 'same corpus.',
  acceptanceCriteria:
    'Every schema-level tenant isolation source spells `performance.schemaCacheTtlSeconds`; '
    + 'authoring `performance.schemaCacheTTL` fails to compile and fails to parse with the rename '
    + 'prescription naming the suffixed key; the parsed default is 3600 as before, and the '
    + 'published describe reads "Schema cache TTL in seconds".',
};
