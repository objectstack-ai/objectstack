---
"@objectstack/spec": patch
---

fix(spec): re-anchoring `authorable-surface.base.json` is an explicit act, not a build side effect (#5358)

`packages/spec/authorable-surface.base.json` is the in-tree anchor the #4650 deletion gate
falls back to where `origin/main` is out of reach (#5235). It is not a projection of this
package's source — it is a snapshot of an **upstream** commit, and it is the baseline
precisely because the commit under test cannot rewrite it.

Until now every `gen:schema` run rewrote it whenever it had drifted from the git-resolved
baseline. `gen:schema` is `pnpm build`'s first step, so this fired on any build of any
package that merely has `@objectstack/spec` in its dependency closure, and on `check:docs`
(whose first step is `gen:schema`). Three developers hit it independently, from three
unrelated tasks:

- a plain `pnpm build`: `baseRev` advanced to HEAD, **−110 keys**;
- `pnpm --filter "@objectstack/cli^..." build`: the same 110;
- `pnpm --filter "@objectstack/service-automation^..." build`: `baseRev` advanced, +3 keys.

The 110 were the `ui/ComponentAnimation` family that had just been retired. An anchor
advanced past a retirement cannot see that retirement any more — and the gate is green
before *and* after, because both states are internally consistent. All three were caught
only by reading `git status` line by line before committing; a `git add -A` would have
carried the moved baseline into a PR about something else.

The anchor now moves only in a mode of its own:

```bash
pnpm --filter @objectstack/spec gen:authorable-surface-base   # build-schemas.ts --update-base
```

- `gen:schema` and any build: never write it. A lagging anchor prints one ℹ️ line saying so,
  naming this command — lag was already not an error (on `main` the merge base is HEAD, so
  the file necessarily trails its own surface by one PR).
- `check:authorable-surface`: unchanged, still strictly read-only, and still fatal when the
  committed anchor is missing, malformed, or inauthentic.
- `--check --update-base` is refused: a check that repairs what it detects can never report it.

Nothing about anchor **authenticity** changes: `baseRev` must still be an ancestor of
`origin/main` with keys matching that commit's `authorable-surface.json`, the anchor is
still written only from a git-resolved baseline (never from the build being checked), and
the write still happens after the deletion gate has adjudicated the run, so the explicit
mode cannot walk the baseline past an unproven deletion either.
