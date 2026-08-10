# Migration registry entries

One TypeScript file per entry of `../registry.ts`'s three append tables (#7297, the
registry half of #6957's ruling). `pnpm --filter @objectstack/spec gen:migration-registry`
concatenates them into that file's marked regions, sorted by entry id;
`check:migration-registry` proves the regions still match this directory.

| directory        | table                                | id                                     |
| ---------------- | ------------------------------------ | -------------------------------------- |
| `semantic/`      | `MIGRATIONS_BY_MAJOR[N].semantic`    | the `SemanticMigration`'s `id`          |
| `retired-keys/`  | `RETIRED_KEYS_BY_MAJOR[N]`           | the tombstoned key, `${defKey}:${name}` |
| `retired-defs/`  | `RETIRED_DEFS_BY_MAJOR[N]`           | the unpublished def, `${category}/${SchemaName}` |

## Why this is a directory

It used to be three tables in one file, and every retirement card appended to the same
tail line of the same two of them. Measured on #6957 across 2026-08-06..10: `step17`'s
semantic list and `RETIRED_KEYS_BY_MAJOR[17]` conflicted in **6 of 11** contended
re-merge laps — 613 hand-resolved lines of conflict markers in four days.

Wall-clock was never the reason to fix it. **Both tables are consumed as sets**, so a
conflict resolution that drops a sibling's entry produces **no error anywhere**: the
tombstone the build gate was waiting for simply never arrives, and the D3 prescription
leaves the upgrade guide without a trace. Conflict-free by construction beats "resolve
carefully" precisely when careless is undetectable.

`.changeset/*.md` is the shape this copies, and `scripts/adr-anchors/` (#7301) is the
pilot that proved it on a smaller file.

## Adding an entry

Write **one new file**, named `<protocol major>.<id>.ts` with `/` and `:` replaced by
`__`, then run `pnpm --filter @objectstack/spec gen:migration-registry`:

```
17 + data/AggregationNode:distinct  →  retired-keys/17.data__AggregationNode__distinct.ts
```

```ts
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// Why this key was retired — the comment lands directly above the entry in the
// generated table, so write it for whoever reads that table.
export const entry = 'data/AggregationNode:distinct';
```

A `semantic/` entry is the same shape with a typed object literal:

```ts
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'aggregation-node-distinct-retired',
  surface: 'data.query.aggregations[].distinct',
  replacement: '…',
  reason: '…',
  acceptanceCriteria: '…',
};
```

The copyright header and the type import are file scaffolding and are **not** carried
into the registry; the run of `//` comments immediately above `export const entry` is.

## Three rules that are not style

- **Touch no other file, and never edit inside the markers.** `registry.ts`'s
  `<os-generated …>` regions are output. A hand edit there is reverted by the next
  `gen:` run and reported by `check:migration-registry` before that.
- **There is no index, deliberately.** An index is itself a single append-only file
  every card must edit, which is the exact conflict this directory removes (PM decision
  on #6957). The directory listing is the index, and order is derived from the id.
- **The filename is derived from the id, and the generator enforces it.** That is what
  makes two cards registering *different* entries merge clean while two cards editing
  the *same* entry collide in git — on a registry where a dropped entry produces no
  error anywhere, a layout in which the second case merges quietly is a layout that
  loses one of the two edits.

## What this does not fix

The regeneration lap. `spec-changes.json` and `docs/protocol-upgrade-guide.md` are
projections of this registry and still have to be regenerated and committed when an
entry lands. #6957's ruling kept them in version control on purpose — the review diff
is worth the laps it costs — so a retirement card is not faster, only harder to lose.
