// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The upgrade-guide entry of the two unkeyed seed modes, `insert` and
// `replace`, retired from `SeedSchema.mode` (ADR-0049 enforce-or-remove;
// maintainer ruling on #34613, option B). No D2 conversion: which field names
// a seed row is the author's to declare, and a rewrite to a keyed mode would
// guess it.
export const entry: SemanticMigration = {
  id: 'seed-mode-insert-replace-retired',
  surface:
    'data.Seed.mode (a seed dataset in `defineStack({ data })`, `defineSeed`, a `seed` metadata item, or a package '
    + 'body\'s seed): the values `insert` and `replace`',
  replacement:
    'Keep the default `mode: \'ignore\'` (or declare `\'upsert\'` for reference data the package keeps current) and '
    + 'set `externalId` to the field that names a row, to a list of fields when no single field does (a junction '
    + 'table\'s `[\'team\', \'project\']`), or to `\'id\'` when the records carry their own ids',
  reason:
    'A seed is replayed, not applied once: on every single-tenant boot, every package install or upgrade, every '
    + 'publish. `insert` matched no existing row, so every replay inserted each record again, and `replace` did the '
    + 'same while promising a table the caller cleared, which no load path ever clears. Measured on an un-walled '
    + 'install over three boots: 1, then 2, then 3 rows; a person reference the first load had to leave NULL stayed '
    + 'NULL on the first row while only the newest copy named the person; with a unique field the replay insert was '
    + 'refused and the one row stayed NULL. Both values are now refused where a seed is parsed, with the '
    + 'prescription. A dataset already stored with either value (a compiled artifact, an installed package body, a '
    + 'stored seed item) is refused loudly by the seed load itself (the boot seed, the per-organization replay, the '
    + 'dev hot reload, a package install or upgrade; the artifact door parses the rest of an artifact without it, so '
    + 'the environment still boots): that dataset writes nothing, the load result fails with its prescription and '
    + 'the boot log names it, and every other dataset loads. There is no '
    + 'mechanical rewrite, because a keyed mode needs the field that identifies a row, and only the author knows it. '
    + 'Rows earlier replays duplicated are data, not metadata, and are left as they are',
  acceptanceCriteria:
    'os validate reports no seed dataset whose `mode` is `insert` or `replace`; every dataset that declared one '
    + 'declares `ignore` or `upsert` with an `externalId` naming fields its object has; after two restarts over the '
    + 'same database the seeded object holds one row per record, and the boot log carries no seed-mode refusal.',
};
