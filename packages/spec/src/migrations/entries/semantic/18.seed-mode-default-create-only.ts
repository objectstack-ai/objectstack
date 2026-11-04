// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The declared default of `SeedSchema.mode` moved from `upsert` to `ignore`
// (maintainer ruling 6631016988 on objectstack#30081, option A), and
// `SeedLoaderConfig.defaultMode` became that same field. The ruling asked for
// a production measurement first: on `os start`, `os serve`, a boot-artifact
// upgrade and an `os package install` upgrade, a customer's API edit to a
// seeded row went back to the shipped value on the next replay, with no
// signal (card comment 6633189577). Same class as
// `ui-nav-group-expanded-default-open`: no key is added or removed, so there
// is no tombstone, no RETIRED_KEYS_BY_MAJOR row and no D2 conversion. The
// contract look on the card (6633227800) ruled out a conversion that guesses:
// a compiled artifact's written `mode: "upsert"` cannot be told from an
// authored one. The citations live here, not in the printed guidance, which
// carries no tracker number.
export const entry: SemanticMigration = {
  id: 'seed-mode-default-create-only',
  surface: 'data.Seed.mode — an OMITTED mode on a seed dataset (and SeedLoaderConfig.defaultMode, which is that same default)',
  replacement: 'nothing, to take the platform default: a replay inserts the rows a dataset is missing and '
    + 'leaves every existing row as the customer left it. To keep refreshing a dataset on every replay — '
    + 'reference data the package keeps current — write it: `mode: \'upsert\'`, and exempt the columns '
    + 'the customer or a job owns with `columns: { FIELD: { applyOn: \'create\' } }`',
  reason:
    'A RULED behaviour change on a default, so there is nothing to rewrite and nothing to refuse: a '
    + 'seed is create-only by default. A seed is replayed on every single-tenant boot, on every package '
    + 'install or upgrade and on every publish of a `seed` item, and with the old `upsert` default each '
    + 'replay wrote the shipped value back over a customer\'s edit to a seeded row, in production too, '
    + 'silently. The default is now `ignore`: a missing row is inserted and an existing row is left as '
    + 'it is, so a changed seed value reaches only a row the load creates. Not losslessly convertible, '
    + 'because the question is intent, not text: only the author knows whether a silent dataset is '
    + 'starter data the customer now owns or reference data the package must keep current, and a '
    + 'mechanical pass that wrote `mode: \'upsert\'` onto every silent dataset would restore the '
    + 'overwrite the ruling removed. A package built before this change carries a written '
    + '`mode: "upsert"` in its compiled artifact (`os build` stores the parsed seed); the loader cannot '
    + 'tell that value from an authored one, so such a package keeps replaying with upsert until it is '
    + 'rebuilt, and nothing converts it. The accept set is unchanged — the same five modes — and every '
    + 'authored `mode` parses exactly as before.',
  acceptanceCriteria:
    'A seed dataset that omits `mode` parses to `mode: \'ignore\'`, and `SeedLoaderConfig.defaultMode` '
    + 'parses to `ignore`. Loaded twice with a customer edit in between, such a dataset keeps the edit, '
    + 'inserts a record whose row is missing, and leaves an untouched row\'s `updated_at` as it was. A '
    + 'dataset that declares `mode: \'upsert\'` still writes its declared columns back onto the matched '
    + 'row on every replay. Every dataset that must stay current on replay declares `mode: \'upsert\'`, '
    + 'and every package is rebuilt so its compiled artifact carries the mode its source declares.',
};
