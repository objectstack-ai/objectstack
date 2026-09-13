---
'@objectstack/spec': patch
---

fix(devx): the json-schema tree's freshness rule can be answered — a generation stamp acquits a tree whose sources were re-checked-out unchanged (#16175)

`scripts/check-regen-pending.mjs` exports three freshness predicates over the
same `newestMtime(artifact) < newestMtime(src)` comparison, and all three share
one blind spot: `git merge`, `git checkout` and `git worktree add` re-check-out a
source file with **identical bytes** and bump its mtime, the build that follows
correctly does not run (turbo's cache hashes content), and the rule then refuses
an artifact that is exactly current.

Two of them were answered already — `distIsStale` by `dist/.build-input-hash-dts`
(#14985/#16176) and `bundlesAreStale` by `dist/.build-input-hash` (#16240).
`schemaTreeIsStale` was the third, and the one with **no evidence of any kind to
read**: nothing recorded which sources `packages/spec/json-schema/` came from.
Measured on a checkout whose `git status` was empty, after a bare
`touch packages/spec/src/data/query.zod.ts`:

```
pnpm --filter @objectstack/spec check:docs    exit 1
  packages/spec/json-schema is older than packages/spec/src.
```

The only remedy on offer was a full `gen:schema` — minutes under a shared verify
lock — for a tree that needed nothing. The same command now exits 0 with no
rebuild, and a genuine source edit still refuses.

**The evidence is new, because neither `dist/` stamp could stand in.** Both are
written at the END of the build, whereas `gen:schema` is its FIRST step and is
also run standalone and again by `check:authorable-surface` — so a `dist/` stamp
is evidence about `dist/`, and in the standalone case there would be none at all.
`build-schemas.ts` now writes `json-schema/.build-input-hash-schema` as the last
thing it does: one write point, after the unconditional whole-tree regeneration
that precedes its `--check` / `--update-base` fork, so all three entry points are
covered, and after every ratchet that can exit 1, so a refused run vouches for
nothing.

**⛔ The digest may only ACQUIT, never accuse.** A missing, unreadable or
non-64-hex stamp is `unstamped` — no evidence — and leaves the mtime refusal
exactly where it stood (#4690). Nothing that passes today can start failing, and
the rule keeps its only conviction instrument: mtimes still see the hand-edited
tree and the toolchain change a content digest is blind to.

**Why this ships, and why it is a changeset rather than `skip-changeset`.**
`json-schema` is in `@objectstack/spec`'s published `files[]`, so the new stamp
travels in the tarball — measured with `npm pack --dry-run`:
`json-schema/.build-input-hash-schema` is present alongside the two existing
`dist/` stamps. One 65-byte file is added to the published package. No export, no
schema key, no runtime behaviour and no authorable surface moves.

**One other published-adjacent change**, for the same soundness reason: the build
digest (`scripts/build-input-hash.mjs`) now also hashes `<pkg>/scripts/**` for
packages that have it. `packages/spec`'s generators live there and were in none of
the previous input sets, so an edited generator kept a digest that had not moved —
and a stamp written by the OLD generator would then acquit a tree the new one
emits differently. Widening a digest can only ever WITHHOLD an acquittal, never
grant one, so the two `dist/` stamps become strictly more honest as well; the
first build after this lands re-stamps all three.
