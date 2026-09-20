// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'logging-durations-unit-in-key',
  surface: 'HttpDestinationConfig `batch.flushInterval` / `retry.initialDelay` / `timeout` and '
    + 'LoggingConfig `buffer.flushInterval` (system/logging.zod.ts)',
  replacement: '`batch.flushIntervalMs` (default 5000) / `retry.initialDelayMs` (default 1000) / '
    + '`timeoutMs` (default 30000) on HttpDestinationConfig, and `buffer.flushIntervalMs` '
    + '(default 1000) on LoggingConfig — rename the keys; every value (milliseconds) is unchanged',
  reason:
    'Director-seat ruling A on #15939, 2026-09-11, carrying the maintainer\'s 「同意」 (decision '
    + 'batch #115), executing the #14478 rule per file. All four keys named milliseconds in a '
    + 'source JSDoc — "Flush interval in milliseconds", "Initial retry delay in milliseconds", '
    + '"Timeout in milliseconds" — and the JSDoc above a key is not what '
    + '`content/docs/references/**` renders; `.describe()` is, and none of the four carried one at '
    + 'all. Measured by the `check:duration-unit-keys` census on this tree before the change, all '
    + 'four read `[name: -] [prose: -]`: no unit in the key and no published prose to supply it, '
    + 'so `content/docs/references/system/logging.mdx` printed a bare 5000 / 1000 / 30000 / 1000 '
    + 'and nothing on the page decided milliseconds from seconds. Under the #14478 gate, moving '
    + 'the unit into the describe alone is itself a violation (unit in prose, none in the name), '
    + 'so each key is renamed and given the describe it never had in the same stroke. '
    + '⚠️ `flushInterval` was declared TWICE on this file, in two different defs and with two '
    + 'different defaults — 5000 on the HTTP destination\'s batch and 1000 on the logging buffer '
    + '— so they are two keys, each with its own tombstone and its own registered row; the '
    + 'prescriptions name their def so a reader who lands on one is not sent to the other. The '
    + '`Ms` suffix is the family\'s own spelling, counted in key position on this tree: 272 '
    + '`*Ms:` declarations in `packages/spec/src` against 75 `*Seconds:`, and the only competing '
    + 'unit spellings are 3 `*MS:` and 9 `*Millis:` — every one of them a name fixed outside this '
    + 'repo (MongoDB\'s `maxCommitTimeMS` and `connectTimeoutMS`, node-postgres\'s '
    + '`idleTimeoutMillis` and `connectionTimeoutMillis` on `PoolConfigSchema`), so unlike the '
    + '`Ttl`-versus-`TTL` question a sibling round settled there is no in-repo alternative to '
    + 'choose between. All three target spellings were already attested as key-position `*.zod.ts` '
    + 'declarations before this change: `flushIntervalMs` 1 (`kernel/events/integrations.zod.ts`, '
    + 'same 1000 default), `initialDelayMs` 5, `timeoutMs` 30. Tombstoned with `retiredKey()` '
    + 'rather than deleted because none of the four enclosing objects — `HttpDestinationConfig` '
    + 'itself and its nested `batch` and `retry`, and `LoggingConfig`\'s nested `buffer` — is '
    + '`.strict()`, so a bare deletion would have stripped the value in silence. Why a semantic '
    + 'entry and not a D2 conversion: `stack.zod.ts` declares no logging collection and neither '
    + '`LoggingConfigSchema` nor `HttpDestinationConfigSchema` is referenced anywhere in '
    + '`packages/spec/src` outside `system/logging.zod.ts`, so the chain has no rehydration seam '
    + 'that runs on an authored logging document — the same reading '
    + '`tenant-schema-cache-ttl-unit-in-key` recorded for its sibling key. Measured on 4dab2bc5c: '
    + 'no in-repo runtime reads any of the four — outside `packages/spec/src/system/logging.zod.ts` '
    + 'and its test the only occurrences are the generated rows in '
    + '`content/docs/references/system/logging.mdx`, which this rename regenerates; and the pinned '
    + 'objectui checkout — `.objectui-sha` = `87af769e9a3ee28ace099fdd653d3ebd79fe82e2` — spells '
    + '`flushInterval` 0 times, `initialDelay` 0, `HttpDestinationConfig` 0 and `LoggingConfig` 0 '
    + 'across its 8228 tracked files, against lit controls `useState` 2383 and `timeout` 1075 on '
    + 'the same corpus.',
  acceptanceCriteria:
    'Every HTTP log destination spells `batch.flushIntervalMs`, `retry.initialDelayMs` and '
    + '`timeoutMs`, and every logging buffer spells `buffer.flushIntervalMs`; authoring any of the '
    + 'four retired spellings fails to compile and fails to parse with a rename prescription '
    + 'naming the suffixed key and its def; the parsed defaults are 5000 / 1000 / 30000 / 1000 as '
    + 'before; and each published describe names milliseconds.',
};
