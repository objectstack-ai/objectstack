// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #14478 (maintainer ruling B: a duration key carries its unit in its NAME) —
// the D3 entry of the `hook-timeout-to-timeout-ms` family (ruling B on #17152:
// one D3 entry per retirement family, even when D2 is lossless). The rename
// keeps the number, which is exactly the part the ruling was about: whether
// that number was ever in milliseconds is the author's to say.
export const entry: SemanticMigration = {
  id: 'hook-timeout-unit-in-key',
  surface: 'hook.timeout — the per-invocation time limit of a data hook',
  replacement: '`timeoutMs` — the same limit, in milliseconds, with the unit in the key name.',
  reason: 'The D2 conversion `hook-timeout-to-timeout-ms` renames `timeout` to `timeoutMs` in author '
    + 'sources and on stored hook rows, keeping the value, and the rename is lossless: the key '
    + 'always meant milliseconds, and the conversion leaves an already-canonical `timeoutMs` alone '
    + 'and refuses a pair that disagrees. The judgment is the one the rename exists for. The unit '
    + 'used to live only in the key\'s description, beside body-level keys that spelled theirs, so '
    + 'an author who wrote a seconds value — `timeout: 30` meaning thirty seconds — got a limit of '
    + 'thirty milliseconds and no error, and the rename carries that 30 over unchanged. Only the '
    + 'author knows which unit they meant, so each value needs reading once. A pair left '
    + 'unconverted because the two spellings disagree needs the author to choose, and code that '
    + 'builds or reads a hook definition in TypeScript is outside the chain\'s reach.',
  acceptanceCriteria: 'No hook carries `timeout`; the parse refuses it with the rename. Every '
    + '`timeoutMs` value is the limit the author intends expressed in milliseconds — a hook meant '
    + 'to be allowed thirty seconds reads `timeoutMs: 30000`. A hook that runs longer than its '
    + '`timeoutMs` fails with a timeout at that limit, and one that finishes inside it completes as '
    + 'it did before the upgrade. No code reads or writes `timeout` on a hook definition.',
  relevantWhen: { kind: 'stack-declares', keys: ['hooks'] },
};
