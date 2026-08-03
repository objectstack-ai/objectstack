---
---

Tooling-only (#4731): the `@objectstack/console` changeset that `scripts/bump-objectui.sh`
writes on an objectui pin bump is now derived from what objectui **declared** — the
`.changeset/*.md` files added over the pinned range — instead of guessed from
conventional-commit types on the subject line. Releases nothing; no package changes.

The guess had three measured failure modes on one real range (`7d9734d5e321..785b8a5d432c`,
53 non-merge commits): `grep -iE '^- (feat|fix)'` dropped **all 13** releasing commits that
were not `feat`/`fix` — every breaking `refactor(...)!` among them, including
`refactor(layout)!: delete PageNodeRenderer` and the burn-ledger batches (objectui#3220 /
objectui#3224) — while pulling in **5** commits that release nothing at all (two of them
`fix(ci)`); `head -40` truncated the list in silence at 34/40 used; and the bump level came
from `grep -ciE '^feat'`, so a range of nothing but breaking refactors stamped `patch`.

`scripts/objectui-changeset-digest.mjs` now answers the question the script actually needs
answered — *does this commit ship in the frontend release?* — from objectui's own
declaration: a `.changeset/*.md` with package names releases, an empty frontmatter block is
changesets' own "release-nothing", and the declared `major`/`minor`/`patch` **is** the bump
(no `^feat` inference left anywhere). Nothing is capped by default; a cap that does fire
names the real remainder, the release-nothing changesets and changeset-less commits are
counted in the body rather than dropped in silence, and an unwalkable range (shallow clone,
initial pin) emits a list explicitly labelled degraded. Guarded by
`pnpm check:objectui-changeset` (`--self-test`, wired into `Lint & Type Check`).
