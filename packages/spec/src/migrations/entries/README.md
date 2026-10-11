# Migration registry entries

One TypeScript file per entry of `../registry.ts`'s three append tables (#7297, the
registry half of #6957's ruling). `pnpm --filter @objectstack/spec gen:migration-registry`
writes `../registry.ts` whole: the hand-written skeleton `../registry.ts.template` with
these files concatenated into its marked regions, sorted by entry id. It runs on
`pnpm install`, as the first step of `build`, and before `typecheck` and `test`, and
`registry.ts` is git-ignored (#22554), so there is no committed copy to keep in step.

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

## Four rules that are not style

- **Touch no other file for the entry, and never edit `registry.ts`.** It is output,
  generated whole and git-ignored: a hand edit there is never committed, and the next
  `gen:` run overwrites it. Prose outside the tables (a step's `rationale`) lives in
  `../registry.ts.template`.
- **There is no index, deliberately.** An index is itself a single append-only file
  every card must edit, which is the exact conflict this directory removes (PM decision
  on #6957). The directory listing is the index, and order is derived from the id.
- **The filename is derived from the id, and the generator enforces it.** That is what
  makes two cards registering *different* entries merge clean while two cards editing
  the *same* entry collide in git — on a registry where a dropped entry produces no
  error anywhere, a layout in which the second case merges quietly is a layout that
  loses one of the two edits.
- **Entry prose is scanned as source, twice over — ⛔ never spell a shape a live
  textual ratchet matches.** Every string an entry declares is concatenated verbatim
  into `registry.ts`, which is ordinary `.ts`, so a repo-wide scan reads the same
  sentence once here and once there. This tree's one code/prose separator masks
  **comments** and leaves **string literals** intact on purpose, so to every scan built
  on it a quoted example is code — which is how prose in `packages/spec` turns
  **another package's** test red. Measured while landing commit db16b9424: the new entry named four retired
  call sites in their call spelling — the method with its opening parenthesis —
  `packages/client/src/envelope-caller-census.test.ts` counted 46 against the 28 it
  pins (nine mentions, each counted twice) and `Test Core` went red; respelling them
  without the parenthesis restored 28 and changed nothing the entry meant. Name the
  surface, ⛔ don't spell a call of it.

  ⚠️ The parenthesis is the instance, not the rule. An older entry that does spell a
  call is not thereby wrong — it goes unmatched only because no live ratchet
  enumerates *that* method, which is a fact about today's ratchets and not a licence;
  the pattern that catches you is whichever one exists when your entry lands.

## What this does not fix

Not the template's prose. A step-18 retirement still adds its `STEP18_RATIONALE`
fragment to `../registry.ts.template`, which is hand-written and merges as text; the
fragments are kept sorted by key so two retirements insert at different lines (#20535).
The `registry.ts` lap is gone (#22554): the file is generated at install and build and
never committed, so an entry's pull request regenerates nothing for it.
`spec-changes.json` and the protocol upgrade guide are projections of this registry, but
neither is committed any more (#22449 B′: the guide's copy left git at #22483,
`spec-changes.json`'s at #22485). The publish lane generates both into the package
before the tarball is packed, and the pull request generates both in memory
(`check:spec-changes`, `check:upgrade-guide`) and renders their diff for the reviewer.
⛔ Do not regenerate either for an entry: `gen:spec-changes` writes only the gitignored
`packages/spec/spec-changes.json`, `gen:upgrade-guide` writes only the gitignored docs
pages, and `docs/protocol-upgrade-guide.md` is a hand-written pointer stub that nothing
generates. A retirement card is not faster for this file, only harder to lose.

### What the merge queue did with those projections — measured (#8344), while they were committed

History, kept for its `registry.ts` conclusion. This section measured the two
projections while they were committed and routed `merge=os-regen`; since #22485
they are neither, so there is nothing of theirs left to merge. Since #22554 the residue
paragraph's `registry.ts` conflict is history too: the registry is no longer committed,
so an adjacent-id pair of entries no longer meets anywhere.

`.gitattributes` routes both through `merge=os-regen`, and that driver is a **local**
git facility: the GitHub merge queue rebuilds each PR server-side, where no custom
driver runs. #8344 asked what the queue therefore produces for them when two ADR-0087
registrations are in flight — stale-but-clean, a conflict, or something correct.

Measured 2026-08-13, on the real in-flight case that raised the question (#8325's
branch against a `main` already carrying #8324 and #8327) plus four synthetic pairs,
each merged in a clone with **no `merge.os-regen.driver` configured** — which is
exactly the queue's situation:

| two registrations in flight, distance in registry sort order | driver-less merge | the un-regenerated result |
| --- | --- | --- |
| the real case — #8324 + #8327 against #8325 | clean | **byte-identical** to the regeneration |
| ids far apart | clean | `check:spec-changes`, `check:upgrade-guide`, `check:migration-registry` all pass |
| exactly one existing entry between them | clean | all three gates pass |
| **adjacent — nothing between them** | **conflict** | — (the PR is ejected) |
| **both the first entry of a new major** | **conflict** | — (the PR is ejected) |

So the answer is **no, never stale-but-clean**. Both files are sorted unions and a
registration is insertion-only, so the queue's text merge either takes both sides —
which *is* the regeneration, byte for byte — or refuses. There is no third outcome,
and the `--check` gates are what prove the clean rows current rather than merely
conflict-free.

The residue is that conflict, and **sharding those two files would not buy back a
single ejection**: every conflicting case above also conflicts in `registry.ts`, which
is generated, committed, unsharded and deliberately outside the driver
(`NOT_DRIVER_MANAGED` in `scripts/regen-artifacts.mjs`) — and which every registration
touches by construction. Sharding this directory removed the collision at the
**source**; it does not reach the generated file the sources are concatenated into.

⚠️ Locally the driver hides two thirds of that signal: the adjacent-id merge reports
three conflicts server-side and one — `registry.ts` — in a clone with the driver
registered, because the driver defers the two projections. The one it leaves standing
is enough to see the collision coming, which is what makes this a narrow hazard rather
than a silent one.

Reproduce any row with a driver-less clone and git's own server-side merge:

```
git clone -q --bare --shared . /tmp/driverless.git   # a fresh clone has no merge.os-regen.driver
git --git-dir=/tmp/driverless.git fetch -q . BRANCH_A:refs/b BRANCH_B:refs/h
git --git-dir=/tmp/driverless.git merge-tree --write-tree --messages refs/b refs/h
rm -rf /tmp/driverless.git
```

Exit 1 with no tree id is a missing object, never a conflict; a real conflict prints the tree id first.
The fetch runs in your checkout (`.`), so `BRANCH_A`/`BRANCH_B` may be names or ids. Recipe and why:
`scripts/pm/os-regen-merge.sh`.
