# Sharded spec artifacts — why three ratchets are directories

**Landed**: 2026-08-06 (#5837, maintainer ruling of the same day)
**Code**: `packages/spec/scripts/lib/sharded-artifacts.ts` — the layout, the writers, the
integrity checks and the historical-baseline reader all live in one file.

## The problem this solves, stated precisely

`merge=os-regen` (#4675) hands generator-owned artifacts to a custom git merge driver
instead of a three-way text merge. It works, and it is not enough: **the GitHub merge
queue rebuilds each PR server-side, and a custom merge driver does not run there.**

So for the three artifacts every `packages/spec` PR rewrites —
`authorable-surface.json` (310KB, ~7900 sorted lines), `json-schema.manifest.json` and
`api-surface.json` — two PRs in flight were a plain textual conflict *in the queue*, and
the second was evicted. The spec lane could only land one PR at a time; the measured
ceiling was ~12 merges/day. The driver's own comment records the shape of the tax: one
afternoon, 4 merges, 9 conflicts, **zero** real semantic conflicts — every one a set
union.

The cost was being paid for the FILE SHAPE, not for disagreement.

## The layout

The content was always grouped: every ratcheted key is `"<category>/<Def>"` or
`"<category>/<Def>:<prop>"`, and every api-surface row belongs to one published entry
point. Splitting on that grouping makes two PRs in different categories touch **disjoint
files**, so the server-side merge has nothing to conflict on.

| was | is | shard key |
|:---|:---|:---|
| `packages/spec/authorable-surface.json` | `packages/spec/authorable-surface/<category>.json` | def-key category (`ai`, `data`, `ui`, …) |
| `packages/spec/json-schema.manifest.json` | `packages/spec/json-schema.manifest/<category>.json` | same |
| `packages/spec/api-surface.json` | `packages/spec/api-surface/<entry>.json` | published entry point (`.` → `root.json`) |

Same pattern this repo already validated twice: `.changeset/*.md` (one file per PR, never
conflicts) and #5107 (the strictness ledger's numbers split out of its prose, because the
arithmetic composes on a merge and the judgement does not).

### Deliberately still single files

- **`spec-changes.json`** — keyed by version, so two PRs append under different majors.
  Never a conflict surface worth splitting.
- **`api-surface-signatures.json`** — 1.3KB, one line per `defineX` factory.
- **`authorable-surface.base.json`** — the #5235 deletion-gate anchor. Nothing but an
  explicit `gen:authorable-surface-base` writes it (#5358), so it was never on the churn
  path that made the other three the queue's serialization point. It also carries **one**
  `baseRev` for the whole surface, and a per-shard copy would let different shards mirror
  different revisions — a state no upstream commit ever had. It stays aggregate, and the
  comparison it feeds reads the baseline commit's shards and aggregates them. The
  authenticity criterion is untouched in both halves: `baseRev` is an `origin/main`
  ancestor, and its keys **are** that commit's surface.

## The invariant that makes sharding semantics-preserving

> **Every gate reads the whole DIRECTORY as one set — never "the shards this build would
> write".**

That is what keeps the ratchets exactly as strict as they were:

- deleting a whole shard file deletes its keys, and checks (a)/(c) see the same missing
  keys they saw when the same edit deleted lines from one big file;
- a shard nobody regenerates is reported **stale**, not skipped;
- the byte-for-byte canonical-form comparison (#4662) is now per shard, so a hand-edit is
  caught *and named* down to the file.

Two integrity checks exist only because sharding made them possible to violate, and both
are fatal: a shard's `category`/`entry` field must match its filename, and every entry in
it must belong to that category. Without them a shard could answer for another category's
key, and the writer — which routes by category — would drop it on the next run as a
deletion nobody made.

The #5976 def-key collision guard is untouched: it keys on the **stripped schema name**
(`shared/HttpMethod`), which is what selects a def key, never on the shard file that key
later lands in. It still runs before both ratchets.

## Adding or removing a category

Nothing to configure. `gen:schema` routes by the def key's category segment and
`writeShards` prunes any shard the run did not produce, so a new namespace creates its
shard and an emptied one is removed. A *removed* category still has to answer to the
deletion gates — the pruning happens after they have adjudicated the run.

## The one read of the retired layout

`readShardedKeysAtRev` (in `sharded-artifacts.ts`) reads the single-file layout when the
revision it is given predates this change. That is **not** a lenient consumer fallback:

- the revision is an already-merged upstream commit, immutable, with no producer left to
  fix;
- the working tree's own surface is read by `aggregateCategoryShards`, which knows the
  sharded layout and nothing else.

Same shape as `release-spec-changes.sh` unpacking whichever snapshot a previously
published tarball carried. The branch announces itself (`ℹ️ … predates the split`) and
retires by itself once no branch in flight forks from before the migration commit.

## Proving it, mechanically

The acceptance criterion is about the merge queue, which no single PR can stage. Its
mechanical equivalent is about files, and that is pinned in
`packages/spec/scripts/sharded-artifacts.test.ts`:

- **locality** — two key sets differing only inside category X serialize to shard sets
  differing only in `X.json`; every other shard byte-identical, and the two "PRs" touch
  disjoint files;
- **idempotency** — the same key set writes the same bytes, and an unchanged shard is not
  rewritten at all (`written` is empty), so "only X changed" is true of the diff and not
  merely of the content.

Measured end-to-end on the landing PR: adding one key to one `ui` schema and running
`gen:schema` rewrote **1 of 14** authorable shards and **0 of 14** manifest shards. On
`main` the same edit rewrote a 310KB file that every other spec PR also rewrote.
