---
"@objectstack/spec": patch
---

fix(spec): `--update-base` re-anchors forward or refuses — never backwards, never mid-merge (#5370)

#5358 made re-anchoring `packages/spec/authorable-surface.base.json` an explicit act
(`gen:authorable-surface-base`). It settled **when** the anchor may be written, not **where
from**: the baseline is still `merge-base(HEAD, origin/main)`, and that is not always ahead
of the anchor already committed.

The reported way in is a stopped merge. Until the merge is committed, `HEAD` is the branch
tip from *before* it, so the merge base is the branch's **old fork point** rather than the
main tip being merged in, and re-anchoring there rolls `baseRev` backwards. Measured on the
#5312 sync relay: `1c3da1f` → `5aae790`, returning the 109 keys #5321 had just retired.

Nothing could catch it. The older rev is a genuine `origin/main` ancestor and the keys
written are that commit's surface verbatim, so the regressed file is **authentic** —
`verifyCommittedSurfaceBase`, `check:authorable-surface` and the pre-commit `os-regen` guard
are green before and after. The only trace is a reverse `baseRev` move in the diff, which
reads like the #4650 attack shape and was written by the generator itself.

Two refusals, both in `--update-base` only:

- **Mid-merge**: `MERGE_HEAD` present (resolved via `git rev-parse --git-path`, so linked
  worktrees are handled) refuses before a single schema is generated, the way
  `--check --update-base` already did, and prescribes the remedy — commit the merge, then
  re-anchor. `scripts/regen-artifacts.mjs` states the same rule for the merge driver's side
  ("Re-anchor after the merge is committed, or not at all"); this enforces it for the human
  who types the command anyway.
- **Monotonicity**: the write happens only when the committed `baseRev` is an ancestor of
  the newly resolved rev. Equal keys still take the existing "nothing to re-anchor" path.

Ancestry that cannot be established refuses too, rather than defaulting to either verdict:
`merge-base --is-ancestor` is read as three answers (`0` / `1` / anything else with a
`fatal:`), and a `1` from a **shallow** checkout is discarded as unusable — truncation makes
git report "not an ancestor" about commits that plainly are one. A `0` is trusted
everywhere, shallow included, because a truncated walk can only lose reachability, never
invent it.

`gen:schema` and every build are untouched: since #5358 they do not write this file at all,
so a build during a merge behaves exactly as before.
