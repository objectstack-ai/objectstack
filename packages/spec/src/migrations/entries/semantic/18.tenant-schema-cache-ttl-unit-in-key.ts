// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'tenant-schema-cache-ttl-unit-in-key',
  surface: 'SchemaLevelIsolationStrategy `performance.schemaCacheTTL` (system/tenant.zod.ts)',
  replacement: '`performance.schemaCacheTtlSeconds` (default 3600) — rename the key; the value '
    + '(seconds) is unchanged',
  reason:
    'Maintainer ruling A, 2026-09-11: the gate that reads a duration key\'s JSDoc lands last, '
    + 'after its offenders are fixed file by file — so this entry executes, per file, the rule '
    + 'that a duration number key carries its unit in '
    + 'its name. The key carried its unit (seconds) in a '
    + 'source JSDoc only — "Schema cache TTL in seconds" — while `.describe()`, the text '
    + '`content/docs/references/**` publishes, said "Schema cache TTL" and named no unit at all. '
    + 'So the reader who most needs the unit, the reader of the published reference page, was the '
    + 'only reader who never saw it: 3600 is a plausible number of seconds and a plausible number '
    + 'of milliseconds, and nothing on the page decided '
    + 'it. Under that rule\'s gate, moving the unit '
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
    + 'objectui checkout — `.objectui-sha` = `9dfaca654311cddd81714153c4f82c241d7cdc54` — spells it 0 '
    + 'times across 7632 tracked files, against lit controls `TTL` 182 and `tenant` 1318 on the '
    + 'same corpus (0 across 7579, against 182 and 1317, at 2e818d0b5; 0 across 10267, against 180 and 1238, at ab1879721; 0 across 10071, against 181 and 1237, at 89cad75d5; 0 across 9912, against 181 and 1237, at 31971ff1e; 0 across 9800, against 181 and 1235, at e420df310; 0 across 9546, against 181 and 1200, at db11afd49; 0 across 9283, against 181 and 1185, at dd3f7e1be; 0 across 8512, against 156 and 1034, at f8a9d0fb0; 0 across 8303, against 156 '
    + 'and 987, at 62597c588).',
  acceptanceCriteria:
    'Every schema-level tenant isolation source spells `performance.schemaCacheTtlSeconds`; '
    + 'authoring `performance.schemaCacheTTL` fails to compile and fails to parse with the rename '
    + 'prescription naming the suffixed key; the parsed default is 3600 as before, and the '
    + 'published describe reads "Schema cache TTL in seconds".',
};
