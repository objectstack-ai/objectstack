---
---

Tooling-only (#4843): `scripts/objectui-range.mjs` — the aggregation layer whose output is
pasted into a release page's **Console** section — now reports the frontend changes objectui
**declared** over the pinned range instead of guessing them from conventional-commit types.
Releases nothing; no package changes.

#4731 fixed this failure mode on the `bump-objectui.sh` side; the release page kept the old
guess (`const KEEP = ALL_TYPES ? null : new Set(['feat', 'fix'])`, with `--all` as an
explicit opt-in). Measured on the same real range (`7d9734d5e321..785b8a5d432c`, 53
non-merge objectui commits), the default output **dropped 13 commits that actually
released** — 6 of them breaking `refactor(...)!`, including `refactor(layout)!: delete
PageNodeRenderer` and burn-ledger batches 2/4/5/6/7, plus `chore(deps): lockstep the
@objectstack family onto 17.0.0-rc.1` — while **listing 5 commits that release nothing** in
objectui (two `fix(ci)`: one with no changeset, one whose changeset has an empty
frontmatter). Breaking changes were the single class structurally unable to appear, in the
artifact that leads with breaking changes.

The two scripts now share **one** criterion rather than each carrying a copy: the
classification moved into an exported `classifyRange()` in
`scripts/objectui-changeset-digest.mjs`, and both `bump-objectui.sh` (the platform release
record) and `objectui-range.mjs` (the release page) go through it. A second copy would
drift, and the first thing it would drift on is the class that already went missing once.

Because the output *is* release-page body text — a reader cannot tell a filtered list from a
complete one — the accounting is now **unconditional**: every run prints how many changesets
released of how many were added across how many commits, plus the excluded counts
(release-nothing changesets, commits carrying no changeset), including when those counts are
zero. `--all` changes meaning from "include every commit type" (the filter is gone) to "also
name the excluded entries, one per line". Headings group by the level objectui declared
(breaking / features / fixes); grouping is presentation and never a filter. Guarded by
`node scripts/objectui-range.mjs --self-test`, folded into the existing
`pnpm check:objectui-changeset` gate.
